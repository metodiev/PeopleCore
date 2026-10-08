import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MANDATORY_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
} from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import type { Notification } from '../../generated/prisma/client.js';
import { NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { MailService } from '../mail/mail.service.js';
import type { RegisterPushDeviceDto } from './dto/notifications.dto.js';
import { SmsPort } from './sms.port.js';

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['IN_APP', 'EMAIL', 'PUSH', 'SMS'];

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

export interface NotifyInput {
  tenantId: string;
  userId: string;
  type: NotificationEvent;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Channels to attempt; defaults to every channel. */
  channels?: NotificationChannel[];
}

export type EmployeeNotifyInput = Omit<NotifyInput, 'tenantId' | 'userId'>;

export interface BroadcastInput {
  type: NotificationEvent;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  roleKeys?: string[];
  employeeIds?: string[];
}

export interface NotificationPreferenceView {
  eventType: NotificationEvent;
  label: string;
  mandatory: boolean;
  channels: { channel: NotificationChannel; enabled: boolean }[];
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Multi-channel notification delivery.
 *
 * In-app notifications are persisted rows; email goes through MailService,
 * push through the Expo push API and SMS through the {@link SmsPort}. Every
 * channel honours the user's {@link NotificationPreference} matrix (defaults
 * to enabled) except the mandatory transactional events, which can never be
 * switched off. Delivery failures are logged — a notification never breaks
 * the business operation that produced it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Delivers a notification to a single user across the enabled channels. */
  async notify(input: NotifyInput): Promise<Notification | null> {
    const mandatory = (MANDATORY_NOTIFICATION_EVENTS as readonly string[]).includes(input.type);
    const requested = input.channels?.length ? input.channels : [...NOTIFICATION_CHANNELS];

    try {
      const target = await this.prisma.forTenant(input.tenantId, async (db) => {
        const user = await db.user.findFirst({
          where: { id: input.userId },
          select: { id: true, email: true, phone: true, locale: true, status: true },
        });
        if (!user) return null;

        const [preferences, devices] = await Promise.all([
          db.notificationPreference.findMany({
            where: { userId: input.userId },
            select: { eventType: true, channel: true, enabled: true },
          }),
          requested.includes('PUSH')
            ? db.pushDevice.findMany({ where: { userId: input.userId }, select: { token: true } })
            : Promise.resolve([]),
        ]);
        return { user, preferences, devices };
      });

      if (!target) {
        this.logger.warn(`Notification "${input.type}" skipped: user ${input.userId} does not exist`);
        return null;
      }

      const isEnabled = (channel: NotificationChannel): boolean => {
        if (mandatory) return true;
        const preference = target.preferences.find((p) => p.eventType === input.type && p.channel === channel);
        return preference?.enabled ?? true;
      };
      const channels = requested.filter((channel) => isEnabled(channel));
      if (channels.length === 0) return null;

      let notification: Notification | null = null;
      if (channels.includes('IN_APP')) {
        notification = await this.prisma.forTenant(input.tenantId, (db) =>
          db.notification.create({
            data: {
              tenantId: input.tenantId,
              userId: input.userId,
              type: input.type,
              title: input.title,
              body: input.body,
              channel: 'IN_APP',
              data: input.data as never,
              sentAt: new Date(),
            },
          }),
        );
      }

      // Channels are independent best-effort deliveries.
      if (channels.includes('EMAIL') && target.user.locale) await this.deliverEmail(target.user, input);
      if (channels.includes('PUSH') && target.devices.length > 0) {
        await this.deliverPush(input, target.devices.map((device) => device.token));
      }
      if (channels.includes('SMS') && target.user.phone && this.sms.isConfigured()) {
        await this.deliverSms(target.user.phone, input);
      }

      return notification;
    } catch (error) {
      this.logger.error(`Failed to deliver notification "${input.type}" to user ${input.userId}`, error as Error);
      return null;
    }
  }

  /** Notifies the user account behind an employee record (no-op without one). */
  async notifyEmployee(tenantId: string, employeeId: string, input: EmployeeNotifyInput): Promise<Notification | null> {
    const employee = await this.prisma.forTenant(tenantId, (db) =>
      db.employee.findFirst({ where: { id: employeeId }, select: { userId: true, deletedAt: true } }),
    );
    if (!employee?.userId) {
      this.logger.debug(`Employee ${employeeId} has no user account — notification "${input.type}" skipped`);
      return null;
    }
    return this.notify({ tenantId, userId: employee.userId, ...input });
  }

  /** Delivers a notification to every active user holding one of the roles. */
  async notifyRole(tenantId: string, roleKeys: readonly string[], input: EmployeeNotifyInput): Promise<number> {
    const members = await this.prisma.forTenant(tenantId, (db) =>
      db.userRole.findMany({
        where: {
          role: { tenantId, key: { in: [...roleKeys] } },
          user: { deletedAt: null, status: 'ACTIVE' },
        },
        select: { userId: true },
      }),
    );

    const userIds = [...new Set(members.map((member) => member.userId))];
    return this.deliverToMany(tenantId, userIds, input);
  }

  /** Admin broadcast to all active users or a narrowed audience. */
  async broadcast(tenantId: string, input: BroadcastInput): Promise<{ recipients: number; delivered: number }> {
    const userIds = await this.resolveAudience(tenantId, input);
    const delivered = await this.deliverToMany(tenantId, userIds, input);
    return { recipients: userIds.length, delivered };
  }

  async listForUser(
    userId: string,
    query: { unreadOnly?: boolean; type?: string },
    pagination: { skip: number; take: number; orderBy: Record<string, 'asc' | 'desc'> },
  ): Promise<{ rows: Notification[]; total: number }> {
    const where = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.notification.findMany({ where, ...pagination }),
      this.prisma.client.notification.count({ where }),
    ]);
    return { rows, total };
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await this.prisma.client.notification.findFirst({ where: { id: notificationId, userId } });
    if (!notification) throw new NotFoundError('Notification', 'NOTIFICATION_NOT_FOUND');
    if (notification.readAt) return notification;
    return this.prisma.client.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** Full event × channel preference matrix for the user (defaults enabled). */
  async preferenceMatrix(userId: string): Promise<NotificationPreferenceView[]> {
    const stored = await this.prisma.client.notificationPreference.findMany({ where: { userId } });
    const mandatory = new Set<string>(MANDATORY_NOTIFICATION_EVENTS);

    return (NOTIFICATION_EVENTS as readonly NotificationEvent[]).map((eventType) => ({
      eventType,
      label: NOTIFICATION_EVENT_LABELS[eventType],
      mandatory: mandatory.has(eventType),
      channels: NOTIFICATION_CHANNELS.map((channel) => {
        const preference = stored.find((p) => p.eventType === eventType && p.channel === channel);
        return { channel, enabled: preference?.enabled ?? true };
      }),
    }));
  }

  async updatePreferences(
    userId: string,
    preferences: { eventType: NotificationEvent; channel: NotificationChannel; enabled: boolean }[],
  ): Promise<NotificationPreferenceView[]> {
    const blocked = preferences.filter(
      (preference) => !preference.enabled && (MANDATORY_NOTIFICATION_EVENTS as readonly string[]).includes(preference.eventType),
    );
    if (blocked.length > 0) {
      throw new ValidationError('Mandatory notifications cannot be disabled', {
        code: 'MANDATORY_NOTIFICATION_EVENT',
        eventTypes: [...new Set(blocked.map((preference) => preference.eventType))],
      });
    }

    await this.prisma.transaction(async (tx) => {
      for (const preference of preferences) {
        await tx.notificationPreference.upsert({
          where: {
            userId_eventType_channel: { userId, eventType: preference.eventType, channel: preference.channel },
          },
          create: tenantScoped({
            userId,
            eventType: preference.eventType,
            channel: preference.channel,
            enabled: preference.enabled,
          }),
          update: { enabled: preference.enabled },
        });
      }
    });

    return this.preferenceMatrix(userId);
  }

  /**
   * Registers (or re-registers) an Expo push token for the caller. A token is
   * owned by exactly one user: when the same physical device signs in as
   * somebody else the row is moved to the new owner.
   */
  async registerDevice(principal: { userId: string; tenantId: string }, dto: RegisterPushDeviceDto) {
    const existing = await this.prisma.client.pushDevice.findUnique({ where: { token: dto.token } });
    if (existing) {
      return this.prisma.client.pushDevice.update({
        where: { id: existing.id },
        data: {
          userId: principal.userId,
          tenantId: principal.tenantId,
          platform: dto.platform,
          deviceName: dto.deviceName ?? existing.deviceName,
          lastSeenAt: new Date(),
        },
      });
    }
    return this.prisma.client.pushDevice.create({
      data: tenantScoped({
        userId: principal.userId,
        token: dto.token,
        platform: dto.platform,
        deviceName: dto.deviceName,
      }),
    });
  }

  async removeDevice(userId: string, token: string): Promise<{ deleted: boolean }> {
    const result = await this.prisma.client.pushDevice.deleteMany({ where: { token, userId } });
    if (result.count === 0) throw new NotFoundError('Push device', 'PUSH_DEVICE_NOT_FOUND');
    return { deleted: true };
  }

  // ── Delivery back-ends ────────────────────────────────────────────────────

  private async deliverEmail(
    user: { email: string; locale: string },
    input: { type: string; title: string; body: string },
  ): Promise<void> {
    try {
      await this.mail.sendNotificationEmail(user.email, input.title, input.body);
    } catch (error) {
      this.logger.error(`Email delivery failed for "${input.type}" to ${user.email}`, error as Error);
    }
  }

  private async deliverPush(
    input: { type: string; title: string; body: string; data?: Record<string, unknown> },
    tokens: string[],
  ): Promise<void> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.config.expoAccessToken) headers['authorization'] = `Bearer ${this.config.expoAccessToken}`;

    const staleTokens: string[] = [];
    for (let index = 0; index < tokens.length; index += EXPO_BATCH_SIZE) {
      const batch = tokens.slice(index, index + EXPO_BATCH_SIZE);
      const messages = batch.map((token) => ({
        to: token,
        title: input.title,
        body: input.body,
        sound: 'default',
        data: input.data ?? {},
      }));

      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          this.logger.error(`Expo push request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
          continue;
        }

        const payload = (await response.json()) as { data?: ExpoTicket[] };
        (payload.data ?? []).forEach((ticket, ticketIndex) => {
          if (ticket.status !== 'error') return;
          if (ticket.details?.error === 'DeviceNotRegistered') {
            staleTokens.push(batch[ticketIndex] ?? '');
          } else {
            this.logger.warn(`Expo push ticket error for "${input.type}": ${ticket.message ?? ticket.details?.error}`);
          }
        });
      } catch (error) {
        this.logger.error(`Push delivery failed for "${input.type}"`, error as Error);
      }
    }

    if (staleTokens.length > 0) {
      const stale = staleTokens.filter(Boolean);
      await this.prisma.client.pushDevice.deleteMany({ where: { token: { in: stale } } }).catch((error: unknown) => {
        this.logger.warn(`Failed to prune unregistered push devices: ${(error as Error).message}`);
      });
    }
  }

  private async deliverSms(phone: string, input: { type: string; body: string }): Promise<void> {
    try {
      await this.sms.send({ to: phone, body: input.body });
    } catch (error) {
      this.logger.error(`SMS delivery failed for "${input.type}"`, error as Error);
    }
  }

  private async deliverToMany(tenantId: string, userIds: string[], input: EmployeeNotifyInput): Promise<number> {
    let delivered = 0;
    const batchSize = 20;
    for (let index = 0; index < userIds.length; index += batchSize) {
      const batch = userIds.slice(index, index + batchSize);
      const results = await Promise.all(batch.map((userId) => this.notify({ tenantId, userId, ...input })));
      delivered += results.filter(Boolean).length;
    }
    return delivered;
  }

  private async resolveAudience(
    tenantId: string,
    input: { roleKeys?: string[]; employeeIds?: string[] },
  ): Promise<string[]> {
    return this.prisma.forTenant(tenantId, async (db) => {
      const userIds = new Set<string>();

      if (input.employeeIds?.length) {
        const employees = await db.employee.findMany({
          where: { id: { in: input.employeeIds }, deletedAt: null },
          select: { userId: true },
        });
        for (const employee of employees) if (employee.userId) userIds.add(employee.userId);
      }

      if (input.roleKeys?.length) {
        const members = await db.userRole.findMany({
          where: {
            role: { tenantId, key: { in: input.roleKeys } },
            user: { deletedAt: null, status: 'ACTIVE' },
          },
          select: { userId: true },
        });
        for (const member of members) userIds.add(member.userId);
      }

      if (userIds.size === 0) {
        const users = await db.user.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true } });
        for (const user of users) userIds.add(user.id);
      }

      return [...userIds];
    });
  }
}
