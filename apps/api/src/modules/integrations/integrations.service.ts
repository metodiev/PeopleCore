import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IntegrationProvider, Principal } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { ConflictError, IntegrationError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { CryptoService } from '../../common/utils/crypto.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OAuthService, type OAuthProviderName } from '../../auth/oauth.service.js';
import { IntegrationSyncService } from './integration-sync.service.js';

const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite',
];

interface CatalogDefinition {
  provider: IntegrationProvider;
  name: string;
  description: string;
  category: 'CALENDAR' | 'COMMUNICATION' | 'FINANCE' | 'TALENT';
}

/** Providers with a working connector; everything else is reported unavailable. */
const CATALOG: CatalogDefinition[] = [
  {
    provider: 'GOOGLE',
    name: 'Google Calendar',
    description: 'Two-way synchronisation of the company calendar with Google Calendar',
    category: 'CALENDAR',
  },
  {
    provider: 'MICROSOFT',
    name: 'Microsoft 365',
    description: 'Two-way synchronisation with Outlook / Microsoft 365 calendars',
    category: 'CALENDAR',
  },
  {
    provider: 'SLACK',
    name: 'Slack',
    description: 'Leave approvals and reminders inside Slack',
    category: 'COMMUNICATION',
  },
  {
    provider: 'TEAMS',
    name: 'Microsoft Teams',
    description: 'Leave approvals and reminders inside Microsoft Teams',
    category: 'COMMUNICATION',
  },
  {
    provider: 'PAYROLL',
    name: 'Payroll provider',
    description: 'Push payroll runs to an external payroll bureau',
    category: 'FINANCE',
  },
  {
    provider: 'ACCOUNTING',
    name: 'Accounting system',
    description: 'Synchronise compensation and expenses with accounting software',
    category: 'FINANCE',
  },
  {
    provider: 'RECRUITMENT',
    name: 'Recruitment / ATS',
    description: 'Publish vacancies and import candidates from an ATS',
    category: 'TALENT',
  },
];

export interface IntegrationCatalogEntry extends CatalogDefinition {
  available: boolean;
  reason?: string;
  scopes?: string[];
  connection: {
    id: string;
    status: string;
    connectedAccount: string | null;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
  } | null;
}

/**
 * Integration Centre: provider catalogue, OAuth connect flow, sync control and
 * per-connection status. Credentials never live in the database — client ids
 * and secrets come from the environment, and only the OAuth tokens of a
 * connection are stored (encrypted with AES-256-GCM).
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly oauth: OAuthService,
    private readonly sync: IntegrationSyncService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
  }

  async catalog(principal: Principal): Promise<IntegrationCatalogEntry[]> {
    const connections = await this.prisma.client.integrationConnection.findMany({
      where: { tenantId: principal.tenantId! },
    });

    return CATALOG.map((definition) => {
      const isCalendarProvider = definition.provider === 'GOOGLE' || definition.provider === 'MICROSOFT';
      if (!isCalendarProvider) {
        return {
          ...definition,
          available: false,
          reason: `The ${definition.name} connector is not installed on this deployment`,
          connection: null,
        };
      }

      const provider = definition.provider.toLowerCase() as OAuthProviderName;
      const configured = this.oauth.isConfigured(provider);
      const connection = connections.find((row) => row.provider === definition.provider) ?? null;
      return {
        ...definition,
        available: configured,
        ...(configured
          ? {}
          : { reason: `Set ${definition.provider}_CLIENT_ID and ${definition.provider}_CLIENT_SECRET to enable this provider` }),
        scopes: definition.provider === 'GOOGLE' ? GOOGLE_CALENDAR_SCOPES : MICROSOFT_CALENDAR_SCOPES,
        connection: connection
          ? {
              id: connection.id,
              status: connection.status,
              connectedAccount: connection.externalAccountEmail,
              lastSyncAt: connection.lastSyncAt,
              lastSyncError: connection.lastSyncError,
            }
          : null,
      };
    });
  }

  /** Starts the calendar OAuth flow; the caller's user id travels in the state. */
  async startConnect(principal: Principal, providerParam: string): Promise<{ url: string; provider: IntegrationProvider }> {
    const provider = this.calendarProvider(providerParam);
    if (!this.oauth.isConfigured(provider.toLowerCase() as OAuthProviderName)) {
      throw new IntegrationError(`${provider} OAuth is not configured on this server`, 'OAUTH_NOT_CONFIGURED');
    }

    const tenant = await this.prisma.raw.tenant.findUnique({
      where: { id: principal.tenantId! },
      select: { slug: true },
    });

    const { url } = await this.oauth.buildAuthorizationUrl(provider.toLowerCase() as OAuthProviderName, {
      tenantSlug: tenant?.slug,
      mode: 'calendar',
      userId: principal.userId,
      scopes: provider === 'GOOGLE' ? GOOGLE_CALENDAR_SCOPES : MICROSOFT_CALENDAR_SCOPES,
    });
    return { url, provider };
  }

  /** OAuth callback: stores the encrypted tokens and creates the sync mapping. */
  async completeCallback(
    providerParam: string,
    code: string | undefined,
    state: string | undefined,
  ): Promise<{ redirectUrl: string; provider: IntegrationProvider }> {
    const provider = this.calendarProvider(providerParam);
    if (!code || !state) throw new ValidationError('The OAuth callback is missing `code` or `state`');

    const statePayload = await this.oauth.verifyState(state);
    if (statePayload.provider !== provider.toLowerCase() || statePayload.mode !== 'calendar') {
      throw new IntegrationError('The OAuth state does not belong to this flow', 'OAUTH_STATE_MISMATCH');
    }
    if (!statePayload.tenantId) throw new ValidationError('The OAuth state is missing the company');

    const exchanged = await this.oauth.exchangeCode(provider.toLowerCase() as OAuthProviderName, code);
    const tenantId = statePayload.tenantId;
    const scopeKey = statePayload.userId ?? 'org';
    const tokens = {
      accessTokenEnc: this.crypto.encrypt(exchanged.accessToken),
      refreshTokenEnc: this.crypto.encryptOptional(exchanged.refreshToken),
      expiresAt: exchanged.expiresAt ?? null,
      scopes: exchanged.scopes,
    };

    const connection = await this.prisma.forTenant(tenantId, (db) =>
      db.integrationConnection.upsert({
        where: { tenantId_provider_scopeKey: { tenantId, provider, scopeKey } },
        create: {
          tenantId,
          provider,
          scopeKey,
          userId: statePayload.userId,
          status: 'CONNECTED',
          externalAccountId: exchanged.profile.providerAccountId,
          externalAccountEmail: exchanged.profile.email,
          lastSyncError: null,
          ...tokens,
        },
        update: {
          userId: statePayload.userId,
          status: 'CONNECTED',
          externalAccountId: exchanged.profile.providerAccountId,
          externalAccountEmail: exchanged.profile.email,
          lastSyncError: null,
          ...tokens,
        },
      }),
    );

    await this.ensureCalendarMapping(tenantId, connection.id);
    await this.audit.record({
      action: 'integration.connect',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      actorUserId: statePayload.userId,
      tenantId,
      after: { provider, externalAccountEmail: exchanged.profile.email },
    });

    this.logger.log(`Connected ${provider} calendar for tenant ${tenantId}`);
    return { redirectUrl: this.redirectUrl(`connected=${provider.toLowerCase()}`), provider };
  }

  async requestSync(principal: Principal, providerParam: string): Promise<{ queued: boolean; provider: IntegrationProvider }> {
    const provider = this.calendarProvider(providerParam);
    const connection = await this.prisma.client.integrationConnection.findFirst({
      where: { provider, tenantId: principal.tenantId! },
    });
    if (!connection) throw new NotFoundError('Integration connection', 'CONNECTION_NOT_FOUND');
    if (connection.status === 'DISCONNECTED') {
      throw new ConflictError('This integration is disconnected — connect it again first', 'INTEGRATION_DISCONNECTED');
    }

    await this.sync.enqueueSync(principal.tenantId!, provider);
    await this.audit.record({
      action: 'integration.sync.request',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      actorUserId: principal.userId,
      after: { provider },
    });
    return { queued: true, provider };
  }

  /** Disconnects the tenant's connection and revokes every sync mapping. */
  async disconnect(principal: Principal, providerParam: string) {
    const provider = this.calendarProvider(providerParam);
    const connection = await this.prisma.client.integrationConnection.findFirst({
      where: { provider, tenantId: principal.tenantId! },
    });
    if (!connection) throw new NotFoundError('Integration connection', 'CONNECTION_NOT_FOUND');

    await this.prisma.transaction(async (tx) => {
      await tx.eventSyncMapping.deleteMany({ where: { connectionId: connection.id } });
      await tx.calendarSyncMapping.deleteMany({ where: { connectionId: connection.id } });
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: 'DISCONNECTED',
          accessTokenEnc: null,
          refreshTokenEnc: null,
          expiresAt: null,
          lastSyncError: null,
        },
      });
    });

    await this.audit.record({
      action: 'integration.disconnect',
      entityType: 'IntegrationConnection',
      entityId: connection.id,
      actorUserId: principal.userId,
      after: { provider },
    });
    return { disconnected: true, provider };
  }

  async status(principal: Principal) {
    const connections = await this.prisma.client.integrationConnection.findMany({
      where: { tenantId: principal.tenantId! },
      include: { _count: { select: { calendarMappings: true, eventMappings: true } } },
      orderBy: { provider: 'asc' },
    });

    return {
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        scopeKey: connection.scopeKey,
        status: connection.status,
        connectedAccount: connection.externalAccountEmail,
        connectedAccountId: connection.externalAccountId,
        scopes: connection.scopes,
        lastSyncAt: connection.lastSyncAt,
        lastSyncError: connection.lastSyncError,
        mappedCalendars: connection._count.calendarMappings,
        mappedEvents: connection._count.eventMappings,
      })),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async ensureCalendarMapping(tenantId: string, connectionId: string): Promise<void> {
    const existing = await this.prisma.forTenant(tenantId, (db) =>
      db.calendarSyncMapping.findFirst({ where: { connectionId } }),
    );
    if (existing) return;

    const calendar = await this.prisma.forTenant(tenantId, (db) =>
      db.calendar.findFirst({
        where: { type: 'COMPANY' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { id: true },
      }),
    );
    if (!calendar) {
      this.logger.warn(`Tenant ${tenantId} has no company calendar — the mapping is created on the first sync`);
      return;
    }

    await this.prisma.forTenant(tenantId, (db) =>
      db.calendarSyncMapping.create({
        data: {
          tenantId,
          connectionId,
          calendarId: calendar.id,
          externalCalendarId: 'primary',
          direction: 'BIDIRECTIONAL',
        },
      }),
    );
  }

  private calendarProvider(providerParam: string): IntegrationProvider {
    const provider = providerParam.toUpperCase() as IntegrationProvider;
    if (provider !== 'GOOGLE' && provider !== 'MICROSOFT') {
      throw new ValidationError(
        `Only calendar providers can be connected (received "${providerParam}")`,
        { code: 'PROVIDER_UNSUPPORTED' },
      );
    }
    return provider;
  }

  private redirectUrl(query: string): string {
    const base = this.config.webAppUrl.replace(/\/+$/, '');
    return `${base}/integrations?${query}`;
  }
}
