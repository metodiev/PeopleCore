import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { NotificationEvent } from '@peoplecore/shared';
import { JOB_QUEUE, type JobQueuePort } from '../../jobs/jobs.port.js';
import type { ScopedPrismaClient } from '../../prisma/prisma.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { HR_ROLE_KEYS } from './notifications.listener.js';
import { NotificationsService } from './notifications.service.js';

const DAY_MS = 86_400_000;
const DOCUMENT_EXPIRY_WINDOW_DAYS = 30;
const CONTRACT_EXPIRY_WINDOW_DAYS = 30;
const PROBATION_END_WINDOW_DAYS = 14;
const CERTIFICATION_EXPIRY_WINDOW_DAYS = 30;
const GOAL_DUE_WINDOW_DAYS = 7;
const LOW_BALANCE_RATIO = 0.25;

export interface ReminderSummary {
  tenants: number;
  notifications: number;
}

function startOfUtcDay(reference: Date = new Date()): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function withinWindow(date: Date | null, from: Date, days: number): boolean {
  return date !== null && date.getTime() >= from.getTime() && date.getTime() <= addDays(from, days).getTime();
}

function decimal(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * Daily reminder sweep.
 *
 * With a real job queue the `reminders.daily` repeatable job (06:00) runs this
 * service in a worker; with the inline development adapter the `@Cron` below
 * triggers it inside the API process instead. Every reminder is idempotent per
 * day: before notifying, the sweep checks whether a notification with the same
 * type and `data.referenceId` was already created today (role-addressed
 * reminders use a role-suffixed internal key so the employee copy does not mask
 * them). Reminder failures are logged and never abort the sweep.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueuePort,
  ) {}

  onModuleInit(): void {
    this.jobs.register('reminders.daily', async () => {
      await this.runDaily();
    });
    if (this.jobs.kind === 'bullmq') {
      void this.jobs
        .schedule?.('reminders.daily', '0 6 * * *', {})
        .catch((error: unknown) => this.logger.error('Failed to schedule reminders.daily', error as Error));
    }
  }

  /** Cron fallback for the inline queue (a real queue owns the schedule). */
  @Cron('0 6 * * *')
  async scheduledRun(): Promise<void> {
    if (this.jobs.kind === 'bullmq') return;
    await this.runDaily();
  }

  async runDaily(): Promise<ReminderSummary> {
    if (this.running) {
      this.logger.warn('Reminder sweep already running — skipping this trigger');
      return { tenants: 0, notifications: 0 };
    }
    this.running = true;

    try {
      const since = startOfUtcDay();
      const tenants = await this.prisma.raw.tenant.findMany({
        where: { deletedAt: null, status: { in: ['ACTIVE', 'TRIAL'] } },
        select: { id: true },
      });

      let notifications = 0;
      for (const tenant of tenants) {
        notifications += await this.runForTenant(tenant.id, since).catch((error: unknown) => {
          this.logger.error(`Reminder sweep failed for tenant ${tenant.id}`, error as Error);
          return 0;
        });
      }

      this.logger.log(`Reminder sweep finished: ${tenants.length} tenant(s), ${notifications} notification(s)`);
      return { tenants: tenants.length, notifications };
    } finally {
      this.running = false;
    }
  }

  private async runForTenant(tenantId: string, since: Date): Promise<number> {
    return this.prisma.forTenant(tenantId, async (db) => {
      const today = startOfUtcDay();
      const checks: ((db: ScopedPrismaClient) => Promise<number>)[] = [
        (client) => this.documentsExpiring(tenantId, client, today, since),
        (client) => this.contractsAndProbation(tenantId, client, today, since),
        (client) => this.certificationsExpiring(tenantId, client, today, since),
        (client) => this.lowLeaveBalances(tenantId, client, today, since),
        (client) => this.birthdaysAndAnniversaries(tenantId, client, today, since),
        (client) => this.goalsDue(tenantId, client, today, since),
      ];

      let delivered = 0;
      for (const check of checks) {
        delivered += await check(db).catch((error: unknown) => {
          this.logger.error(`Reminder check failed for tenant ${tenantId}`, error as Error);
          return 0;
        });
      }
      return delivered;
    });
  }

  // ── Checks ────────────────────────────────────────────────────────────────

  /** Documents expiring within 30 days → employee + HR. */
  private async documentsExpiring(
    tenantId: string,
    db: ScopedPrismaClient,
    today: Date,
    since: Date,
  ): Promise<number> {
    const documents = await db.document.findMany({
      where: {
        employeeId: { not: null },
        deletedAt: null,
        status: 'ACTIVE',
        expiresAt: { gte: today, lte: addDays(today, DOCUMENT_EXPIRY_WINDOW_DAYS) },
      },
      select: {
        id: true,
        name: true,
        expiresAt: true,
        employeeId: true,
        employee: { select: { userId: true, firstName: true, lastName: true } },
      },
    });

    let delivered = 0;
    for (const document of documents) {
      const employeeId = document.employeeId;
      if (!employeeId || !document.expiresAt) continue;
      const expiresAt = dateOnly(document.expiresAt);
      const data = { referenceId: document.id, documentId: document.id, expiresAt };

      if (!(await this.alreadyNotified(db, 'document.expiring', document.id, document.employee?.userId, since))) {
        const sent = await this.notifications.notifyEmployee(tenantId, employeeId, {
          type: 'document.expiring',
          title: 'Document expiring soon',
          body: `"${document.name}" expires on ${expiresAt}`,
          data,
        });
        if (sent) delivered += 1;
      }

      if (
        !(await this.alreadyNotified(db, 'document.expiring', `${document.id}#role`, undefined, since))
      ) {
        delivered += await this.notifications.notifyRole(tenantId, HR_ROLE_KEYS, {
          type: 'document.expiring',
          title: 'Document expiring soon',
          body: `${document.employee?.firstName ?? 'An employee'} ${document.employee?.lastName ?? ''} — "${document.name}" expires on ${expiresAt}`,
          data: { ...data, employeeId },
        });
      }
    }
    return delivered;
  }

  /** Contracts ending within 30 days and probation ending within 14 days → HR + manager. */
  private async contractsAndProbation(
    tenantId: string,
    db: ScopedPrismaClient,
    today: Date,
    since: Date,
  ): Promise<number> {
    const contracts = await db.contract.findMany({
      where: {
        status: 'ACTIVE',
        employee: { deletedAt: null, status: { not: 'TERMINATED' } },
        OR: [
          { endDate: { gte: today, lte: addDays(today, CONTRACT_EXPIRY_WINDOW_DAYS) } },
          { probationEndDate: { gte: today, lte: addDays(today, PROBATION_END_WINDOW_DAYS) } },
        ],
      },
      select: {
        id: true,
        endDate: true,
        probationEndDate: true,
        employeeId: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            manager: { select: { userId: true } },
          },
        },
      },
    });

    let delivered = 0;
    for (const contract of contracts) {
      const name = `${contract.employee?.firstName ?? 'An employee'} ${contract.employee?.lastName ?? ''}`.trim();
      const managerUserId = contract.employee?.manager?.userId ?? null;

      if (withinWindow(contract.endDate, today, CONTRACT_EXPIRY_WINDOW_DAYS) && contract.endDate) {
        delivered += await this.sendContractReminder(tenantId, db, {
          type: 'contract.expiring',
          title: 'Contract expiring soon',
          body: `${name} — contract ends on ${dateOnly(contract.endDate)}`,
          referenceId: contract.id,
          employeeId: contract.employeeId,
          managerUserId,
          since,
        });
      }

      if (withinWindow(contract.probationEndDate, today, PROBATION_END_WINDOW_DAYS) && contract.probationEndDate) {
        delivered += await this.sendContractReminder(tenantId, db, {
          type: 'contract.probation.ending',
          title: 'Probation period ending',
          body: `${name} — probation ends on ${dateOnly(contract.probationEndDate)}`,
          referenceId: contract.id,
          employeeId: contract.employeeId,
          managerUserId,
          since,
        });
      }
    }
    return delivered;
  }

  private async sendContractReminder(
    tenantId: string,
    db: ScopedPrismaClient,
    input: {
      type: NotificationEvent;
      title: string;
      body: string;
      referenceId: string;
      employeeId: string;
      managerUserId: string | null;
      since: Date;
    },
  ): Promise<number> {
    let delivered = 0;
    const data = { referenceId: input.referenceId, contractId: input.referenceId, employeeId: input.employeeId };

    if (!(await this.alreadyNotified(db, input.type, `${input.referenceId}#role`, undefined, input.since))) {
      delivered += await this.notifications.notifyRole(tenantId, HR_ROLE_KEYS, {
        type: input.type,
        title: input.title,
        body: input.body,
        data,
      });
    }

    if (
      input.managerUserId &&
      !(await this.alreadyNotified(db, input.type, input.referenceId, input.managerUserId, input.since))
    ) {
      const sent = await this.notifications.notify({
        tenantId,
        userId: input.managerUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        data,
      });
      if (sent) delivered += 1;
    }
    return delivered;
  }

  /** Certifications expiring within 30 days (flips to EXPIRING) → employee + HR. */
  private async certificationsExpiring(
    tenantId: string,
    db: ScopedPrismaClient,
    today: Date,
    since: Date,
  ): Promise<number> {
    const certifications = await db.certification.findMany({
      where: {
        status: { in: ['VALID', 'EXPIRING'] },
        expiresAt: { gte: today, lte: addDays(today, CERTIFICATION_EXPIRY_WINDOW_DAYS) },
        employee: { deletedAt: null, status: { not: 'TERMINATED' } },
      },
      select: {
        id: true,
        name: true,
        status: true,
        expiresAt: true,
        employeeId: true,
        employee: { select: { userId: true, firstName: true, lastName: true } },
      },
    });

    let delivered = 0;
    for (const certification of certifications) {
      if (!certification.expiresAt) continue;
      if (certification.status !== 'EXPIRING') {
        await db.certification.update({ where: { id: certification.id }, data: { status: 'EXPIRING' } });
      }

      const expiresAt = dateOnly(certification.expiresAt);
      const data = {
        referenceId: certification.id,
        certificationId: certification.id,
        expiresAt,
      };

      if (!(await this.alreadyNotified(db, 'certification.expiring', certification.id, certification.employee?.userId, since))) {
        const sent = await this.notifications.notifyEmployee(tenantId, certification.employeeId, {
          type: 'certification.expiring',
          title: 'Certification expiring soon',
          body: `"${certification.name}" expires on ${expiresAt}`,
          data,
        });
        if (sent) delivered += 1;
      }

      if (!(await this.alreadyNotified(db, 'certification.expiring', `${certification.id}#role`, undefined, since))) {
        delivered += await this.notifications.notifyRole(tenantId, HR_ROLE_KEYS, {
          type: 'certification.expiring',
          title: 'Certification expiring soon',
          body: `${certification.employee?.firstName ?? 'An employee'} ${certification.employee?.lastName ?? ''} — "${certification.name}" expires on ${expiresAt}`,
          data: { ...data, employeeId: certification.employeeId },
        });
      }
    }
    return delivered;
  }

  /** Leave balances with less than 25% remaining → employee. */
  private async lowLeaveBalances(
    tenantId: string,
    db: ScopedPrismaClient,
    today: Date,
    since: Date,
  ): Promise<number> {
    const balances = await db.leaveBalance.findMany({
      where: {
        year: today.getUTCFullYear(),
        employee: { deletedAt: null, status: { not: 'TERMINATED' } },
      },
      select: {
        id: true,
        entitled: true,
        accrued: true,
        used: true,
        pending: true,
        carriedOver: true,
        adjustment: true,
        employeeId: true,
        leaveType: { select: { name: true, isActive: true } },
        employee: { select: { userId: true, firstName: true } },
      },
    });

    let delivered = 0;
    for (const balance of balances) {
      if (!balance.leaveType?.isActive || !balance.employee?.userId) continue;

      const entitled =
        decimal(balance.entitled) + decimal(balance.carriedOver) + decimal(balance.adjustment) + decimal(balance.accrued);
      if (entitled <= 0) continue;

      const remaining = entitled - decimal(balance.used) - decimal(balance.pending);
      if (remaining / entitled >= LOW_BALANCE_RATIO) continue;

      if (await this.alreadyNotified(db, 'leave.balance.low', balance.id, balance.employee.userId, since)) continue;

      const sent = await this.notifications.notify({
        tenantId,
        userId: balance.employee.userId,
        type: 'leave.balance.low',
        title: 'Low leave balance',
        body: `Only ${remaining} day(s) of ${balance.leaveType.name} remaining out of ${entitled}`,
        data: { referenceId: balance.id, leaveBalanceId: balance.id, remaining, entitled },
      });
      if (sent) delivered += 1;
    }
    return delivered;
  }

  /** Birthdays and work anniversaries today → company (HR) channel. */
  private async birthdaysAndAnniversaries(
    tenantId: string,
    db: ScopedPrismaClient,
    today: Date,
    since: Date,
  ): Promise<number> {
    const employees = await db.employee.findMany({
      where: { deletedAt: null, status: { not: 'TERMINATED' } },
      select: { id: true, firstName: true, lastName: true, birthDate: true, hireDate: true },
    });

    const month = today.getUTCMonth();
    const day = today.getUTCDate();
    const isToday = (date: Date | null): boolean => date !== null && date.getUTCMonth() === month && date.getUTCDate() === day;

    let delivered = 0;
    for (const employee of employees) {
      const name = `${employee.firstName} ${employee.lastName}`;

      if (isToday(employee.birthDate) && !(await this.alreadyNotified(db, 'employee.birthday', `${employee.id}#role`, undefined, since))) {
        delivered += await this.notifications.notifyRole(tenantId, HR_ROLE_KEYS, {
          type: 'employee.birthday',
          title: 'Birthday today',
          body: `${name} celebrates a birthday today`,
          data: { referenceId: employee.id, employeeId: employee.id },
        });
      }

      if (
        isToday(employee.hireDate) &&
        employee.hireDate &&
        employee.hireDate.getUTCFullYear() < today.getUTCFullYear() &&
        !(await this.alreadyNotified(db, 'employee.anniversary', `${employee.id}#role`, undefined, since))
      ) {
        const years = today.getUTCFullYear() - employee.hireDate.getUTCFullYear();
        delivered += await this.notifications.notifyRole(tenantId, HR_ROLE_KEYS, {
          type: 'employee.anniversary',
          title: 'Work anniversary today',
          body: `${name} marks ${years} year(s) with the company today`,
          data: { referenceId: employee.id, employeeId: employee.id, years },
        });
      }
    }
    return delivered;
  }

  /** Goals due within 7 days → goal owner. */
  private async goalsDue(tenantId: string, db: ScopedPrismaClient, today: Date, since: Date): Promise<number> {
    const goals = await db.goal.findMany({
      where: {
        dueDate: { gte: today, lte: addDays(today, GOAL_DUE_WINDOW_DAYS) },
        status: { in: ['ACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK'] },
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        ownerUserId: true,
        employee: { select: { userId: true } },
      },
    });

    let delivered = 0;
    for (const goal of goals) {
      const userId = goal.ownerUserId ?? goal.employee?.userId ?? null;
      if (!userId || !goal.dueDate) continue;
      if (await this.alreadyNotified(db, 'goal.due', goal.id, userId, since)) continue;

      const sent = await this.notifications.notify({
        tenantId,
        userId,
        type: 'goal.due',
        title: 'Goal due soon',
        body: `"${goal.title}" is due on ${dateOnly(goal.dueDate)}`,
        data: { referenceId: goal.id, goalId: goal.id, dueDate: dateOnly(goal.dueDate) },
      });
      if (sent) delivered += 1;
    }
    return delivered;
  }

  /**
   * Per-day idempotency: a reminder is skipped when a notification of the same
   * type and `data.referenceId` was already created today. Direct notifications
   * are matched on the recipient as well; role-addressed reminders use a
   * `#role`-suffixed reference so the employee copy does not mask them.
   */
  private async alreadyNotified(
    db: ScopedPrismaClient,
    type: NotificationEvent,
    referenceId: string,
    userId: string | null | undefined,
    since: Date,
  ): Promise<boolean> {
    const existing = await db.notification.findFirst({
      where: {
        type,
        createdAt: { gte: since },
        ...(userId ? { userId } : {}),
        data: { path: ['referenceId'], equals: referenceId },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }
}
