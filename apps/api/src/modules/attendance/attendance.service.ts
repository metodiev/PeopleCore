import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Paginated, Principal, PunchSource } from '@peoplecore/shared';
import type { AttendanceBreak, AttendanceEntry, WorkSchedule } from '../../generated/prisma/client.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { currentTenantId, tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  AttendanceQueryDto,
  ClockOutDto,
  CorrectionQueryDto,
  CreateCorrectionDto,
  DecideCorrectionDto,
  KioskPunchDto,
  MissingPunchesQueryDto,
  PunchDto,
  SummaryQueryDto,
} from './dto/attendance.dto.js';

const SORTABLE = ['date', 'createdAt', 'workedMinutes', 'overtimeMinutes', 'lateMinutes', 'status'] as const;
const DAY_MS = 86_400_000;
const MAX_MISSING_PUNCH_RANGE_DAYS = 62;

/** Used when the employee has no schedule and the tenant has no default one. */
const DEFAULT_SCHEDULE: ScheduleShape = {
  workDays: [1, 2, 3, 4, 5],
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  flexibleMinutes: 0,
};

interface ScheduleShape {
  workDays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  flexibleMinutes: number;
}

interface EmployeeRef {
  id: string;
  locationId: string | null;
  schedule: WorkSchedule | null;
  manager: { id: string; userId: string | null } | null;
}

interface PunchInput {
  source: PunchSource;
  at: Date;
  locationId?: string;
  latitude?: number;
  longitude?: number;
  gpsConsent?: boolean;
  notes?: string;
}

interface EntryTotals {
  workedMinutes: number | null;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
}

export interface RecordPunchInput {
  source: PunchSource;
  at?: Date;
  locationId?: string;
  latitude?: number;
  longitude?: number;
  gpsConsent?: boolean;
  notes?: string;
  actorUserId?: string | null;
}

export interface AttendanceCorrectionEvent {
  tenantId: string;
  correctionId: string;
  employeeId: string;
  managerUserId: string | null;
  date: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface MissingPunchRow {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  department: { id: string; name: string } | null;
  date: string;
  type: 'NO_CLOCK_OUT' | 'ABSENT';
  clockIn: string | null;
  clockOut: string | null;
}

/**
 * Attendance: punches, breaks, corrections and reporting.
 *
 * A single `AttendanceEntry` exists per employee and day. Clock-in/clock-out
 * are idempotent per day (a second punch is a conflict), worked and overtime
 * minutes are derived from the employee's schedule — the employee's own
 * schedule, else the assignment effective on that date, else the tenant
 * default, else 09:00–18:00 minus a 60 minute break.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Punches ───────────────────────────────────────────────────────────────

  async clockIn(principal: Principal, dto: PunchDto) {
    const employeeId = await this.resolveEmployeeId(principal, dto.employeeId);
    const employee = await this.loadEmployee(employeeId);
    const at = this.resolvePunchTime(principal, dto.at);
    const date = this.dayKey(at);

    const existing = await this.findEntry(employeeId, date);
    if (existing?.clockIn) throw new ConflictError('You have already clocked in for this day', 'ALREADY_CLOCKED_IN');

    const entry = await this.applyClockIn(employee, existing, { ...dto, at }, principal.userId);
    await this.audit.record({
      action: 'attendance.clockIn',
      entityType: 'AttendanceEntry',
      entityId: entry.id,
      actorUserId: principal.userId,
      before: existing,
      after: entry,
    });
    return this.detail(entry);
  }

  async clockOut(principal: Principal, dto: ClockOutDto) {
    const employeeId = await this.resolveEmployeeId(principal, dto.employeeId);
    const employee = await this.loadEmployee(employeeId);
    const at = this.resolvePunchTime(principal, dto.at);
    const date = this.dayKey(at);

    const existing = await this.findEntry(employeeId, date);
    if (!existing?.clockIn) throw new ConflictError('You have not clocked in for this day', 'NOT_CLOCKED_IN');
    if (existing.clockOut) throw new ConflictError('You have already clocked out for this day', 'ALREADY_CLOCKED_OUT');

    const entry = await this.applyClockOut(employee, existing, { source: dto.source ?? 'WEB', at, notes: dto.notes });
    await this.audit.record({
      action: 'attendance.clockOut',
      entityType: 'AttendanceEntry',
      entityId: entry.id,
      actorUserId: principal.userId,
      before: existing,
      after: entry,
    });
    return this.detail(entry);
  }

  /**
   * Records a punch without a signed-in user: used by the kiosk endpoint today
   * and by the future QR/NFC device endpoints. Resolves to a clock-in or a
   * clock-out depending on the state of the employee's day.
   */
  async recordPunch(
    tenantId: string,
    employeeId: string,
    input: RecordPunchInput,
  ): Promise<{ action: 'CLOCK_IN' | 'CLOCK_OUT'; entry: Awaited<ReturnType<AttendanceService['detail']>> }> {
    return this.prisma.forTenant(tenantId, async () => {
      const employee = await this.loadEmployee(employeeId);
      const at = input.at ?? new Date();
      const existing = await this.findEntry(employeeId, this.dayKey(at));

      if (existing?.clockIn && !existing.clockOut) {
        const entry = await this.applyClockOut(employee, existing, { ...input, at });
        await this.audit.record({
          action: 'attendance.clockOut',
          entityType: 'AttendanceEntry',
          entityId: entry.id,
          actorUserId: input.actorUserId ?? null,
          actorType: input.actorUserId ? 'USER' : 'SYSTEM',
          before: existing,
          after: entry,
        });
        return { action: 'CLOCK_OUT' as const, entry: await this.detail(entry) };
      }

      if (existing?.clockIn) throw new ConflictError('Attendance for this day is already complete', 'ATTENDANCE_COMPLETE');

      const entry = await this.applyClockIn(employee, existing, { ...input, at }, input.actorUserId ?? null);
      await this.audit.record({
        action: 'attendance.clockIn',
        entityType: 'AttendanceEntry',
        entityId: entry.id,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorUserId ? 'USER' : 'SYSTEM',
        before: existing,
        after: entry,
      });
      return { action: 'CLOCK_IN' as const, entry: await this.detail(entry) };
    });
  }

  /** Shared by the kiosk endpoint and the per-employee punch endpoints. */
  private async applyClockIn(
    employee: EmployeeRef,
    existing: AttendanceEntry | null,
    punch: PunchInput,
    actorUserId: string | null,
  ): Promise<AttendanceEntry> {
    const date = this.dayKey(punch.at);
    const schedule = await this.resolveSchedule(employee, date);
    const geo = await this.resolveGeo(employee, punch);
    const totals = this.computeTotals(schedule, date, punch.at, null, schedule.breakMinutes);
    const status = this.statusFor(punch.source, employee, totals.lateMinutes);

    const data = {
      clockIn: punch.at,
      status,
      source: punch.source,
      lateMinutes: totals.lateMinutes,
      // The schedule break is assumed until an actual break is recorded.
      breakMinutes: schedule.breakMinutes,
      clockInLocationId: punch.locationId ?? employee.locationId ?? null,
      clockInLat: geo.latitude,
      clockInLng: geo.longitude,
      gpsConsent: geo.consent,
      notes: punch.notes ?? existing?.notes ?? null,
      createdById: actorUserId,
    };

    const entry = existing
      ? await this.prisma.client.attendanceEntry.update({ where: { id: existing.id }, data })
      : await this.prisma.client.attendanceEntry.create({
          data: tenantScoped({ employeeId: employee.id, date, ...data }),
        });

    if (geo.consent) await this.recordGpsConsent(employee, actorUserId, punch.at);
    return entry;
  }

  private async applyClockOut(
    employee: EmployeeRef,
    entry: AttendanceEntry,
    punch: PunchInput,
  ): Promise<AttendanceEntry> {
    const schedule = await this.resolveSchedule(employee, entry.date);
    const breaks = await this.prisma.client.attendanceBreak.findMany({
      where: { attendanceEntryId: entry.id },
      orderBy: { startedAt: 'asc' },
    });
    const openBreaks = breaks.filter((row) => row.endedAt === null);
    if (openBreaks.length > 0) {
      const closed = breaks
        .filter((row) => row.endedAt !== null)
        .reduce((sum, row) => sum + (row.minutes ?? 0), 0);
      const running = openBreaks.reduce((sum, row) => sum + this.minutesBetween(row.startedAt, punch.at), 0);
      entry = { ...entry, breakMinutes: closed + running };
    }

    const totals = this.computeTotals(schedule, entry.date, entry.clockIn, punch.at, entry.breakMinutes);
    const status = entry.status === 'REMOTE' ? 'REMOTE' : totals.lateMinutes > 0 ? 'LATE' : 'PRESENT';

    return this.prisma.transaction(async (tx) => {
      for (const row of openBreaks) {
        await tx.attendanceBreak.update({
          where: { id: row.id },
          data: { endedAt: punch.at, minutes: this.minutesBetween(row.startedAt, punch.at) },
        });
      }
      return tx.attendanceEntry.update({
        where: { id: entry.id },
        data: {
          clockOut: punch.at,
          breakMinutes: entry.breakMinutes,
          status,
          ...(punch.notes ? { notes: punch.notes } : {}),
          ...totals,
        },
      });
    });
  }

  // ── Breaks ────────────────────────────────────────────────────────────────

  async startBreak(principal: Principal, dto: { employeeId?: string; at?: string }) {
    const employeeId = await this.resolveEmployeeId(principal, dto.employeeId);
    const at = this.resolvePunchTime(principal, dto.at);
    const entry = await this.requireOpenEntry(employeeId, at);

    const running = await this.prisma.client.attendanceBreak.findFirst({
      where: { attendanceEntryId: entry.id, endedAt: null },
    });
    if (running) throw new ConflictError('A break is already in progress', 'BREAK_IN_PROGRESS');

    const created = await this.prisma.client.attendanceBreak.create({
      data: tenantScoped({ attendanceEntryId: entry.id, startedAt: at }),
    });
    await this.audit.record({
      action: 'attendanceBreak.start',
      entityType: 'AttendanceBreak',
      entityId: created.id,
      actorUserId: principal.userId,
      after: created,
    });
    return created;
  }

  async endBreak(principal: Principal, dto: { employeeId?: string; at?: string }) {
    const employeeId = await this.resolveEmployeeId(principal, dto.employeeId);
    const at = this.resolvePunchTime(principal, dto.at);
    const entry = await this.requireOpenEntry(employeeId, at);

    const running = await this.prisma.client.attendanceBreak.findFirst({
      where: { attendanceEntryId: entry.id, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!running) throw new ConflictError('No break is in progress', 'NO_BREAK_IN_PROGRESS');
    if (at < running.startedAt) throw new ValidationError('The break cannot end before it started');

    const employee = await this.loadEmployee(employeeId);
    const schedule = await this.resolveSchedule(employee, entry.date);
    const minutes = this.minutesBetween(running.startedAt, at);
    const others = await this.prisma.client.attendanceBreak.findMany({
      where: { attendanceEntryId: entry.id, endedAt: { not: null } },
    });
    const breakMinutes = others.reduce((sum, row) => sum + (row.minutes ?? 0), 0) + minutes;
    const totals = this.computeTotals(schedule, entry.date, entry.clockIn, entry.clockOut, breakMinutes);

    const updated = await this.prisma.transaction(async (tx) => {
      const row = await tx.attendanceBreak.update({ where: { id: running.id }, data: { endedAt: at, minutes } });
      await tx.attendanceEntry.update({
        where: { id: entry.id },
        data: { breakMinutes, ...totals },
      });
      return row;
    });

    await this.audit.record({
      action: 'attendanceBreak.end',
      entityType: 'AttendanceBreak',
      entityId: updated.id,
      actorUserId: principal.userId,
      before: running,
      after: updated,
    });
    return this.detail(entry.id);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** The caller's own entry for today, or null when nothing was recorded yet. */
  async today(principal: Principal) {
    if (!principal.employeeId) {
      throw new ValidationError('Your user is not linked to an employee record');
    }
    const entry = await this.findEntry(principal.employeeId, this.dayKey(new Date()));
    return entry ? this.detail(entry) : null;
  }

  async list(principal: Principal, query: AttendanceQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { date: 'desc' });

    const filters: Record<string, unknown> = {};
    if (query.status) filters['status'] = query.status;
    if (query.from || query.to) {
      filters['date'] = {
        ...(query.from ? { gte: this.dayKey(new Date(query.from)) } : {}),
        ...(query.to ? { lte: this.dayKey(new Date(query.to)) } : {}),
      };
    }

    let employeeScope: Record<string, unknown>;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      employeeScope = { id: query.employeeId };
    } else {
      employeeScope = await this.scope.employeeWhere(
        principal,
        query.departmentId ? { departmentId: query.departmentId } : {},
      );
    }

    const where = { AND: [filters, { employee: employeeScope }] };
    const [rows, total] = await Promise.all([
      this.prisma.client.attendanceEntry.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          breaks: { orderBy: { startedAt: 'asc' } },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.client.attendanceEntry.count({ where }),
    ]);

    return paginate(
      rows.map((row) => {
        const { employee, ...entry } = row;
        return {
          ...this.serialize(entry, row.breaks),
          employee: {
            id: employee.id,
            employeeNumber: employee.employeeNumber,
            firstName: employee.firstName,
            lastName: employee.lastName,
            name: `${employee.firstName} ${employee.lastName}`,
            department: employee.department ?? null,
          },
        };
      }),
      total,
      query,
    );
  }

  /**
   * Days in the range with a clock-in but no clock-out, plus working days on
   * which the employee did not punch at all (holidays and approved leave are
   * not counted as missing).
   */
  async missingPunches(principal: Principal, query: MissingPunchesQueryDto): Promise<Paginated<MissingPunchRow>> {
    const to = query.to ? this.dayKey(new Date(query.to)) : this.dayKey(new Date());
    const from = query.from ? this.dayKey(new Date(query.from)) : new Date(to.getTime() - 6 * DAY_MS);
    if (from > to) throw new ValidationError('`from` must be on or before `to`');
    if ((to.getTime() - from.getTime()) / DAY_MS >= MAX_MISSING_PUNCH_RANGE_DAYS) {
      throw new ValidationError(`The missing-punches range is limited to ${MAX_MISSING_PUNCH_RANGE_DAYS} days`);
    }

    let employeeScope: Record<string, unknown>;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      employeeScope = { id: query.employeeId };
    } else {
      employeeScope = await this.scope.employeeWhere(
        principal,
        query.departmentId ? { departmentId: query.departmentId } : {},
      );
    }

    const employees = await this.prisma.client.employee.findMany({
      where: { AND: [employeeScope, { status: { not: 'TERMINATED' } }] },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        hireDate: true,
        department: { select: { id: true, name: true } },
        schedule: {
          select: { workDays: true, startTime: true, endTime: true, breakMinutes: true, flexibleMinutes: true },
        },
      },
      orderBy: { employeeNumber: 'asc' },
      take: 1000,
    });
    const employeeIds = employees.map((employee) => employee.id);

    const [entries, holidays, leave] = await Promise.all([
      this.prisma.client.attendanceEntry.findMany({
        where: { employeeId: { in: employeeIds }, date: { gte: from, lte: to } },
      }),
      this.prisma.client.holiday.findMany({ where: { date: { lte: to } } }),
      this.prisma.client.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
    ]);

    const entryByDay = new Map<string, AttendanceEntry>();
    for (const entry of entries) entryByDay.set(`${entry.employeeId}|${this.isoDate(entry.date)}`, entry);

    const holidayKeys = new Set<string>();
    for (const holiday of holidays) {
      for (const year of this.yearsBetween(from, to)) {
        holidayKeys.add(
          holiday.isRecurringYearly
            ? `${year}-${this.isoDate(holiday.date).slice(5)}`
            : this.isoDate(holiday.date),
        );
      }
    }

    const leaveKeys = new Set<string>();
    for (const request of leave) {
      for (let cursor = this.dayKey(request.startDate); cursor <= request.endDate; cursor = new Date(cursor.getTime() + DAY_MS)) {
        leaveKeys.add(`${request.employeeId}|${this.isoDate(cursor)}`);
      }
    }

    const rows: MissingPunchRow[] = [];
    for (const entry of entries) {
      if (!entry.clockIn || entry.clockOut) continue;
      const employee = employees.find((candidate) => candidate.id === entry.employeeId);
      rows.push({
        employeeId: entry.employeeId,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : '',
        employeeNumber: employee?.employeeNumber ?? '',
        department: employee?.department ?? null,
        date: this.isoDate(entry.date),
        type: 'NO_CLOCK_OUT',
        clockIn: entry.clockIn.toISOString(),
        clockOut: null,
      });
    }

    for (const employee of employees) {
      const workDays = new Set(employee.schedule?.workDays?.length ? employee.schedule.workDays : DEFAULT_SCHEDULE.workDays);
      const hired = this.isoDate(employee.hireDate);
      for (let cursor = new Date(from); cursor <= to; cursor = new Date(cursor.getTime() + DAY_MS)) {
        const key = this.isoDate(cursor);
        if (key < hired) continue;
        const isoWeekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
        if (!workDays.has(isoWeekday)) continue;
        if (holidayKeys.has(key)) continue;
        if (leaveKeys.has(`${employee.id}|${key}`)) continue;
        const entry = entryByDay.get(`${employee.id}|${key}`);
        if (entry?.clockIn) continue;
        rows.push({
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
          department: employee.department ?? null,
          date: key,
          type: 'ABSENT',
          clockIn: null,
          clockOut: null,
        });
      }
    }

    rows.sort((a, b) => (a.date === b.date ? a.employeeName.localeCompare(b.employeeName) : b.date.localeCompare(a.date)));
    const { skip, take } = buildQueryOptions(query, ['date'], { date: 'desc' });
    return paginate(rows.slice(skip, skip + take), rows.length, query);
  }

  async summary(principal: Principal, query: SummaryQueryDto) {
    const today = this.dayKey(new Date());
    const to = query.to ? this.dayKey(new Date(query.to)) : today;
    const from = query.from
      ? this.dayKey(new Date(query.from))
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    if (from > to) throw new ValidationError('`from` must be on or before `to`');

    let employeeScope: Record<string, unknown>;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      employeeScope = { id: query.employeeId };
    } else {
      employeeScope = await this.scope.employeeWhere(
        principal,
        query.departmentId ? { departmentId: query.departmentId } : {},
      );
    }

    const base = { AND: [{ date: { gte: from, lte: to } }, { employee: employeeScope }] };
    const [aggregate, lateDays, remoteDays, missingPunches, absentDays] = await Promise.all([
      this.prisma.client.attendanceEntry.aggregate({
        where: base,
        _sum: { workedMinutes: true, overtimeMinutes: true, breakMinutes: true },
        _count: { _all: true },
      }),
      this.prisma.client.attendanceEntry.count({ where: { AND: [base, { lateMinutes: { gt: 0 } }] } }),
      this.prisma.client.attendanceEntry.count({ where: { AND: [base, { status: 'REMOTE' }] } }),
      this.prisma.client.attendanceEntry.count({
        where: { AND: [base, { clockIn: { not: null }, clockOut: null }] },
      }),
      this.prisma.client.attendanceEntry.count({ where: { AND: [base, { clockIn: null }] } }),
    ]);

    const workedMinutes = aggregate._sum.workedMinutes ?? 0;
    const overtimeMinutes = aggregate._sum.overtimeMinutes ?? 0;
    const entries = aggregate._count._all;

    return {
      from: this.isoDate(from),
      to: this.isoDate(to),
      employeeId: query.employeeId ?? null,
      departmentId: query.departmentId ?? null,
      totals: {
        entries,
        workedMinutes,
        workedHours: this.round(workedMinutes / 60),
        overtimeMinutes,
        overtimeHours: this.round(overtimeMinutes / 60),
        breakMinutes: aggregate._sum.breakMinutes ?? 0,
        averageWorkedMinutes: entries > 0 ? Math.round(workedMinutes / entries) : 0,
        lateDays,
        remoteDays,
        missingPunches,
        absentDays,
      },
    };
  }

  // ── Corrections ───────────────────────────────────────────────────────────

  async requestCorrection(principal: Principal, dto: CreateCorrectionDto) {
    const employeeId = await this.resolveEmployeeId(principal, dto.employeeId);
    const employee = await this.loadEmployee(employeeId);
    const date = this.dayKey(new Date(dto.date));

    const requestedClockIn = dto.requestedClockIn ? this.combine(date, dto.requestedClockIn) : null;
    const requestedClockOut = dto.requestedClockOut ? this.combine(date, dto.requestedClockOut) : null;
    if (!requestedClockIn && !requestedClockOut && !dto.requestedStatus) {
      throw new ValidationError('Provide at least one of requestedClockIn, requestedClockOut or requestedStatus');
    }
    if (requestedClockIn && requestedClockOut && requestedClockOut <= requestedClockIn) {
      throw new ValidationError('requestedClockOut must be after requestedClockIn');
    }

    const existing = await this.prisma.client.attendanceCorrection.findFirst({
      where: { employeeId, date, status: 'PENDING' },
    });
    if (existing) throw new ConflictError('A correction for this day is already awaiting review', 'CORRECTION_PENDING');

    const entry = await this.findEntry(employeeId, date);
    const correction = await this.prisma.client.attendanceCorrection.create({
      data: tenantScoped({
        employeeId,
        attendanceEntryId: entry?.id ?? null,
        date,
        requestedClockIn,
        requestedClockOut,
        requestedStatus: dto.requestedStatus ?? null,
        reason: dto.reason,
        status: 'PENDING',
      }),
    });

    this.events.emit('attendance.correction.requested', {
      tenantId: currentTenantId(),
      correctionId: correction.id,
      employeeId,
      managerUserId: employee.manager?.userId ?? null,
      date: this.isoDate(date),
      status: 'PENDING',
    } satisfies AttendanceCorrectionEvent);

    await this.audit.record({
      action: 'attendanceCorrection.request',
      entityType: 'AttendanceCorrection',
      entityId: correction.id,
      actorUserId: principal.userId,
      after: correction,
    });
    return this.serializeCorrection(correction);
  }

  async listCorrections(principal: Principal, query: CorrectionQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, ['createdAt', 'date', 'status'], { createdAt: 'desc' });

    const filters: Record<string, unknown> = {};
    if (query.status) filters['status'] = query.status;
    if (query.from || query.to) {
      filters['date'] = {
        ...(query.from ? { gte: this.dayKey(new Date(query.from)) } : {}),
        ...(query.to ? { lte: this.dayKey(new Date(query.to)) } : {}),
      };
    }

    let employeeScope: Record<string, unknown>;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      employeeScope = { id: query.employeeId };
    } else {
      employeeScope = await this.scope.employeeWhere(principal);
    }

    const where = { AND: [filters, { employee: employeeScope }] };
    const [rows, total] = await Promise.all([
      this.prisma.client.attendanceCorrection.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeNumber: true,
              department: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.client.attendanceCorrection.count({ where }),
    ]);

    return paginate(
      rows.map((row) => {
        const { employee, ...correction } = row;
        return {
          ...this.serializeCorrection(correction),
          employee: {
            id: employee.id,
            employeeNumber: employee.employeeNumber,
            name: `${employee.firstName} ${employee.lastName}`,
            department: employee.department ?? null,
          },
        };
      }),
      total,
      query,
    );
  }

  /** Applies the requested times to the entry (creating it when missing). */
  async approveCorrection(principal: Principal, id: string, dto: DecideCorrectionDto) {
    const correction = await this.loadPendingCorrection(principal, id);
    const employee = await this.loadEmployee(correction.employeeId);
    const schedule = await this.resolveSchedule(employee, correction.date);
    const existing = await this.findEntry(correction.employeeId, correction.date);

    const clockIn = correction.requestedClockIn ?? existing?.clockIn ?? null;
    const clockOut = correction.requestedClockOut ?? existing?.clockOut ?? null;
    const status = correction.requestedStatus ?? existing?.status ?? 'PRESENT';
    const breakMinutes = existing?.breakMinutes ?? schedule.breakMinutes;
    const totals = this.computeTotals(schedule, correction.date, clockIn, clockOut, breakMinutes);

    const applied = await this.prisma.transaction(async (tx) => {
      const entry = existing
        ? await tx.attendanceEntry.update({
            where: { id: existing.id },
            data: { clockIn, clockOut, status, source: 'MANUAL', breakMinutes, ...totals },
          })
        : await tx.attendanceEntry.create({
            data: tenantScoped({
              employeeId: correction.employeeId,
              date: correction.date,
              clockIn,
              clockOut,
              status,
              source: 'MANUAL',
              breakMinutes,
              createdById: principal.userId,
              notes: `Correction approved: ${correction.reason}`,
              ...totals,
            }),
          });

      const updated = await tx.attendanceCorrection.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: principal.userId,
          reviewedAt: new Date(),
          reviewNote: dto.reviewNote ?? null,
          attendanceEntryId: entry.id,
        },
      });
      return { entry, correction: updated };
    });

    this.events.emit('attendance.correction.approved', {
      tenantId: currentTenantId(),
      correctionId: id,
      employeeId: correction.employeeId,
      managerUserId: principal.userId,
      date: this.isoDate(correction.date),
      status: 'APPROVED',
    } satisfies AttendanceCorrectionEvent);

    await this.audit.record({
      action: 'attendanceCorrection.approve',
      entityType: 'AttendanceCorrection',
      entityId: id,
      actorUserId: principal.userId,
      before: correction,
      after: applied.correction,
    });
    await this.audit.record({
      action: 'attendanceEntry.correct',
      entityType: 'AttendanceEntry',
      entityId: applied.entry.id,
      actorUserId: principal.userId,
      before: existing,
      after: applied.entry,
      metadata: { correctionId: id },
    });

    return { ...this.serializeCorrection(applied.correction), entry: this.serialize(applied.entry) };
  }

  async rejectCorrection(principal: Principal, id: string, dto: DecideCorrectionDto) {
    const correction = await this.loadPendingCorrection(principal, id);
    const updated = await this.prisma.client.attendanceCorrection.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: principal.userId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote ?? null,
      },
    });

    this.events.emit('attendance.correction.rejected', {
      tenantId: currentTenantId(),
      correctionId: id,
      employeeId: correction.employeeId,
      managerUserId: principal.userId,
      date: this.isoDate(correction.date),
      status: 'REJECTED',
    } satisfies AttendanceCorrectionEvent);

    await this.audit.record({
      action: 'attendanceCorrection.reject',
      entityType: 'AttendanceCorrection',
      entityId: id,
      actorUserId: principal.userId,
      before: correction,
      after: updated,
    });
    return this.serializeCorrection(updated);
  }

  // ── Kiosk ─────────────────────────────────────────────────────────────────

  /**
   * Kiosk punch: resolves the employee by number and toggles clock-in/out.
   * Shared devices are not authenticated yet — the endpoint is protected by
   * `attendance.manage` until device tokens are introduced.
   */
  async kioskPunch(principal: Principal, dto: KioskPunchDto) {
    const employee = await this.prisma.client.employee.findFirst({
      where: { employeeNumber: dto.employeeNumber },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const result = await this.recordPunch(principal.tenantId ?? currentTenantId(), employee.id, {
      source: dto.source ?? 'KIOSK',
      at: dto.at ? new Date(dto.at) : new Date(),
      locationId: dto.locationId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      gpsConsent: dto.gpsConsent,
      notes: dto.notes,
      actorUserId: principal.userId,
    });

    await this.audit.record({
      action: 'attendance.kiosk.punch',
      entityType: 'AttendanceEntry',
      entityId: result.entry.id,
      actorUserId: principal.userId,
      metadata: { action: result.action, deviceId: dto.deviceId ?? null },
    });

    return {
      action: result.action,
      entry: result.entry,
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        name: `${employee.firstName} ${employee.lastName}`,
      },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async loadPendingCorrection(principal: Principal, id: string) {
    const correction = await this.prisma.client.attendanceCorrection.findFirst({ where: { id } });
    if (!correction) throw new NotFoundError('Attendance correction', 'CORRECTION_NOT_FOUND');
    if (correction.status !== 'PENDING') {
      throw new ConflictError('This correction has already been decided', 'CORRECTION_DECIDED');
    }
    await this.scope.assertEmployeeAccess(principal, correction.employeeId);
    if (principal.employeeId && principal.employeeId === correction.employeeId) {
      throw new ForbiddenError('You cannot decide your own attendance correction', 'SELF_APPROVAL');
    }
    return correction;
  }

  private async requireOpenEntry(employeeId: string, at: Date): Promise<AttendanceEntry> {
    const entry = await this.findEntry(employeeId, this.dayKey(at));
    if (!entry?.clockIn) throw new ConflictError('You have not clocked in yet', 'NOT_CLOCKED_IN');
    if (entry.clockOut) throw new ConflictError('This attendance entry is already closed', 'ATTENDANCE_CLOSED');
    return entry;
  }

  private async loadEmployee(employeeId: string): Promise<EmployeeRef> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: employeeId },
      select: {
        id: true,
        locationId: true,
        schedule: true,
        manager: { select: { id: true, userId: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    return employee;
  }

  /** Employee the punch applies to, guarded by data scope and permission. */
  private async resolveEmployeeId(principal: Principal, employeeId?: string): Promise<string> {
    const target = employeeId ?? principal.employeeId;
    if (!target) throw new ValidationError('Your user is not linked to an employee record');
    if (target !== principal.employeeId && !this.canManage(principal)) {
      throw new ForbiddenError(
        'Only attendance managers can record attendance for another employee',
        'ATTENDANCE_SCOPE_DENIED',
      );
    }
    await this.scope.assertEmployeeAccess(principal, target);
    return target;
  }

  private canManage(principal: Principal): boolean {
    return principal.isSuperAdmin || principal.permissions.includes('attendance.manage');
  }

  /** `at` is an HR/kiosk backfill; regular self-service punches always use now. */
  private resolvePunchTime(principal: Principal, at?: string): Date {
    if (!at) return new Date();
    if (!this.canManage(principal)) {
      throw new ForbiddenError(
        'Only attendance managers can record a punch for a specific time',
        'PUNCH_TIME_FORBIDDEN',
      );
    }
    const parsed = new Date(at);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError('`at` must be a valid ISO 8601 date-time');
    return parsed;
  }

  private async resolveSchedule(employee: EmployeeRef, date: Date): Promise<ScheduleShape> {
    if (employee.schedule) return this.toShape(employee.schedule);

    const assignment = await this.prisma.client.scheduleAssignment.findFirst({
      where: {
        employeeId: employee.id,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      include: { schedule: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (assignment?.schedule) return this.toShape(assignment.schedule);

    const fallback = await this.prisma.client.workSchedule.findFirst({ where: { isDefault: true } });
    return fallback ? this.toShape(fallback) : { ...DEFAULT_SCHEDULE };
  }

  private toShape(schedule: {
    workDays: number[];
    startTime: string;
    endTime: string;
    breakMinutes: number;
    flexibleMinutes: number;
  }): ScheduleShape {
    return {
      workDays: schedule.workDays.length > 0 ? schedule.workDays : DEFAULT_SCHEDULE.workDays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      breakMinutes: schedule.breakMinutes,
      flexibleMinutes: schedule.flexibleMinutes,
    };
  }

  /**
   * Validates GPS input against company privacy settings and the geofence of
   * the punch location. Coordinates are only stored when tracking is enabled;
   * a location outside the geofence blocks the punch.
   */
  private async resolveGeo(
    employee: EmployeeRef,
    punch: PunchInput,
  ): Promise<{ latitude: number | null; longitude: number | null; consent: boolean }> {
    const hasCoordinates = punch.latitude !== undefined || punch.longitude !== undefined;
    if (!hasCoordinates) return { latitude: null, longitude: null, consent: false };
    if (punch.latitude === undefined || punch.longitude === undefined) {
      throw new ValidationError('Both latitude and longitude are required for a GPS punch');
    }

    const settings = await this.prisma.client.tenantPrivacySettings.findUnique({
      where: { tenantId: currentTenantId() },
    });
    if (!settings?.gpsTrackingEnabled) {
      throw new ValidationError(
        'GPS attendance is disabled for this company — an administrator must enable it in the privacy settings',
      );
    }
    if (settings.gpsConsentRequired && punch.gpsConsent === false) {
      throw new ValidationError('GPS consent is required to record your location');
    }

    const locationId = punch.locationId ?? employee.locationId;
    if (locationId) {
      const location = await this.prisma.client.location.findFirst({ where: { id: locationId } });
      if (!location) throw new NotFoundError('Location', 'LOCATION_NOT_FOUND');
      if (
        location.geofenceRadiusM !== null &&
        location.latitude !== null &&
        location.longitude !== null
      ) {
        const distance = this.distanceMeters(
          location.latitude,
          location.longitude,
          punch.latitude,
          punch.longitude,
        );
        if (distance > location.geofenceRadiusM) {
          throw new ValidationError(
            `You are ${Math.round(distance)} m away from ${location.name}; the geofence allows ${location.geofenceRadiusM} m`,
          );
        }
      }
    }

    return { latitude: punch.latitude, longitude: punch.longitude, consent: punch.gpsConsent === true };
  }

  /** One consent record per employee per day is enough for GPS processing. */
  private async recordGpsConsent(employee: EmployeeRef, actorUserId: string | null, at: Date): Promise<void> {
    const start = this.dayKey(at);
    const end = new Date(start.getTime() + DAY_MS);
    const existing = await this.prisma.client.consentRecord.findFirst({
      where: {
        employeeId: employee.id,
        type: 'GPS_TRACKING',
        granted: true,
        revokedAt: null,
        grantedAt: { gte: start, lt: end },
      },
    });
    if (existing) return;

    await this.prisma.client.consentRecord.create({
      data: tenantScoped({
        employeeId: employee.id,
        userId: actorUserId,
        type: 'GPS_TRACKING',
        granted: true,
        version: 'v1',
        source: 'attendance.clock-in',
      }),
    });
  }

  /** REMOTE punches are those made from a mobile/GPS source without a work location. */
  private statusFor(source: PunchSource, employee: EmployeeRef, lateMinutes: number) {
    if ((source === 'GPS' || source === 'MOBILE') && !employee.locationId) return 'REMOTE' as const;
    return lateMinutes > 0 ? ('LATE' as const) : ('PRESENT' as const);
  }

  private computeTotals(
    schedule: ScheduleShape,
    day: Date,
    clockIn: Date | null,
    clockOut: Date | null,
    breakMinutes: number,
  ): EntryTotals {
    const start = this.timeOnDay(day, schedule.startTime);
    const end = this.timeOnDay(day, schedule.endTime);
    const plannedMinutes = Math.max(0, this.minutesBetween(start, end) - schedule.breakMinutes);
    const lateMinutes = clockIn ? Math.max(0, this.minutesBetween(start, clockIn) - schedule.flexibleMinutes) : 0;
    const earlyLeaveMinutes = clockOut ? Math.max(0, this.minutesBetween(clockOut, end)) : 0;

    if (!clockIn || !clockOut) return { workedMinutes: null, overtimeMinutes: 0, lateMinutes, earlyLeaveMinutes };
    const workedMinutes = Math.max(0, this.minutesBetween(clockIn, clockOut) - breakMinutes);
    return { workedMinutes, overtimeMinutes: Math.max(0, workedMinutes - plannedMinutes), lateMinutes, earlyLeaveMinutes };
  }

  private async findEntry(employeeId: string, date: Date): Promise<AttendanceEntry | null> {
    return this.prisma.client.attendanceEntry.findFirst({ where: { employeeId, date } });
  }

  /** The entry plus its breaks, with dates normalised for the API. */
  private async detail(entryOrId: AttendanceEntry | string) {
    const entry =
      typeof entryOrId === 'string'
        ? await this.prisma.client.attendanceEntry.findFirst({ where: { id: entryOrId } })
        : entryOrId;
    if (!entry) throw new NotFoundError('Attendance entry', 'ATTENDANCE_NOT_FOUND');
    const breaks = await this.prisma.client.attendanceBreak.findMany({
      where: { attendanceEntryId: entry.id },
      orderBy: { startedAt: 'asc' },
    });
    return this.serialize(entry, breaks);
  }

  private serialize(entry: AttendanceEntry, breaks: AttendanceBreak[] = []) {
    return {
      ...entry,
      date: this.isoDate(entry.date),
      clockIn: entry.clockIn?.toISOString() ?? null,
      clockOut: entry.clockOut?.toISOString() ?? null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      breaks: breaks.map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private serializeCorrection(correction: {
    date: Date;
    requestedClockIn: Date | null;
    requestedClockOut: Date | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
  }) {
    return {
      ...correction,
      date: this.isoDate(correction.date),
      requestedClockIn: correction.requestedClockIn?.toISOString() ?? null,
      requestedClockOut: correction.requestedClockOut?.toISOString() ?? null,
      reviewedAt: correction.reviewedAt?.toISOString() ?? null,
      createdAt: correction.createdAt.toISOString(),
      updatedAt: correction.updatedAt.toISOString(),
    };
  }

  /** Normalises any timestamp to the UTC midnight stored in `@db.Date` columns. */
  private dayKey(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private timeOnDay(day: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map((part) => Number(part));
    return new Date(day.getTime() + (hours ?? 0) * 3_600_000 + (minutes ?? 0) * 60_000);
  }

  private minutesBetween(from: Date, to: Date): number {
    return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  }

  private yearsBetween(from: Date, to: Date): number[] {
    const years: number[] = [];
    for (let year = from.getUTCFullYear(); year <= to.getUTCFullYear(); year += 1) years.push(year);
    return years;
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /** Great-circle distance in meters. */
  private distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const radius = 6_371_000;
    const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a =
      Math.sin(deltaLat / 2) ** 2 +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** Accepts `HH:MM` times (combined with the correction date) or ISO date-times. */
  private combine(day: Date, value: string): Date {
    if (/^\d{1,2}:\d{2}$/.test(value)) {
      const [hours, minutes] = value.split(':').map((part) => Number(part));
      if ((hours ?? 0) > 23 || (minutes ?? 0) > 59) {
        throw new ValidationError(`Invalid time "${value}" — expected HH:MM`);
      }
      return new Date(day.getTime() + (hours ?? 0) * 3_600_000 + (minutes ?? 0) * 60_000);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ValidationError(`Invalid time "${value}" — use HH:MM or an ISO 8601 date-time`);
    }
    return parsed;
  }
}
