import { Injectable } from '@nestjs/common';
import type { Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotFoundError } from '../../common/errors/app-error.js';
import { ScopeService } from './scope.service.js';
import { EmployeesService } from './employees.service.js';

export interface Employee360 {
  profile: unknown;
  employment: unknown;
  organization: unknown;
  leave: unknown;
  attendance: unknown;
  calendar: unknown;
  documents: unknown;
  compensation: unknown;
  benefits: unknown;
  performance: unknown;
  goals: unknown;
  training: unknown;
  certifications: unknown;
  assets: unknown;
  expenses: unknown;
  requests: unknown;
  notes: unknown;
  activity: unknown;
  permissions: { sensitive: boolean; salary: boolean; documents: boolean; audit: boolean };
}

/**
 * Employee 360: a single aggregated view of everything PeopleCore knows about
 * an employee. Sections the caller may not see are returned as `null` together
 * with an explicit permission flag, so the UI can render a locked state.
 */
@Injectable()
export class Employee360Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly employees: EmployeesService,
  ) {}

  async build(principal: Principal, employeeId: string): Promise<Employee360> {
    await this.scope.assertEmployeeAccess(principal, employeeId);
    const db = this.prisma.client;

    const employee = await db.employee.findFirst({
      where: { id: employeeId },
      include: {
        department: true,
        team: true,
        location: true,
        position: true,
        manager: { select: { id: true, firstName: true, lastName: true, photoUrl: true, workEmail: true } },
        schedule: true,
        user: { select: { id: true, email: true, status: true, lastLoginAt: true, mfaEnabled: true } },
        emergencyContacts: true,
        education: true,
        skills: { include: { skill: true } },
        languages: true,
      },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const canSeeSensitive = principal.isSuperAdmin || principal.permissions.includes('employees.sensitive.view');
    const canSeeSalary = principal.isSuperAdmin || principal.permissions.includes('employees.salary.view');
    const canSeeDocuments = principal.isSuperAdmin || principal.permissions.includes('employees.documents.view');
    const canSeeAudit = principal.isSuperAdmin || principal.permissions.includes('audit.view');
    const canSeePerformance = principal.isSuperAdmin || principal.permissions.includes('performance.view');
    const canSeeRequests = principal.isSuperAdmin || principal.permissions.includes('requests.view');
    const canSeeExpenses = principal.isSuperAdmin || principal.permissions.includes('expenses.view');
    const canSeeTraining = principal.isSuperAdmin || principal.permissions.includes('training.view');
    const canSeeAssets = principal.isSuperAdmin || principal.permissions.includes('assets.view');
    const canSeeLeave = principal.isSuperAdmin || principal.permissions.includes('leave.view');
    const canSeeAttendance = principal.isSuperAdmin || principal.permissions.includes('attendance.view');

    const now = new Date();
    const year = now.getUTCFullYear();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [
      contracts,
      history,
      leaveBalances,
      leaveRequests,
      attendance,
      upcomingEvents,
      documents,
      compensation,
      benefits,
      reviews,
      goals,
      training,
      certifications,
      assets,
      expenses,
      requests,
      activity,
    ] = await Promise.all([
      db.contract.findMany({ where: { employeeId }, orderBy: { startDate: 'desc' } }),
      db.employmentHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' }, take: 50 }),
      canSeeLeave
        ? db.leaveBalance.findMany({ where: { employeeId, year }, include: { leaveType: true } })
        : Promise.resolve(null),
      canSeeLeave
        ? db.leaveRequest.findMany({
            where: { employeeId },
            include: {
              leaveType: { select: { name: true, color: true, isPaid: true } },
              approvals: { orderBy: { stepOrder: 'asc' } },
            },
            orderBy: { startDate: 'desc' },
            take: 30,
          })
        : Promise.resolve(null),
      canSeeAttendance
        ? db.attendanceEntry.findMany({
            where: { employeeId, date: { gte: thirtyDaysAgo } },
            orderBy: { date: 'desc' },
            take: 60,
          })
        : Promise.resolve(null),
      db.calendarEvent.findMany({
        where: {
          OR: [{ organizerEmployeeId: employeeId }, { attendees: { some: { employeeId } } }],
          startAt: { gte: now },
          isCancelled: false,
        },
        orderBy: { startAt: 'asc' },
        take: 10,
      }),
      canSeeDocuments
        ? db.document.findMany({
            where: { employeeId },
            include: { category: { select: { key: true, name: true } }, currentVersion: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve(null),
      canSeeSalary
        ? db.compensationChange.findMany({ where: { employeeId }, orderBy: { effectiveDate: 'desc' } })
        : Promise.resolve(null),
      db.benefit.findMany({ where: { employeeId }, orderBy: { startDate: 'desc' } }),
      canSeePerformance
        ? db.performanceReview.findMany({
            where: { employeeId },
            include: { cycle: { select: { name: true, status: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20,
          })
        : Promise.resolve(null),
      canSeePerformance
        ? db.goal.findMany({
            where: { employeeId },
            include: { keyResults: true },
            orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
            take: 50,
          })
        : Promise.resolve(null),
      canSeeTraining
        ? db.trainingAssignment.findMany({
            where: { employeeId },
            include: { course: { select: { title: true, provider: true, isRequired: true } } },
            orderBy: { assignedAt: 'desc' },
            take: 30,
          })
        : Promise.resolve(null),
      canSeeTraining ? db.certification.findMany({ where: { employeeId }, orderBy: { expiresAt: 'asc' } }) : Promise.resolve(null),
      canSeeAssets
        ? db.asset.findMany({
            where: { assignedToId: employeeId },
            include: { location: { select: { name: true } } },
          })
        : Promise.resolve(null),
      canSeeExpenses
        ? db.expense.findMany({
            where: { employeeId },
            include: { category: { select: { name: true } } },
            orderBy: { expenseDate: 'desc' },
            take: 30,
          })
        : Promise.resolve(null),
      canSeeRequests
        ? db.hRRequest.findMany({
            where: { employeeId },
            orderBy: { createdAt: 'desc' },
            take: 30,
          })
        : Promise.resolve(null),
      canSeeAudit
        ? db.auditLog.findMany({
            where: { entityType: 'Employee', entityId: employeeId },
            orderBy: { createdAt: 'desc' },
            take: 25,
          })
        : Promise.resolve(null),
    ]);

    const currentSalary = canSeeSalary
      ? ([...(compensation ?? [])].sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())[0] ?? null)
      : null;

    const masked = this.employees.maskSensitive(principal, employee);

    return {
      profile: {
        ...(masked as Record<string, unknown>),
        nationalId: canSeeSensitive ? this.employees.decryptSafe(employee.nationalIdEnc) : undefined,
        bankAccounts: canSeeSensitive
          ? (await db.bankAccount.findMany({ where: { employeeId } })).map((account) => ({
              id: account.id,
              accountHolder: account.accountHolder,
              iban: this.employees.decryptSafe(account.ibanEnc),
              bic: account.bic,
              bankName: account.bankName,
              currency: account.currency,
              isPrimary: account.isPrimary,
            }))
          : null,
      },
      employment: { contracts, currentContract: contracts.find((contract) => contract.status === 'ACTIVE') ?? null },
      organization: {
        department: employee.department,
        team: employee.team,
        location: employee.location,
        position: employee.position,
        manager: employee.manager,
        schedule: employee.schedule,
        history,
      },
      leave: leaveBalances
        ? {
            year,
            balances: leaveBalances.map((balance) => ({
              leaveTypeId: balance.leaveTypeId,
              leaveType: balance.leaveType.name,
              color: balance.leaveType.color,
              entitled: Number(balance.entitled) + Number(balance.carriedOver) + Number(balance.adjustment),
              accrued: Number(balance.accrued),
              used: Number(balance.used),
              pending: Number(balance.pending),
              remaining:
                Number(balance.entitled) +
                Number(balance.carriedOver) +
                Number(balance.adjustment) -
                Number(balance.used) -
                Number(balance.pending),
            })),
            requests: leaveRequests,
          }
        : null,
      attendance: attendance
        ? {
            recent: attendance,
            summary: {
              daysTracked: attendance.length,
              totalWorkedMinutes: attendance.reduce((sum, entry) => sum + (entry.workedMinutes ?? 0), 0),
              totalOvertimeMinutes: attendance.reduce((sum, entry) => sum + entry.overtimeMinutes, 0),
              lateDays: attendance.filter((entry) => entry.lateMinutes > 0).length,
              missingPunches: attendance.filter((entry) => entry.clockIn && !entry.clockOut).length,
            },
          }
        : null,
      calendar: upcomingEvents,
      documents,
      compensation: compensation ? { history: compensation, current: currentSalary } : null,
      benefits,
      performance: reviews,
      goals,
      training,
      certifications,
      assets,
      expenses,
      requests,
      notes: await this.profileNotes(principal, employeeId),
      activity,
      permissions: {
        sensitive: canSeeSensitive,
        salary: canSeeSalary,
        documents: canSeeDocuments,
        audit: canSeeAudit,
      },
    };
  }

  private async profileNotes(principal: Principal, employeeId: string) {
    const canSeeHrNotes = principal.permissions.includes('employees.edit') || principal.isSuperAdmin;
    return this.prisma.client.employeeNote.findMany({
      where: {
        employeeId,
        ...(canSeeHrNotes
          ? {}
          : { OR: [{ visibility: 'MANAGER' as const }, { authorId: principal.userId, visibility: 'PRIVATE' as const }] }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
