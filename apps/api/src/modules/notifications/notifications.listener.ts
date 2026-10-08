import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { LeaveDecidedEvent, LeaveRequestedEvent } from '../leave/leave.service.js';
import { NotificationsService } from './notifications.service.js';

/** Roles that act as the HR desk for approval and compliance notifications. */
export const HR_ROLE_KEYS = ['HR_ADMIN', 'HR_MANAGER'] as const;
/** Roles that own workspace administration (integration failures, broadcasts). */
export const ADMIN_ROLE_KEYS = ['COMPANY_ADMIN', 'HR_ADMIN'] as const;

export interface DocumentAcknowledgementEvent {
  tenantId: string;
  documentId: string;
  employeeId: string;
  documentName: string;
}

export interface IntegrationSyncErrorEvent {
  tenantId: string;
  provider: string;
  connectionId: string;
  message: string;
}

/**
 * Fans domain events out to notification recipients.
 *
 * Listeners are deliberately defensive: they run detached from the request
 * that emitted the event, so every failure is logged and swallowed — a broken
 * notification must never fail a leave approval.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('leave.requested')
  async onLeaveRequested(event: LeaveRequestedEvent): Promise<void> {
    await this.run('leave.requested', async () => {
      const employee = await this.employeeName(event.tenantId, event.employeeId);
      const body = `${employee} requested ${event.days} day(s) of ${event.leaveTypeName} (${event.startDate} → ${event.endDate})`;
      const data = {
        referenceId: event.leaveRequestId,
        leaveRequestId: event.leaveRequestId,
        employeeId: event.employeeId,
        startDate: event.startDate,
        endDate: event.endDate,
      };

      if (event.approverUserId) {
        await this.notifications.notify({
          tenantId: event.tenantId,
          userId: event.approverUserId,
          type: 'approval.required',
          title: 'Leave request awaiting your approval',
          body,
          data,
        });
        return;
      }

      await this.notifications.notifyRole(event.tenantId, HR_ROLE_KEYS, {
        type: 'approval.required',
        title: 'Leave request awaiting approval',
        body,
        data,
      });
    });
  }

  @OnEvent('leave.approved')
  async onLeaveApproved(event: LeaveDecidedEvent): Promise<void> {
    await this.run('leave.approved', async () => {
      await this.notifications.notifyEmployee(event.tenantId, event.employeeId, {
        type: 'leave.approved',
        title: 'Leave request approved',
        body: `Your ${event.days} day(s) of ${event.leaveTypeName} (${event.startDate} → ${event.endDate}) were approved`,
        data: { referenceId: event.leaveRequestId, leaveRequestId: event.leaveRequestId, status: event.status },
      });
    });
  }

  @OnEvent('leave.rejected')
  async onLeaveRejected(event: LeaveDecidedEvent): Promise<void> {
    await this.run('leave.rejected', async () => {
      await this.notifications.notifyEmployee(event.tenantId, event.employeeId, {
        type: 'leave.rejected',
        title: 'Leave request rejected',
        body: event.comment
          ? `Your ${event.leaveTypeName} request (${event.startDate} → ${event.endDate}) was rejected: ${event.comment}`
          : `Your ${event.leaveTypeName} request (${event.startDate} → ${event.endDate}) was rejected`,
        data: { referenceId: event.leaveRequestId, leaveRequestId: event.leaveRequestId, status: event.status },
      });
    });
  }

  @OnEvent('leave.cancelled')
  async onLeaveCancelled(event: LeaveDecidedEvent): Promise<void> {
    await this.run('leave.cancelled', async () => {
      const employee = await this.prisma.forTenant(event.tenantId, (db) =>
        db.employee.findFirst({ where: { id: event.employeeId }, select: { userId: true, firstName: true, lastName: true } }),
      );
      const data = {
        referenceId: event.leaveRequestId,
        leaveRequestId: event.leaveRequestId,
        status: event.status,
      };

      await this.notifications.notifyEmployee(event.tenantId, event.employeeId, {
        type: 'leave.cancelled',
        title: 'Leave request cancelled',
        body: `Your ${event.leaveTypeName} request (${event.startDate} → ${event.endDate}) was cancelled`,
        data,
      });

      // Self-service cancellations change the team plan, so HR is informed.
      if (employee?.userId && employee.userId === event.decidedByUserId) {
        await this.notifications.notifyRole(event.tenantId, HR_ROLE_KEYS, {
          type: 'leave.cancelled',
          title: 'Leave request cancelled',
          body: `${employee.firstName} ${employee.lastName} cancelled ${event.days} day(s) of ${event.leaveTypeName} (${event.startDate} → ${event.endDate})`,
          data: { ...data, employeeId: event.employeeId },
        });
      }
    });
  }

  @OnEvent('document.acknowledgement.required')
  async onDocumentAcknowledgementRequired(event: DocumentAcknowledgementEvent): Promise<void> {
    await this.run('document.acknowledgement.required', async () => {
      await this.notifications.notifyEmployee(event.tenantId, event.employeeId, {
        type: 'document.acknowledgement.required',
        title: 'Document acknowledgement required',
        body: `Please review and acknowledge "${event.documentName}"`,
        data: { referenceId: event.documentId, documentId: event.documentId },
      });
    });
  }

  @OnEvent('integration.sync_error')
  async onIntegrationSyncError(event: IntegrationSyncErrorEvent): Promise<void> {
    await this.run('integration.sync_error', async () => {
      await this.notifications.notifyRole(event.tenantId, ADMIN_ROLE_KEYS, {
        type: 'integration.sync_error',
        title: `${event.provider} calendar sync failed`,
        body: event.message,
        data: { referenceId: event.connectionId, provider: event.provider },
      });
    });
  }

  private async employeeName(tenantId: string, employeeId: string): Promise<string> {
    const employee = await this.prisma.forTenant(tenantId, (db) =>
      db.employee.findFirst({ where: { id: employeeId }, select: { firstName: true, lastName: true } }),
    );
    return employee ? `${employee.firstName} ${employee.lastName}` : 'An employee';
  }

  private async run(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(`Notification fan-out for "${label}" failed`, error as Error);
    }
  }
}
