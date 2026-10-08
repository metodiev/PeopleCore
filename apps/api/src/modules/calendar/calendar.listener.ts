import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { LeaveDecidedEvent } from '../leave/leave.service.js';
import { CalendarService } from './calendar.service.js';

/**
 * Mirrors the leave lifecycle into the calendar: approved requests become
 * read-only LEAVE events on the company calendar, cancellations soft-cancel
 * them. Failures are logged — calendar mirroring never fails a leave decision.
 */
@Injectable()
export class CalendarListener {
  private readonly logger = new Logger(CalendarListener.name);

  constructor(private readonly calendar: CalendarService) {}

  @OnEvent('leave.approved')
  async onLeaveApproved(event: LeaveDecidedEvent): Promise<void> {
    try {
      await this.calendar.mirrorApprovedLeave(event.tenantId, {
        leaveRequestId: event.leaveRequestId,
        employeeId: event.employeeId,
        leaveTypeName: event.leaveTypeName,
        startDate: event.startDate,
        endDate: event.endDate,
      });
    } catch (error) {
      this.logger.error(`Failed to mirror leave request ${event.leaveRequestId} into the calendar`, error as Error);
    }
  }

  @OnEvent('leave.cancelled')
  async onLeaveCancelled(event: LeaveDecidedEvent): Promise<void> {
    try {
      await this.calendar.cancelLeaveMirror(event.tenantId, event.leaveRequestId);
    } catch (error) {
      this.logger.error(`Failed to cancel the calendar mirror of leave request ${event.leaveRequestId}`, error as Error);
    }
  }
}
