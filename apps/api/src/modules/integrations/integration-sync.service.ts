import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IntegrationProvider } from '@peoplecore/shared';
import type { IntegrationConnection } from '../../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { IntegrationError, NotFoundError } from '../../common/errors/app-error.js';
import { CryptoService } from '../../common/utils/crypto.util.js';
import { JOB_QUEUE, type JobPayload, type JobQueuePort } from '../../jobs/jobs.port.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GoogleCalendarAdapter } from './providers/google-calendar.adapter.js';
import { MicrosoftGraphAdapter } from './providers/microsoft-graph.adapter.js';
import type { CalendarProviderAdapter, ExternalCalendarEvent } from './providers/calendar-provider.port.js';

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const LOCAL_EDIT_GRACE_MS = 1_000;
const MAX_ERROR_LENGTH = 900;

export interface SyncCounts {
  pulled: number;
  updated: number;
  pushed: number;
  cancelled: number;
}

export interface SyncOutcome {
  ok: boolean;
  counts: SyncCounts;
  error?: string;
}

/**
 * Provider-agnostic calendar synchronisation engine.
 *
 * Pull and push both rely on the mapping tables for duplicate prevention:
 * `CalendarSyncMapping` remembers the external calendar plus its incremental
 * sync token/delta link, and `EventSyncMapping` (unique on
 * `connectionId + externalEventId` and `connectionId + eventId`) is the only
 * way the engine decides whether an external event already has a local twin.
 * Local edits win until they are pushed; provider-side removals cancel the
 * local event instead of deleting it.
 */
@Injectable()
export class IntegrationSyncService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationSyncService.name);
  private readonly crypto: CryptoService;
  private readonly adapters: Partial<Record<IntegrationProvider, CalendarProviderAdapter>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    google: GoogleCalendarAdapter,
    microsoft: MicrosoftGraphAdapter,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueuePort,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
    this.adapters = { GOOGLE: google, MICROSOFT: microsoft };
  }

  onModuleInit(): void {
    this.jobs.register('integration.sync', async (payload) => {
      await this.runSyncJob(payload);
    });
  }

  /** Queues a synchronization of every connection of the tenant+provider. */
  async enqueueSync(tenantId: string, provider: IntegrationProvider): Promise<void> {
    await this.jobs.enqueue('integration.sync', { tenantId, provider }, { jobId: `sync:${tenantId}:${provider}` });
  }

  private async runSyncJob(payload: JobPayload): Promise<void> {
    const tenantId = typeof payload['tenantId'] === 'string' ? payload['tenantId'] : null;
    const provider = typeof payload['provider'] === 'string' ? (payload['provider'] as IntegrationProvider) : null;
    if (!tenantId || !provider) {
      this.logger.warn('integration.sync job ignored: tenantId and provider are required');
      return;
    }

    const connections = await this.prisma.forTenant(tenantId, (db) =>
      db.integrationConnection.findMany({
        where: { provider, status: { not: 'DISCONNECTED' } },
        select: { id: true },
      }),
    );
    for (const connection of connections) {
      await this.syncConnection(tenantId, connection.id);
    }
  }

  async syncConnection(tenantId: string, connectionId: string): Promise<SyncOutcome> {
    const counts: SyncCounts = { pulled: 0, updated: 0, pushed: 0, cancelled: 0 };

    const connection = await this.prisma.forTenant(tenantId, (db) =>
      db.integrationConnection.findFirst({ where: { id: connectionId } }),
    );
    if (!connection) throw new NotFoundError('Integration connection', 'CONNECTION_NOT_FOUND');

    const adapter = this.adapters[connection.provider];
    if (!adapter) {
      throw new IntegrationError(`${connection.provider} synchronization is not available`, 'PROVIDER_UNAVAILABLE');
    }

    try {
      await this.setConnectionState(tenantId, connection.id, { status: 'SYNCING' });
      const accessToken = await this.ensureAccessToken(tenantId, connection, adapter);
      const mapping = await this.ensureCalendarMapping(tenantId, connection);

      const pull = await this.pullWithFallback(adapter, accessToken, mapping);
      for (const external of pull.events) {
        await this.applyExternalEvent(tenantId, connection, mapping, external, counts);
      }
      await this.pushLocalEvents(tenantId, connection, mapping, adapter, accessToken, counts);

      await this.prisma.forTenant(tenantId, (db) =>
        db.calendarSyncMapping.update({
          where: { id: mapping.id },
          data: { syncToken: pull.nextSyncToken ?? mapping.syncToken, lastSyncedAt: new Date() },
        }),
      );
      await this.setConnectionState(tenantId, connection.id, { status: 'CONNECTED', lastSyncAt: new Date(), lastSyncError: null });

      this.events.emit('integration.sync_completed', {
        tenantId,
        provider: connection.provider,
        connectionId: connection.id,
        counts,
      });
      this.logger.log(
        `Calendar sync (${connection.provider}) finished: ${counts.pulled} new, ${counts.updated} updated, ${counts.pushed} pushed, ${counts.cancelled} cancelled`,
      );
      return { ok: true, counts };
    } catch (error) {
      const message = truncate(error instanceof Error ? error.message : String(error));
      await this.setConnectionState(tenantId, connection.id, { status: 'ERROR', lastSyncError: message }).catch(
        (persistError: unknown) => this.logger.error('Failed to persist the sync error', persistError as Error),
      );
      this.events.emit('integration.sync_error', {
        tenantId,
        provider: connection.provider,
        connectionId: connection.id,
        message,
      });
      this.logger.error(`Calendar sync (${connection.provider}) failed: ${message}`);

      // Connection-level failures should not fail the job (and its retries)
      // for every other connection; the state is persisted for the UI.
      return { ok: false, counts, error: message };
    }
  }

  // ── Access tokens ─────────────────────────────────────────────────────────

  private async ensureAccessToken(
    tenantId: string,
    connection: IntegrationConnection,
    adapter: CalendarProviderAdapter,
  ): Promise<string> {
    const accessToken = this.crypto.decryptOptional(connection.accessTokenEnc);
    const refreshToken = this.crypto.decryptOptional(connection.refreshTokenEnc);
    if (!accessToken) {
      throw new IntegrationError('The connection has no access token — reconnect the provider', 'TOKEN_MISSING');
    }

    const expiresSoon =
      connection.expiresAt !== null && connection.expiresAt.getTime() - Date.now() < TOKEN_REFRESH_MARGIN_MS;
    if (!expiresSoon) return accessToken;
    if (!refreshToken) {
      throw new IntegrationError('The access token expired — reconnect the provider', 'TOKEN_EXPIRED');
    }

    const refreshed = await adapter.refreshAccessToken(refreshToken);
    // Rotated tokens are persisted so the next run keeps working.
    await this.prisma.forTenant(tenantId, (db) =>
      db.integrationConnection.update({
        where: { id: connection.id },
        data: {
          accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
          refreshTokenEnc: refreshed.refreshToken ? this.crypto.encrypt(refreshed.refreshToken) : undefined,
          expiresAt: refreshed.expiresAt ?? null,
        },
      }),
    );
    return refreshed.accessToken;
  }

  // ── Mappings ──────────────────────────────────────────────────────────────

  private async ensureCalendarMapping(tenantId: string, connection: IntegrationConnection) {
    const existing = await this.prisma.forTenant(tenantId, (db) =>
      db.calendarSyncMapping.findFirst({ where: { connectionId: connection.id } }),
    );
    if (existing) return existing;

    const calendar = await this.prisma.forTenant(tenantId, (db) =>
      db.calendar.findFirst({
        where: { type: 'COMPANY' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    );
    if (!calendar) throw new IntegrationError('The tenant has no company calendar to synchronise', 'NO_CALENDAR');

    try {
      return await this.prisma.forTenant(tenantId, (db) =>
        db.calendarSyncMapping.create({
          data: {
            tenantId,
            connectionId: connection.id,
            calendarId: calendar.id,
            externalCalendarId: 'primary',
            direction: 'BIDIRECTIONAL',
          },
        }),
      );
    } catch {
      // A concurrent run created it first.
      const created = await this.prisma.forTenant(tenantId, (db) =>
        db.calendarSyncMapping.findFirst({ where: { connectionId: connection.id } }),
      );
      if (!created) throw new IntegrationError('Failed to create the calendar sync mapping', 'MAPPING_FAILED');
      return created;
    }
  }

  private async pullWithFallback(
    adapter: CalendarProviderAdapter,
    accessToken: string,
    mapping: { externalCalendarId: string; syncToken: string | null },
  ) {
    try {
      return await adapter.pullEvents({
        accessToken,
        externalCalendarId: mapping.externalCalendarId,
        syncToken: mapping.syncToken,
      });
    } catch (error) {
      const expired = error instanceof IntegrationError && error.code === 'SYNC_TOKEN_EXPIRED';
      if (!expired || !mapping.syncToken) throw error;
      this.logger.warn('Incremental sync token expired — falling back to a full sync');
      return adapter.pullEvents({
        accessToken,
        externalCalendarId: mapping.externalCalendarId,
        syncToken: null,
      });
    }
  }

  // ── Pull ──────────────────────────────────────────────────────────────────

  private async applyExternalEvent(
    tenantId: string,
    connection: IntegrationConnection,
    mapping: { id: string; calendarId: string },
    external: ExternalCalendarEvent,
    counts: SyncCounts,
  ): Promise<void> {
    const existing = await this.prisma.forTenant(tenantId, (db) =>
      db.eventSyncMapping.findUnique({
        where: {
          connectionId_externalEventId: { connectionId: connection.id, externalEventId: external.externalId },
        },
        include: { event: true },
      }),
    );

    if (external.cancelled) {
      if (!existing || existing.event.isCancelled) return;
      await this.prisma.forTenant(tenantId, (db) =>
        db.calendarEvent.update({ where: { id: existing.eventId }, data: { isCancelled: true } }),
      );
      counts.cancelled += 1;
      return;
    }

    if (existing) {
      if (existing.etag && external.etag && existing.etag === external.etag) return;

      // A local edit that has not been pushed yet wins over the external copy.
      const baseline = latest(existing.lastPushedAt, existing.lastPulledAt, existing.createdAt);
      if (existing.event.updatedAt.getTime() > baseline.getTime() + LOCAL_EDIT_GRACE_MS) return;

      await this.prisma.forTenant(tenantId, async (db) => {
        await db.calendarEvent.update({
          where: { id: existing.eventId },
          data: {
            title: external.title,
            description: external.description ?? null,
            location: external.location ?? null,
            startAt: external.startAt,
            endAt: external.endAt,
            allDay: external.allDay,
          },
        });
        await db.eventSyncMapping.update({
          where: { id: existing.id },
          data: { etag: external.etag ?? null, lastPulledAt: new Date() },
        });
      });
      counts.updated += 1;
      return;
    }

    try {
      await this.prisma.forTenant(tenantId, () =>
        this.prisma.transaction(async (tx) => {
          const event = await tx.calendarEvent.create({
            data: {
              tenantId,
              calendarId: mapping.calendarId,
              title: external.title,
              description: external.description ?? null,
              type: 'EVENT',
              startAt: external.startAt,
              endAt: external.endAt,
              allDay: external.allDay,
              location: external.location ?? null,
              visibility: 'TENANT',
            },
          });
          await tx.eventSyncMapping.create({
            data: {
              tenantId,
              connectionId: connection.id,
              eventId: event.id,
              externalEventId: external.externalId,
              etag: external.etag ?? null,
              lastPulledAt: new Date(),
            },
          });
        }),
      );
      counts.pulled += 1;
    } catch (error) {
      // The unique constraints guarantee a single local twin per external id;
      // losing a race simply means the mapping now exists.
      this.logger.warn(`Skipped duplicate external event ${external.externalId}: ${(error as Error).message}`);
    }
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  private async pushLocalEvents(
    tenantId: string,
    connection: IntegrationConnection,
    mapping: { calendarId: string; externalCalendarId: string },
    adapter: CalendarProviderAdapter,
    accessToken: string,
    counts: SyncCounts,
  ): Promise<void> {
    const events = await this.prisma.forTenant(tenantId, (db) =>
      db.calendarEvent.findMany({
        where: { calendarId: mapping.calendarId },
        include: { mappings: { where: { connectionId: connection.id } } },
        orderBy: { updatedAt: 'asc' },
        take: 500,
      }),
    );

    for (const event of events) {
      const eventMapping = event.mappings[0];

      if (event.isCancelled) {
        if (!eventMapping) continue;
        await adapter.deleteEvent({
          accessToken,
          externalCalendarId: mapping.externalCalendarId,
          externalEventId: eventMapping.externalEventId,
        });
        await this.prisma.forTenant(tenantId, (db) =>
          db.eventSyncMapping.delete({ where: { id: eventMapping.id } }),
        );
        counts.pushed += 1;
        continue;
      }

      const payload = {
        title: event.title,
        description: event.description,
        location: event.location,
        startAt: event.startAt,
        endAt: event.endAt,
        allDay: event.allDay,
      };

      if (!eventMapping) {
        const pushed = await adapter.pushEvent({
          accessToken,
          externalCalendarId: mapping.externalCalendarId,
          event: payload,
        });
        try {
          await this.prisma.forTenant(tenantId, (db) =>
            db.eventSyncMapping.create({
              data: {
                tenantId,
                connectionId: connection.id,
                eventId: event.id,
                externalEventId: pushed.externalEventId,
                etag: pushed.etag ?? null,
                lastPushedAt: new Date(),
              },
            }),
          );
        } catch (error) {
          this.logger.warn(`Event ${event.id} was already mapped: ${(error as Error).message}`);
        }
        counts.pushed += 1;
        continue;
      }

      const baseline = latest(eventMapping.lastPushedAt, eventMapping.lastPulledAt, eventMapping.createdAt);
      if (event.updatedAt.getTime() <= baseline.getTime() + LOCAL_EDIT_GRACE_MS) continue;

      const pushed = await adapter.updateEvent({
        accessToken,
        externalCalendarId: mapping.externalCalendarId,
        externalEventId: eventMapping.externalEventId,
        event: payload,
      });
      await this.prisma.forTenant(tenantId, (db) =>
        db.eventSyncMapping.update({
          where: { id: eventMapping.id },
          data: { etag: pushed.etag ?? null, lastPushedAt: new Date() },
        }),
      );
      counts.pushed += 1;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async setConnectionState(
    tenantId: string,
    connectionId: string,
    data: { status: 'CONNECTED' | 'SYNCING' | 'ERROR' | 'DISCONNECTED'; lastSyncAt?: Date; lastSyncError?: string | null },
  ): Promise<void> {
    await this.prisma.forTenant(tenantId, (db) =>
      db.integrationConnection.update({ where: { id: connectionId }, data }),
    );
  }
}

function latest(...dates: (Date | null | undefined)[]): Date {
  return dates.reduce<Date>((acc, date) => (date && date.getTime() > acc.getTime() ? date : acc), new Date(0));
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}
