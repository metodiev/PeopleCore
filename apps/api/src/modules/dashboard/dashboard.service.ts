import { Injectable } from '@nestjs/common';
import type { Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ScopeService } from '../employees/scope.service.js';

const DAY_MS = 86_400_000;
const PENDING_REQUEST_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_EMPLOYEE'] as const;
/** Licence seats per plan unless the tenant overrides them in `settings.licenses`. */
const PLAN_SEATS: Readonly<Record<string, number>> = {
  FREE: 5,
  STARTER: 25,
  PROFESSIONAL: 100,
  ENTERPRISE: 1000,
};

/**
 * Role-specific dashboards. Every figure is computed from live tenant-scoped
 * queries — nothing is cached, seeded or hardcoded. Row-level visibility
 * follows {@link ScopeService}, so a manager's roll-ups describe their own
 * organisation unit.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  // ── Employee dashboard ────────────────────────────────────────────────────

  async me(principal: Principal) {
    const today = startOfToday();
    const in30Days = addDays(today, 30);
    const employeeId = principal.employeeId;
    const year = new Date().getUTCFullYear();

    if (!employeeId) {
      return {
        employee: null,
        attendance: null,
        schedule: null,
        leave: { year, balances: [], remainingDays: 0 },
        upcomingLeave: [],
        calendar: { today: [], upcoming: [] },
        pendingRequests: { leave: 0, expenses: 0, corrections: 0, hr: 0, total: 0 },
        unreadNotifications: await this.unreadNotifications(principal.userId),
        expiringDocuments: [],
      };
    }

    const [
      employee,
      attendance,
      balances,
      upcomingLeave,
      events,
      pendingLeave,
      pendingExpenses,
      pendingCorrections,
      pendingHr,
      unreadNotifications,
      expiringDocuments,
    ] = await Promise.all([
      this.prisma.client.employee.findFirst({
        where: { id: employeeId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeNumber: true,
          workEmail: true,
          photoUrl: true,
          status: true,
          hireDate: true,
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          schedule: {
            select: { id: true, name: true, type: true, startTime: true, endTime: true, breakMinutes: true, workDays: true },
          },
        },
      }),
      this.prisma.client.attendanceEntry.findFirst({ where: { employeeId, date: today } }),
      this.prisma.client.leaveBalance.findMany({
        where: { employeeId, year },
        include: { leaveType: { select: { id: true, key: true, name: true, color: true } } },
      }),
      this.prisma.client.leaveRequest.findMany({
        where: { employeeId, status: { in: ['APPROVED', 'PENDING'] }, endDate: { gte: today } },
        orderBy: { startDate: 'asc' },
        take: 10,
        include: { leaveType: { select: { name: true, color: true } } },
      }),
      this.prisma.client.calendarEvent.findMany({
        where: {
          OR: [{ organizerEmployeeId: employeeId }, { attendees: { some: { employeeId } } }],
          startAt: { gte: today, lte: in30Days },
          isCancelled: false,
        },
        orderBy: { startAt: 'asc' },
        take: 20,
        select: {
          id: true,
          title: true,
          type: true,
          startAt: true,
          endAt: true,
          allDay: true,
          location: true,
          calendarId: true,
        },
      }),
      this.prisma.client.leaveRequest.count({ where: { employeeId, status: 'PENDING' } }),
      this.prisma.client.expense.count({ where: { employeeId, status: { in: ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'] } } }),
      this.prisma.client.attendanceCorrection.count({ where: { employeeId, status: 'PENDING' } }),
      this.prisma.client.hRRequest.count({ where: { employeeId, status: { in: [...PENDING_REQUEST_STATUSES] } } }),
      this.unreadNotifications(principal.userId),
      this.prisma.client.document.findMany({
        where: { employeeId, status: 'ACTIVE', expiresAt: { not: null, lte: in30Days } },
        orderBy: { expiresAt: 'asc' },
        take: 10,
        select: { id: true, name: true, expiresAt: true, category: { select: { name: true } } },
      }),
    ]);

    const todayEnd = new Date(today.getTime() + DAY_MS);
    return {
      employee,
      attendance: attendance
        ? {
            id: attendance.id,
            date: attendance.date,
            status: attendance.status,
            clockIn: attendance.clockIn,
            clockOut: attendance.clockOut,
            workedMinutes: attendance.workedMinutes ?? 0,
            lateMinutes: attendance.lateMinutes,
            overtimeMinutes: attendance.overtimeMinutes,
            breakMinutes: attendance.breakMinutes,
          }
        : { id: null, date: today, status: null, clockIn: null, clockOut: null, workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, breakMinutes: 0 },
      schedule: employee?.schedule ?? null,
      leave: {
        year,
        balances: balances.map((balance) => ({
          leaveTypeId: balance.leaveTypeId,
          leaveType: balance.leaveType.name,
          leaveTypeKey: balance.leaveType.key,
          color: balance.leaveType.color,
          entitled: Number(balance.entitled),
          accrued: Number(balance.accrued),
          carriedOver: Number(balance.carriedOver),
          adjustment: Number(balance.adjustment),
          used: Number(balance.used),
          pending: Number(balance.pending),
          remaining: leaveRemaining(balance),
        })),
        remainingDays: round(balances.reduce((sum, balance) => sum + leaveRemaining(balance), 0), 2),
      },
      upcomingLeave: upcomingLeave.map((request) => ({
        id: request.id,
        leaveType: request.leaveType.name,
        color: request.leaveType.color,
        status: request.status,
        startDate: request.startDate,
        endDate: request.endDate,
        days: Number(request.daysRequested),
        startHalfDay: request.startHalfDay,
        endHalfDay: request.endHalfDay,
      })),
      calendar: {
        today: events.filter((event) => event.startAt < todayEnd),
        upcoming: events.filter((event) => event.startAt >= todayEnd),
      },
      pendingRequests: {
        leave: pendingLeave,
        expenses: pendingExpenses,
        corrections: pendingCorrections,
        hr: pendingHr,
        total: pendingLeave + pendingExpenses + pendingCorrections + pendingHr,
      },
      unreadNotifications,
      expiringDocuments: expiringDocuments.map((document) => ({
        id: document.id,
        name: document.name,
        category: document.category?.name ?? null,
        expiresAt: document.expiresAt,
        daysLeft: document.expiresAt ? daysUntil(document.expiresAt) : null,
      })),
    };
  }

  // ── Manager dashboard ────────────────────────────────────────────────────

  async manager(principal: Principal) {
    const today = startOfToday();
    const in30Days = addDays(today, 30);
    const in60Days = addDays(today, 60);

    const teamWhere = await this.scope.employeeWhere(
      principal,
      principal.employeeId ? { id: { not: principal.employeeId } } : {},
    );
    const team = await this.prisma.client.employee.findMany({
      where: teamWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        photoUrl: true,
        status: true,
        birthDate: true,
        hireDate: true,
        department: { select: { id: true, name: true } },
      },
    });
    const teamIds = team.map((member) => member.id);

    const [attendance, teamLeave, leaveApprovals, expenseApprovals, correctionApprovals, expiringContracts] =
      await Promise.all([
        this.prisma.client.attendanceEntry.groupBy({
          by: ['status'],
          where: { date: today, employeeId: { in: teamIds } },
          _count: { _all: true },
        }),
        this.prisma.client.leaveRequest.findMany({
          where: {
            employeeId: { in: teamIds },
            status: 'APPROVED',
            startDate: { lte: in30Days },
            endDate: { gte: today },
          },
          orderBy: { startDate: 'asc' },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
            leaveType: { select: { name: true, color: true } },
          },
        }),
        this.prisma.client.leaveRequest.findMany({
          where: {
            status: 'PENDING',
            approvals: { some: { status: 'PENDING', approverId: principal.userId } },
          },
          select: { id: true, employeeId: true, startDate: true, endDate: true },
          take: 50,
          orderBy: { startDate: 'asc' },
        }),
        this.prisma.client.expense.findMany({
          where: { status: 'SUBMITTED', employeeId: { in: teamIds } },
          select: { id: true, employeeId: true, amount: true },
          take: 50,
          orderBy: { submittedAt: 'asc' },
        }),
        this.prisma.client.attendanceCorrection.findMany({
          where: { status: 'PENDING', employeeId: { in: teamIds } },
          select: { id: true, employeeId: true, date: true },
          take: 50,
          orderBy: { date: 'asc' },
        }),
        this.prisma.client.contract.findMany({
          where: {
            employeeId: { in: teamIds },
            status: 'ACTIVE',
            OR: [
              { endDate: { not: null, gte: today, lte: in60Days } },
              { probationEndDate: { not: null, gte: today, lte: in30Days } },
            ],
          },
          select: {
            id: true,
            type: true,
            endDate: true,
            probationEndDate: true,
            employee: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ]);

    const attendanceByStatus = new Map(attendance.map((entry) => [entry.status, entry._count._all]));
    const present = attendanceByStatus.get('PRESENT') ?? 0;
    const late = attendanceByStatus.get('LATE') ?? 0;
    const absent = attendanceByStatus.get('ABSENT') ?? 0;
    const remote = attendanceByStatus.get('REMOTE') ?? 0;
    const onLeave = attendanceByStatus.get('LEAVE') ?? 0;
    const holiday = attendanceByStatus.get('HOLIDAY') ?? 0;
    const halfDay = attendanceByStatus.get('HALF_DAY') ?? 0;
    const accounted = present + late + absent + remote + onLeave + holiday + halfDay;

    return {
      teamSize: team.length,
      attendanceToday: {
        date: today,
        present,
        late,
        absent,
        remote,
        onLeave,
        holiday,
        halfDay,
        notClockedIn: Math.max(0, team.length - accounted),
        total: team.length,
      },
      teamLeave: teamLeave.map((request) => ({
        id: request.id,
        employee: {
          id: request.employee.id,
          name: `${request.employee.firstName} ${request.employee.lastName}`,
          photoUrl: request.employee.photoUrl,
        },
        leaveType: request.leaveType.name,
        color: request.leaveType.color,
        startDate: request.startDate,
        endDate: request.endDate,
        days: Number(request.daysRequested),
        status: request.status,
      })),
      pendingApprovals: {
        leave: { count: leaveApprovals.length, ids: leaveApprovals.map((request) => request.id) },
        expenses: { count: expenseApprovals.length, ids: expenseApprovals.map((expense) => expense.id) },
        corrections: { count: correctionApprovals.length, ids: correctionApprovals.map((correction) => correction.id) },
      },
      pendingApprovalsTotal: leaveApprovals.length + expenseApprovals.length + correctionApprovals.length,
      upcomingBirthdays: team
        .filter((member) => member.birthDate !== null && member.status !== 'TERMINATED')
        .map((member) => ({
          employeeId: member.id,
          name: `${member.firstName} ${member.lastName}`,
          birthDate: member.birthDate,
          daysUntil: daysUntilNextOccurrence(member.birthDate as Date, today),
        }))
        .filter((entry) => entry.daysUntil <= 30)
        .sort((a, b) => a.daysUntil - b.daysUntil),
      expiring: {
        contracts: expiringContracts
          .filter((contract) => contract.endDate !== null)
          .map((contract) => ({
            id: contract.id,
            type: contract.type,
            employeeId: contract.employee.id,
            employee: `${contract.employee.firstName} ${contract.employee.lastName}`,
            endDate: contract.endDate,
            daysLeft: contract.endDate ? daysUntil(contract.endDate, today) : null,
          })),
        probations: expiringContracts
          .filter((contract) => contract.probationEndDate !== null)
          .map((contract) => ({
            id: contract.id,
            type: contract.type,
            employeeId: contract.employee.id,
            employee: `${contract.employee.firstName} ${contract.employee.lastName}`,
            probationEndDate: contract.probationEndDate,
            daysLeft: contract.probationEndDate ? daysUntil(contract.probationEndDate, today) : null,
          })),
      },
      upcomingAnniversaries: team
        .filter((member) => member.status === 'ACTIVE' || member.status === 'PROBATION')
        .map((member) => {
          const daysUntilAnniversary = daysUntilNextOccurrence(member.hireDate, today);
          return {
            employeeId: member.id,
            name: `${member.firstName} ${member.lastName}`,
            hireDate: member.hireDate,
            years: anniversaryYears(member.hireDate, today, daysUntilAnniversary),
            daysUntil: daysUntilAnniversary,
          };
        })
        .filter((entry) => entry.daysUntil <= 30)
        .sort((a, b) => a.daysUntil - b.daysUntil),
    };
  }

  // ── HR dashboard ─────────────────────────────────────────────────────────

  async hr(principal: Principal) {
    const today = startOfToday();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1));
    const in30Days = addDays(today, 30);
    const in60Days = addDays(today, 60);
    const last30Days = addDays(today, -30);
    const twelveMonthsAgo = addDays(today, -365);

    const employeeScope = await this.scope.employeeWhere(principal);

    const [
      total,
      active,
      probation,
      onLeave,
      newHires,
      leavers,
      byDepartment,
      approvedLeave,
      attendanceGroups,
      expiringContracts,
      expiringDocuments,
      expiringCertifications,
      terminations12Months,
      openRequests,
    ] = await Promise.all([
      this.prisma.client.employee.count({ where: employeeScope }),
      this.prisma.client.employee.count({ where: { AND: [employeeScope, { status: 'ACTIVE' }] } }),
      this.prisma.client.employee.count({ where: { AND: [employeeScope, { status: 'PROBATION' }] } }),
      this.prisma.client.employee.count({ where: { AND: [employeeScope, { status: 'ON_LEAVE' }] } }),
      this.prisma.client.employee.count({ where: { AND: [employeeScope, { hireDate: { gte: monthStart, lt: nextMonthStart } }] } }),
      this.prisma.client.employee.count({
        where: { AND: [employeeScope, { terminationDate: { gte: monthStart, lt: nextMonthStart } }] },
      }),
      this.prisma.client.employee.groupBy({
        by: ['departmentId'],
        where: employeeScope,
        _count: { _all: true },
      }),
      this.prisma.client.leaveRequest.findMany({
        where: {
          employee: employeeScope,
          status: 'APPROVED',
          startDate: { lt: yearEnd },
          endDate: { gte: yearStart },
        },
        select: { daysRequested: true, leaveType: { select: { name: true } } },
      }),
      this.prisma.client.attendanceEntry.groupBy({
        by: ['status'],
        where: { employee: employeeScope, date: { gte: last30Days, lte: today } },
        _count: { _all: true },
      }),
      this.prisma.client.contract.findMany({
        where: {
          employee: employeeScope,
          status: 'ACTIVE',
          OR: [
            { endDate: { not: null, gte: today, lte: in60Days } },
            { probationEndDate: { not: null, gte: today, lte: in30Days } },
          ],
        },
        select: { id: true, endDate: true, probationEndDate: true, employeeId: true },
      }),
      this.prisma.client.document.count({
        where: { employee: employeeScope, status: 'ACTIVE', expiresAt: { not: null, lte: in30Days } },
      }),
      this.prisma.client.certification.count({
        where: { employee: employeeScope, status: { in: ['VALID', 'EXPIRING'] }, expiresAt: { not: null, lte: in60Days } },
      }),
      this.prisma.client.employee.count({ where: { AND: [employeeScope, { terminationDate: { gte: twelveMonthsAgo } }] } }),
      this.prisma.client.hRRequest.groupBy({
        by: ['priority'],
        where: { employee: employeeScope, status: { in: [...PENDING_REQUEST_STATUSES] } },
        _count: { _all: true },
      }),
    ]);

    const departments = await this.prisma.client.department.findMany({
      where: { id: { in: byDepartment.map((group) => group.departmentId).filter((id): id is string => id !== null) } },
      select: { id: true, name: true },
    });
    const departmentNameById = new Map(departments.map((department) => [department.id, department.name]));

    const attendanceByStatus = new Map(attendanceGroups.map((entry) => [entry.status, entry._count._all]));
    const tracked = attendanceGroups
      .filter((entry) => !['WEEKEND', 'HOLIDAY'].includes(entry.status))
      .reduce((sum, entry) => sum + entry._count._all, 0);
    const attended =
      (attendanceByStatus.get('PRESENT') ?? 0) +
      (attendanceByStatus.get('LATE') ?? 0) +
      (attendanceByStatus.get('REMOTE') ?? 0);

    const leaveByType = new Map<string, { days: number; requests: number }>();
    for (const request of approvedLeave) {
      const entry = leaveByType.get(request.leaveType.name) ?? { days: 0, requests: 0 };
      entry.days = round(entry.days + Number(request.daysRequested), 2);
      entry.requests += 1;
      leaveByType.set(request.leaveType.name, entry);
    }

    // Turnover: leavers over the average of the opening and closing headcount.
    const openingHeadcount = Math.max(0, total - newHires + leavers - terminations12Months);
    const averageHeadcount = (openingHeadcount + total) / 2;

    const openByPriority: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 0, URGENT: 0 };
    for (const group of openRequests) {
      openByPriority[group.priority] = group._count._all;
    }

    return {
      headcount: {
        total,
        active,
        probation,
        onLeave,
        newHiresThisMonth: newHires,
        leaversThisMonth: leavers,
        byDepartment: byDepartment
          .map((group) => ({
            departmentId: group.departmentId,
            department: group.departmentId ? (departmentNameById.get(group.departmentId) ?? 'Unknown') : 'Unassigned',
            count: group._count._all,
          }))
          .sort((a, b) => b.count - a.count),
      },
      leaveStatistics: {
        year: today.getUTCFullYear(),
        approvedRequests: approvedLeave.length,
        approvedDays: round(
          approvedLeave.reduce((sum, request) => sum + Number(request.daysRequested), 0),
          2,
        ),
        byType: [...leaveByType.entries()]
          .map(([leaveType, entry]) => ({ leaveType, days: entry.days, requests: entry.requests }))
          .sort((a, b) => b.days - a.days),
      },
      attendance: {
        periodDays: 30,
        trackedEntries: tracked,
        attendanceRate: tracked === 0 ? 0 : round((attended / tracked) * 100, 2),
        lateEntries: attendanceByStatus.get('LATE') ?? 0,
        absentEntries: attendanceByStatus.get('ABSENT') ?? 0,
        remoteEntries: attendanceByStatus.get('REMOTE') ?? 0,
      },
      expiring: {
        contracts: expiringContracts.filter((contract) => contract.endDate !== null).length,
        probations: expiringContracts.filter((contract) => contract.probationEndDate !== null).length,
        documents: expiringDocuments,
        certifications: expiringCertifications,
      },
      turnover: {
        periodMonths: 12,
        terminations: terminations12Months,
        averageHeadcount: round(averageHeadcount, 1),
        rate: averageHeadcount === 0 ? 0 : round((terminations12Months / averageHeadcount) * 100, 2),
      },
      openRequests: {
        total: Object.values(openByPriority).reduce((sum, count) => sum + count, 0),
        byPriority: openByPriority,
      },
    };
  }

  // ── Company admin dashboard ──────────────────────────────────────────────

  async admin(principal: Principal) {
    const [tenant, users, userRoles, roles, integrations, recentAudit, documents, storage, departments, locations, teams] =
      await Promise.all([
        this.prisma.client.tenant.findFirst({
          where: { id: this.prisma.currentTenantIdOrThrow() },
          include: { privacySettings: true },
        }),
        this.prisma.client.user.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.client.userRole.groupBy({ by: ['roleId'], _count: { userId: true } }),
        this.prisma.client.role.findMany({ select: { id: true, key: true, name: true } }),
        this.prisma.client.integrationConnection.findMany({
          orderBy: { provider: 'asc' },
          select: {
            id: true,
            provider: true,
            status: true,
            scopeKey: true,
            lastSyncAt: true,
            lastSyncError: true,
            externalAccountEmail: true,
          },
        }),
        this.prisma.client.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            actorUserId: true,
            actorEmail: true,
            createdAt: true,
          },
        }),
        this.prisma.client.document.count(),
        this.prisma.client.documentVersion.aggregate({ _sum: { sizeBytes: true }, _count: { _all: true } }),
        this.prisma.client.department.count(),
        this.prisma.client.location.count(),
        this.prisma.client.team.count(),
      ]);

    const usersByStatus = new Map(users.map((entry) => [entry.status, entry._count._all]));
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const usedSeats = usersByStatus.get('ACTIVE') ?? 0;
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const seatLimit = typeof settings['licenses'] === 'number' ? settings['licenses'] : (PLAN_SEATS[tenant?.plan ?? 'STARTER'] ?? 25);
    const totalBytes = Number(storage._sum.sizeBytes ?? 0);

    return {
      users: {
        total: users.reduce((sum, entry) => sum + entry._count._all, 0),
        active: usedSeats,
        invited: usersByStatus.get('INVITED') ?? 0,
        suspended: usersByStatus.get('SUSPENDED') ?? 0,
        disabled: usersByStatus.get('DISABLED') ?? 0,
        byRole: userRoles
          .map((entry) => ({
            role: roleById.get(entry.roleId)?.name ?? 'Unknown',
            roleKey: roleById.get(entry.roleId)?.key ?? 'UNKNOWN',
            count: entry._count.userId,
          }))
          .sort((a, b) => b.count - a.count),
      },
      seats: {
        plan: tenant?.plan ?? 'STARTER',
        limit: seatLimit,
        used: usedSeats,
        available: Math.max(0, seatLimit - usedSeats),
        usagePercent: seatLimit === 0 ? 0 : round((usedSeats / seatLimit) * 100, 2),
      },
      plan: {
        name: tenant?.plan ?? null,
        status: tenant?.status ?? null,
        trialEndsAt: tenant?.trialEndsAt ?? null,
        onboardingDoneAt: tenant?.onboardingDoneAt ?? null,
      },
      integrations: integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        status: integration.status,
        scope: integration.scopeKey === 'org' ? 'organisation' : 'user',
        account: integration.externalAccountEmail,
        lastSyncAt: integration.lastSyncAt,
        lastSyncError: integration.lastSyncError,
      })),
      recentAudit: recentAudit,
      storage: {
        documents,
        versions: storage._count._all,
        totalBytes,
        megabytes: round(totalBytes / 1024 / 1024, 2),
        note: 'Computed from document version sizes stored in the database.',
      },
      company: {
        id: tenant?.id ?? null,
        name: tenant?.name ?? null,
        slug: tenant?.slug ?? null,
        domain: tenant?.domain ?? null,
        locale: tenant?.locale ?? null,
        timezone: tenant?.timezone ?? null,
        currency: tenant?.currency ?? null,
        departments,
        locations,
        teams,
        privacy: tenant?.privacySettings
          ? {
              dpoName: tenant.privacySettings.dpoName,
              dpoEmail: tenant.privacySettings.dpoEmail,
              gpsTrackingEnabled: tenant.privacySettings.gpsTrackingEnabled,
              biometricEnabled: tenant.privacySettings.biometricEnabled,
              allowEmployeeExport: tenant.privacySettings.allowEmployeeExport,
              allowEmployeeErasure: tenant.privacySettings.allowEmployeeErasure,
              defaultRetentionDays: tenant.privacySettings.defaultRetentionDays,
            }
          : null,
      },
      requestedBy: principal.userId,
    };
  }

  private unreadNotifications(userId: string): Promise<number> {
    return this.prisma.client.notification.count({ where: { userId, readAt: null } });
  }
}

function leaveRemaining(balance: {
  entitled: unknown;
  accrued: unknown;
  carriedOver: unknown;
  adjustment: unknown;
  used: unknown;
  pending: unknown;
}): number {
  return round(
    Number(balance.entitled) +
      Number(balance.accrued) +
      Number(balance.carriedOver) +
      Number(balance.adjustment) -
      Number(balance.used) -
      Number(balance.pending),
    2,
  );
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysUntil(date: Date, from: Date = startOfToday()): number {
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - from.getTime()) / DAY_MS);
}

/** Days until the next anniversary of `date` (0 = today). */
function daysUntilNextOccurrence(date: Date, from: Date): number {
  const year = from.getUTCFullYear();
  const candidate = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
  const thisYear = Math.round((candidate - from.getTime()) / DAY_MS);
  if (thisYear >= 0) return thisYear;
  const next = Date.UTC(year + 1, date.getUTCMonth(), date.getUTCDate());
  return Math.round((next - from.getTime()) / DAY_MS);
}

/** Number of years the next work anniversary completes. */
function anniversaryYears(hireDate: Date, from: Date, daysUntilAnniversary: number): number {
  const occurrenceYear = new Date(addDays(from, daysUntilAnniversary).getTime()).getUTCFullYear();
  return Math.max(1, occurrenceYear - hireDate.getUTCFullYear());
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
