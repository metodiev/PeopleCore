import { Injectable, Logger } from '@nestjs/common';
import type { CalendarEventType, EventVisibility, Principal } from '@peoplecore/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type { ScopedPrismaClient } from '../../prisma/prisma.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import type {
  CalendarEventQueryDto,
  CreateCalendarDto,
  CreateCalendarEventDto,
  HolidayQueryDto,
  RespondToEventDto,
  UpdateCalendarDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto.js';

const DAY_MS = 86_400_000;

const EVENT_INCLUDE = {
  calendar: { select: { id: true, name: true, type: true, isReadOnly: true } },
  attendees: {
    select: {
      id: true,
      employeeId: true,
      status: true,
      employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
    },
    orderBy: { employeeId: 'asc' },
  },
} satisfies Prisma.CalendarEventInclude;

const CALENDAR_INCLUDE = {
  _count: { select: { events: { where: { isCancelled: false } } } },
} satisfies Prisma.CalendarInclude;

type CalendarRow = Prisma.CalendarGetPayload<{ include: typeof CALENDAR_INCLUDE }>;
type EventRow = Prisma.CalendarEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

export interface CalendarEntry {
  id: string;
  source: 'event' | 'holiday';
  calendarId: string;
  title: string;
  description: string | null;
  type: CalendarEventType;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  visibility: EventVisibility;
  organizerEmployeeId: string | null;
  leaveRequestId: string | null;
  recurrenceRule: string | null;
  isCancelled: boolean;
  /** Mirrored records (leave, holidays) cannot be edited through this API. */
  readOnly: boolean;
  attendees: { id: string; employeeId: string; status: string; employee?: unknown }[];
}

export interface MirroredLeave {
  leaveRequestId: string;
  employeeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
}

/**
 * Calendars and events.
 *
 * Visibility follows the employee data scope: HR/admin see every calendar,
 * managers additionally see their team's calendars and everybody sees the
 * company calendar, their own personal calendar and events they are invited
 * to. Approved leave is mirrored into the company calendar as a read-only
 * LEAVE event, and company holidays are returned as synthetic read-only
 * entries next to the stored events.
 */
@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Calendars ─────────────────────────────────────────────────────────────

  async listCalendars(principal: Principal) {
    const rows = await this.prisma.client.calendar.findMany({
      where: await this.calendarWhere(principal),
      include: CALENDAR_INCLUDE,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.mapCalendar(row));
  }

  async createCalendar(principal: Principal, dto: CreateCalendarDto) {
    const isAdmin = this.scope.visibilityOf(principal) === 'all';
    const type = isAdmin ? (dto.type ?? 'COMPANY') : 'PERSONAL';
    const ownerEmployeeId = isAdmin ? dto.ownerEmployeeId : principal.employeeId ?? dto.ownerEmployeeId;

    if (type === 'PERSONAL' && !ownerEmployeeId) {
      throw new ValidationError('A personal calendar requires an owner employee', { code: 'OWNER_REQUIRED' });
    }
    if (dto.ownerEmployeeId) await this.scope.assertEmployeeAccess(principal, dto.ownerEmployeeId);
    if (type === 'DEPARTMENT' && !dto.departmentId) {
      throw new ValidationError('A department calendar requires departmentId', { code: 'DEPARTMENT_REQUIRED' });
    }
    if (type === 'TEAM' && !dto.teamId) {
      throw new ValidationError('A team calendar requires teamId', { code: 'TEAM_REQUIRED' });
    }
    await this.assertReferences(dto);

    const calendar = await this.prisma.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.calendar.updateMany({ where: { type }, data: { isDefault: false } });
      }
      return tx.calendar.create({
        data: tenantScoped({
          name: dto.name,
          type,
          color: dto.color,
          ownerEmployeeId: type === 'PERSONAL' ? ownerEmployeeId : dto.ownerEmployeeId,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          isDefault: dto.isDefault ?? false,
          isReadOnly: dto.isReadOnly ?? false,
        }),
      });
    });

    await this.audit.record({
      action: 'calendar.create',
      entityType: 'Calendar',
      entityId: calendar.id,
      actorUserId: principal.userId,
      after: calendar,
    });
    return calendar;
  }

  async updateCalendar(principal: Principal, id: string, dto: UpdateCalendarDto) {
    const before = await this.prisma.client.calendar.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Calendar', 'CALENDAR_NOT_FOUND');
    this.assertCalendarWritable(principal, before);

    if (dto.isDefault) {
      await this.prisma.client.calendar.updateMany({
        where: { type: dto.type ?? before.type },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.client.calendar.update({
      where: { id },
      data: {
        name: dto.name,
        color: dto.color,
        isDefault: dto.isDefault,
        isReadOnly: dto.isReadOnly,
        departmentId: dto.departmentId,
        teamId: dto.teamId,
        ...(before.type === 'PERSONAL' && dto.ownerEmployeeId ? { ownerEmployeeId: dto.ownerEmployeeId } : {}),
        ...(before.type !== 'PERSONAL' && dto.type && this.scope.visibilityOf(principal) === 'all' ? { type: dto.type } : {}),
      },
    });

    await this.audit.record({
      action: 'calendar.update',
      entityType: 'Calendar',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  async deleteCalendar(principal: Principal, id: string) {
    const calendar = await this.prisma.client.calendar.findFirst({
      where: { id },
      include: { _count: { select: { events: true } } },
    });
    if (!calendar) throw new NotFoundError('Calendar', 'CALENDAR_NOT_FOUND');
    this.assertCalendarWritable(principal, calendar);
    if (calendar.isDefault) {
      throw new ConflictError('The default calendar cannot be deleted', 'CALENDAR_DEFAULT');
    }

    await this.prisma.client.calendar.delete({ where: { id } });
    await this.audit.record({
      action: 'calendar.delete',
      entityType: 'Calendar',
      entityId: id,
      actorUserId: principal.userId,
      before: { name: calendar.name, type: calendar.type, events: calendar._count.events },
    });
    return { deleted: true };
  }

  // ── Events ────────────────────────────────────────────────────────────────

  async listEvents(principal: Principal, query: CalendarEventQueryDto): Promise<CalendarEntry[]> {
    const from = query.from ? new Date(query.from) : startOfUtcDay();
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 42 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to.getTime() <= from.getTime()) {
      throw new ValidationError('`to` must be after `from`', { code: 'INVALID_RANGE' });
    }

    const visible = await this.calendarIdsFor(principal);
    const requested = query.calendarIds;
    const calendarIds = visible === null ? requested : requested ? visible.filter((id) => requested.includes(id)) : visible;

    if (calendarIds && calendarIds.length === 0) {
      return this.holidayEntries(from, to, calendarIds, await this.companyCalendarId());
    }

    const where: Record<string, unknown> = {
      isCancelled: false,
      startAt: { lt: to },
      endAt: { gte: from },
      ...(calendarIds ? { calendarId: { in: calendarIds } } : {}),
    };

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      where['OR'] = [
        { organizerEmployeeId: query.employeeId },
        { attendees: { some: { employeeId: query.employeeId } } },
      ];
    } else if (this.scope.visibilityOf(principal) !== 'all') {
      const or: Record<string, unknown>[] = [{ visibility: { in: ['PUBLIC', 'TENANT'] } }];
      if (principal.employeeId) {
        or.push({ organizerEmployeeId: principal.employeeId });
        or.push({ attendees: { some: { employeeId: principal.employeeId } } });
      }
      where['OR'] = or;
    }

    const events = await this.prisma.client.calendarEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'asc' },
      take: 500,
    });

    const holidays = await this.holidayEntries(from, to, calendarIds, await this.companyCalendarId());
    return [...events.map((event) => this.mapEvent(event)), ...holidays].sort((a, b) =>
      a.startAt.localeCompare(b.startAt),
    );
  }

  async createEvent(principal: Principal, dto: CreateCalendarEventDto) {
    const calendar = dto.calendarId
      ? await this.prisma.client.calendar.findFirst({ where: { id: dto.calendarId } })
      : await this.companyCalendar();
    if (!calendar) throw new NotFoundError('Calendar', 'CALENDAR_NOT_FOUND');
    if (calendar.isReadOnly) throw new ForbiddenError('This calendar is read-only', 'CALENDAR_READ_ONLY');

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new ValidationError('Invalid event dates', { code: 'INVALID_DATES' });
    }
    if (endAt.getTime() <= startAt.getTime()) {
      throw new ValidationError('Event end must be after its start', { code: 'INVALID_RANGE' });
    }
    if (dto.organizerEmployeeId) await this.scope.assertEmployeeAccess(principal, dto.organizerEmployeeId);
    const attendeeIds = [...new Set(dto.attendeeEmployeeIds ?? [])];
    for (const employeeId of attendeeIds) await this.scope.assertEmployeeAccess(principal, employeeId);

    const event = await this.prisma.transaction(async (tx) => {
      const created = await tx.calendarEvent.create({
        data: tenantScoped({
          calendarId: calendar.id,
          title: dto.title,
          description: dto.description,
          type: dto.type ?? 'EVENT',
          startAt,
          endAt,
          allDay: dto.allDay ?? false,
          location: dto.location,
          visibility: dto.visibility ?? 'TENANT',
          organizerEmployeeId: dto.organizerEmployeeId ?? principal.employeeId ?? null,
          recurrenceRule: dto.recurrenceRule,
          createdById: principal.userId,
        }),
      });
      if (attendeeIds.length > 0) {
        await tx.eventAttendee.createMany({
          data: attendeeIds.map((employeeId) => tenantScoped({ eventId: created.id, employeeId })),
        });
      }
      return tx.calendarEvent.findFirstOrThrow({ where: { id: created.id }, include: EVENT_INCLUDE });
    });

    await this.audit.record({
      action: 'calendarEvent.create',
      entityType: 'CalendarEvent',
      entityId: event.id,
      actorUserId: principal.userId,
      after: { title: event.title, calendarId: event.calendarId, startAt: event.startAt, endAt: event.endAt },
    });
    return this.mapEvent(event);
  }

  async updateEvent(principal: Principal, id: string, dto: UpdateCalendarEventDto) {
    const before = await this.loadEvent(id);
    this.assertEventWritable(principal, before);

    if (dto.startAt || dto.endAt) {
      const startAt = new Date(dto.startAt ?? before.startAt);
      const endAt = new Date(dto.endAt ?? before.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
        throw new ValidationError('Event end must be after its start', { code: 'INVALID_RANGE' });
      }
    }
    if (dto.calendarId && dto.calendarId !== before.calendarId) {
      const target = await this.prisma.client.calendar.findFirst({ where: { id: dto.calendarId } });
      if (!target) throw new NotFoundError('Calendar', 'CALENDAR_NOT_FOUND');
      if (target.isReadOnly) throw new ForbiddenError('This calendar is read-only', 'CALENDAR_READ_ONLY');
    }
    const attendeeIds = dto.attendeeEmployeeIds ? [...new Set(dto.attendeeEmployeeIds)] : null;
    if (attendeeIds) {
      for (const employeeId of attendeeIds) await this.scope.assertEmployeeAccess(principal, employeeId);
    }

    const event = await this.prisma.transaction(async (tx) => {
      await tx.calendarEvent.update({
        where: { id },
        data: {
          calendarId: dto.calendarId,
          title: dto.title,
          description: dto.description,
          type: dto.type,
          startAt: dto.startAt ? new Date(dto.startAt) : undefined,
          endAt: dto.endAt ? new Date(dto.endAt) : undefined,
          allDay: dto.allDay,
          location: dto.location,
          visibility: dto.visibility,
          organizerEmployeeId: dto.organizerEmployeeId,
          recurrenceRule: dto.recurrenceRule,
        },
      });
      if (attendeeIds) {
        await tx.eventAttendee.deleteMany({ where: { eventId: id } });
        if (attendeeIds.length > 0) {
          await tx.eventAttendee.createMany({
            data: attendeeIds.map((employeeId) => tenantScoped({ eventId: id, employeeId })),
          });
        }
      }
      return tx.calendarEvent.findFirstOrThrow({ where: { id }, include: EVENT_INCLUDE });
    });

    await this.audit.record({
      action: 'calendarEvent.update',
      entityType: 'CalendarEvent',
      entityId: id,
      actorUserId: principal.userId,
      before: { title: before.title, startAt: before.startAt, endAt: before.endAt, visibility: before.visibility },
      after: { title: event.title, startAt: event.startAt, endAt: event.endAt, visibility: event.visibility },
    });
    return this.mapEvent(event);
  }

  /** Cancels an event (soft delete — mirrored calendars must observe it). */
  async cancelEvent(principal: Principal, id: string) {
    const before = await this.loadEvent(id);
    this.assertEventWritable(principal, before);

    const event = await this.prisma.client.calendarEvent.update({
      where: { id },
      data: { isCancelled: true },
      include: EVENT_INCLUDE,
    });
    await this.audit.record({
      action: 'calendarEvent.cancel',
      entityType: 'CalendarEvent',
      entityId: id,
      actorUserId: principal.userId,
      before: { isCancelled: false },
    });
    return this.mapEvent(event);
  }

  async respondToEvent(principal: Principal, id: string, dto: RespondToEventDto) {
    if (!principal.employeeId) {
      throw new ForbiddenError('Only employees can respond to event invitations', 'NOT_AN_EMPLOYEE');
    }
    const event = await this.prisma.client.calendarEvent.findFirst({
      where: { id },
      select: { id: true, isCancelled: true },
    });
    if (!event) throw new NotFoundError('Calendar event', 'EVENT_NOT_FOUND');
    if (event.isCancelled) throw new ConflictError('This event was cancelled', 'EVENT_CANCELLED');

    const attendee = await this.prisma.client.eventAttendee.findFirst({
      where: { eventId: id, employeeId: principal.employeeId },
    });
    if (!attendee) throw new NotFoundError('Event invitation', 'INVITATION_NOT_FOUND');

    const updated = await this.prisma.client.eventAttendee.update({
      where: { id: attendee.id },
      data: { status: dto.status },
    });
    await this.audit.record({
      action: 'calendarEvent.respond',
      entityType: 'EventAttendee',
      entityId: updated.id,
      actorUserId: principal.userId,
      after: { eventId: id, status: updated.status },
    });
    return updated;
  }

  // ── Holidays ──────────────────────────────────────────────────────────────

  async listHolidays(query: HolidayQueryDto) {
    const year = query.year ?? new Date().getUTCFullYear();
    const holidays = await this.prisma.client.holiday.findMany({ orderBy: { date: 'asc' } });
    return holidays
      .map((holiday) => ({
        id: holiday.id,
        name: holiday.name,
        date: holiday.date.toISOString().slice(0, 10),
        isRecurringYearly: holiday.isRecurringYearly,
        locationId: holiday.locationId,
      }))
      .filter((holiday) => holiday.date.slice(0, 4) === String(year) || holiday.isRecurringYearly);
  }

  // ── Leave mirroring (driven by leave events) ──────────────────────────────

  /** Creates or refreshes the LEAVE event mirroring an approved request. */
  async mirrorApprovedLeave(tenantId: string, leave: MirroredLeave): Promise<void> {
    const startAt = new Date(`${leave.startDate}T00:00:00.000Z`);
    const endAt = new Date(new Date(`${leave.endDate}T00:00:00.000Z`).getTime() + DAY_MS - 1);

    await this.prisma.forTenant(tenantId, async (db) => {
      const [calendar, employee, existing] = await Promise.all([
        this.companyCalendar(db),
        db.employee.findFirst({
          where: { id: leave.employeeId },
          select: { firstName: true, lastName: true },
        }),
        db.calendarEvent.findFirst({ where: { leaveRequestId: leave.leaveRequestId } }),
      ]);

      const title = `${employee?.firstName ?? 'Employee'} ${employee?.lastName ?? ''} — ${leave.leaveTypeName}`.trim();
      if (existing) {
        await db.calendarEvent.update({
          where: { id: existing.id },
          data: { title, startAt, endAt, isCancelled: false, type: 'LEAVE', calendarId: calendar.id },
        });
        return;
      }

      await db.calendarEvent.create({
        data: {
          tenantId,
          calendarId: calendar.id,
          title,
          type: 'LEAVE',
          startAt,
          endAt,
          allDay: true,
          visibility: 'TENANT',
          leaveRequestId: leave.leaveRequestId,
          organizerEmployeeId: leave.employeeId,
        },
      });
    });
  }

  /** Soft-cancels the LEAVE event of a cancelled request (idempotent). */
  async cancelLeaveMirror(tenantId: string, leaveRequestId: string): Promise<void> {
    await this.prisma.forTenant(tenantId, (db) =>
      db.calendarEvent.updateMany({ where: { leaveRequestId }, data: { isCancelled: true } }),
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private mapCalendar(row: CalendarRow) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      color: row.color,
      ownerEmployeeId: row.ownerEmployeeId,
      departmentId: row.departmentId,
      teamId: row.teamId,
      isDefault: row.isDefault,
      isReadOnly: row.isReadOnly,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      eventsCount: row._count.events,
    };
  }

  private mapEvent(event: EventRow): CalendarEntry {
    return {
      id: event.id,
      source: 'event',
      calendarId: event.calendarId,
      title: event.title,
      description: event.description,
      type: event.type,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      allDay: event.allDay,
      location: event.location,
      visibility: event.visibility,
      organizerEmployeeId: event.organizerEmployeeId,
      leaveRequestId: event.leaveRequestId,
      recurrenceRule: event.recurrenceRule,
      isCancelled: event.isCancelled,
      readOnly: event.calendar.isReadOnly || event.type === 'LEAVE' || event.leaveRequestId !== null,
      attendees: event.attendees.map((attendee) => ({
        id: attendee.id,
        employeeId: attendee.employeeId,
        status: attendee.status,
        employee: attendee.employee,
      })),
    };
  }

  private async holidayEntries(
    from: Date,
    to: Date,
    calendarIds: string[] | undefined,
    companyCalendarId: string | null,
  ): Promise<CalendarEntry[]> {
    if (calendarIds && companyCalendarId && !calendarIds.includes(companyCalendarId)) return [];

    const holidays = await this.prisma.client.holiday.findMany({
      where: {
        OR: [
          { date: { gte: from, lte: to } },
          { isRecurringYearly: true },
        ],
      },
      orderBy: { date: 'asc' },
    });

    const entries: CalendarEntry[] = [];
    for (const holiday of holidays) {
      const occurrences = holiday.isRecurringYearly
        ? recurringOccurrences(holiday.date, from, to)
        : [holiday.date];
      for (const occurrence of occurrences) {
        if (occurrence.getTime() < from.getTime() || occurrence.getTime() > to.getTime()) continue;
        entries.push({
          id: `holiday:${holiday.id}:${occurrence.toISOString().slice(0, 10)}`,
          source: 'holiday',
          calendarId: companyCalendarId ?? '',
          title: holiday.name,
          description: null,
          type: 'HOLIDAY',
          startAt: occurrence.toISOString(),
          endAt: new Date(occurrence.getTime() + DAY_MS - 1).toISOString(),
          allDay: true,
          location: null,
          visibility: 'TENANT',
          organizerEmployeeId: null,
          leaveRequestId: null,
          recurrenceRule: holiday.isRecurringYearly ? 'FREQ=YEARLY' : null,
          isCancelled: false,
          readOnly: true,
          attendees: [],
        });
      }
    }
    return entries;
  }

  private async loadEvent(id: string): Promise<EventRow> {
    const event = await this.prisma.client.calendarEvent.findFirst({ where: { id }, include: EVENT_INCLUDE });
    if (!event) throw new NotFoundError('Calendar event', 'EVENT_NOT_FOUND');
    if (event.isCancelled) throw new ConflictError('This event was cancelled', 'EVENT_CANCELLED');
    return event;
  }

  private assertCalendarWritable(
    principal: Principal,
    calendar: { type: string; ownerEmployeeId: string | null },
  ): void {
    if (calendar.type === 'PERSONAL' && this.scope.visibilityOf(principal) !== 'all') {
      if (!principal.employeeId || calendar.ownerEmployeeId !== principal.employeeId) {
        throw new ForbiddenError('You can only manage your own personal calendar', 'CALENDAR_NOT_OWNED');
      }
    }
  }

  private assertEventWritable(principal: Principal, event: EventRow): void {
    if (event.calendar.isReadOnly) throw new ForbiddenError('This calendar is read-only', 'CALENDAR_READ_ONLY');
    if (event.leaveRequestId) {
      throw new ForbiddenError('Leave events are managed by the leave module', 'EVENT_MIRRORED');
    }
    if (this.scope.visibilityOf(principal) === 'all') return;
    if (principal.employeeId && event.organizerEmployeeId === principal.employeeId) return;
    if (principal.employeeId && event.attendees.some((attendee) => attendee.employeeId === principal.employeeId)) return;
    throw new ForbiddenError('You cannot modify this event', 'EVENT_NOT_OWNED');
  }

  private async assertReferences(dto: CreateCalendarDto): Promise<void> {
    if (dto.departmentId) {
      const department = await this.prisma.client.department.findFirst({ where: { id: dto.departmentId } });
      if (!department) throw new NotFoundError('Department', 'DEPARTMENT_NOT_FOUND');
    }
    if (dto.teamId) {
      const team = await this.prisma.client.team.findFirst({ where: { id: dto.teamId } });
      if (!team) throw new NotFoundError('Team', 'TEAM_NOT_FOUND');
    }
  }

  /** `null` means "every calendar" (HR/admin scope). */
  private async calendarIdsFor(principal: Principal): Promise<string[] | null> {
    if (this.scope.visibilityOf(principal) === 'all') return null;
    const rows = await this.prisma.client.calendar.findMany({
      where: await this.calendarWhere(principal),
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async calendarWhere(principal: Principal): Promise<Record<string, unknown>> {
    if (this.scope.visibilityOf(principal) === 'all') return {};

    const employeeId = principal.employeeId;
    const or: Record<string, unknown>[] = [{ type: { in: ['COMPANY', 'HOLIDAY'] } }];
    if (!employeeId) return { OR: or };

    or.push({ ownerEmployeeId: employeeId });
    or.push({ team: { leadId: employeeId } });

    // `Calendar` has no department relation — the managed departments are resolved first.
    const managed = await this.prisma.client.department.findMany({
      where: { managerId: employeeId },
      select: { id: true },
    });
    if (managed.length > 0) or.push({ departmentId: { in: managed.map((department) => department.id) } });

    if (this.scope.visibilityOf(principal) === 'team') {
      const me = await this.prisma.client.employee.findFirst({
        where: { id: employeeId },
        select: { departmentId: true, teamId: true },
      });
      if (me?.departmentId) or.push({ departmentId: me.departmentId });
      if (me?.teamId) or.push({ teamId: me.teamId });
    }
    return { OR: or };
  }

  private async companyCalendar(db?: ScopedPrismaClient) {
    const client = db ?? this.prisma.client;
    const existing = await client.calendar.findFirst({
      where: { type: 'COMPANY' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (existing) return existing;

    this.logger.warn('No company calendar found — creating one');
    return client.calendar.create({
      data: tenantScoped({ name: 'Company calendar', type: 'COMPANY', isDefault: true }),
    });
  }

  private async companyCalendarId(): Promise<string | null> {
    const calendar = await this.prisma.client.calendar.findFirst({
      where: { type: 'COMPANY' },
      select: { id: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return calendar?.id ?? null;
  }
}

function startOfUtcDay(reference: Date = new Date()): Date {
  return new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate()));
}

/** Anniversary dates of a yearly recurring holiday that fall inside the range. */
function recurringOccurrences(date: Date, from: Date, to: Date): Date[] {
  const occurrences: Date[] = [];
  for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) {
    occurrences.push(
      new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate())),
    );
  }
  return occurrences;
}
