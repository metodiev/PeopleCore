import { Injectable } from '@nestjs/common';
import type { Paginated, Principal, ReportType } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import {
  buildQueryOptions,
  paginate,
  pageNumber,
  pageSizeOf,
} from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import { toCsv, toPdf, toXlsx } from './exporters.js';
import { FILE_FORMAT_MIME, type ReportCatalogEntry, type ReportColumn, type ReportResult, type ReportRow } from './report.types.js';
import type {
  CreateSavedReportDto,
  ReportExportDto,
  ReportQueryDto,
  ReportRunQueryDto,
  UpdateSavedReportDto,
} from './dto/report.dto.js';

const ACTIVE_STATUSES = ['ACTIVE', 'PROBATION', 'ON_LEAVE'] as const;
const SAVED_SORTABLE = ['createdAt', 'name', 'lastRunAt'] as const;
const RUN_SORTABLE = ['createdAt', 'completedAt', 'rowCount'] as const;

export interface ReportFile {
  buffer: Buffer;
  contentType: string;
  fileName: string;
}

/**
 * Reporting engine.
 *
 * Every report is computed from live, tenant-scoped Prisma queries — nothing is
 * cached or hardcoded. Row-level visibility follows {@link ScopeService} so a
 * manager's reports cover their own organisation unit and an employee's cover
 * only themselves; compensation columns additionally require
 * `employees.salary.view`.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /** Report catalogue with the permissions each report requires. */
  catalog(): ReportCatalogEntry[] {
    return CATALOG.map((entry) => ({ ...entry }));
  }

  async run(principal: Principal, type: ReportType, query: ReportQueryDto): Promise<ReportResult> {
    this.assertType(type);
    await this.assertReportPermission(principal, type);

    const result = await this.build(principal, type, query);
    const page = pageNumber(query);
    const pageSize = pageSizeOf(query);
    const total = result.rows.length;
    return {
      ...result,
      rows: result.rows.slice((page - 1) * pageSize, page * pageSize),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    };
  }

  /** Full (unpaginated) dataset rendered into the requested file format. */
  async exportFile(principal: Principal, type: ReportType, query: ReportQueryDto): Promise<ReportFile> {
    this.assertType(type);
    await this.assertReportPermission(principal, type);
    const format = query.format ?? 'json';
    if (format === 'json') {
      throw new ValidationError('Use format=csv|xlsx|pdf to download a report file', { format });
    }

    const result = await this.build(principal, type, query);
    const title = `${this.typeLabel(type)} report`;
    const scopeLabel = this.scopeLabel(principal);
    const buffer =
      format === 'csv'
        ? toCsv(result.columns, result.rows)
        : format === 'xlsx'
          ? await toXlsx(result.columns, result.rows, title)
          : await toPdf(result.columns, result.rows, title, scopeLabel);

    const fileName = `${type.toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}.${format}`;
    return { buffer, contentType: FILE_FORMAT_MIME[format], fileName };
  }

  /** Async-style export: records a ReportRun and returns the JSON payload. */
  async requestExport(principal: Principal, dto: ReportExportDto) {
    this.assertType(dto.type);
    await this.assertReportPermission(principal, dto.type);

    const query: ReportQueryDto = { ...dto };
    const result = await this.build(principal, dto.type, query);
    const format = (dto.format ?? 'json').toUpperCase() as 'CSV' | 'XLSX' | 'PDF' | 'JSON';

    const run = await this.prisma.transaction(async (tx) =>
      tx.reportRun.create({
        data: tenantScoped({
          type: dto.type,
          format,
          status: 'COMPLETED',
          filters: this.filterSnapshot(dto) as never,
          rowCount: result.rows.length,
          requestedById: principal.userId,
          startedAt: new Date(),
          completedAt: new Date(),
        }),
      }),
    );

    await this.audit.record({
      action: 'report.export',
      entityType: 'ReportRun',
      entityId: run.id,
      actorUserId: principal.userId,
      metadata: { type: dto.type, format, rows: result.rows.length },
    });

    return {
      runId: run.id,
      type: dto.type,
      format: dto.format ?? 'json',
      columns: result.columns,
      rows: result.rows,
      summary: result.summary,
      rowCount: result.rows.length,
    };
  }

  // ── Saved reports & schedules ─────────────────────────────────────────────

  /**
   * Saved reports may carry a `scheduleFrequency`. Delivery itself is not done
   * inline: the scheduler calls {@link runDueSchedules}, which creates the
   * ReportRun and emits `report.ready` — the notifications module (queue + mail
   * worker) then delivers the artifact to `recipients`.
   */
  async listSaved(query: ReportQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SAVED_SORTABLE, { createdAt: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.client.savedReport.findMany({ where, skip, take, orderBy }),
      this.prisma.client.savedReport.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async createSaved(principal: Principal, dto: CreateSavedReportDto) {
    this.assertType(dto.type);
    const existing = await this.prisma.client.savedReport.findFirst({ where: { name: dto.name } });
    if (existing) throw new ValidationError(`A saved report named "${dto.name}" already exists`);

    const saved = await this.prisma.client.savedReport.create({
      data: tenantScoped({
        name: dto.name,
        type: dto.type,
        format: dto.format ?? 'CSV',
        filters: (dto.filters ?? undefined) as never,
        scheduleFrequency: dto.scheduleFrequency ?? null,
        recipients: dto.recipients ?? [],
        createdById: principal.userId,
      }),
    });
    await this.audit.record({
      action: 'report.saved.create',
      entityType: 'SavedReport',
      entityId: saved.id,
      actorUserId: principal.userId,
      after: saved,
    });
    return saved;
  }

  async updateSaved(principal: Principal, id: string, dto: UpdateSavedReportDto) {
    const before = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Saved report', 'SAVED_REPORT_NOT_FOUND');

    const updated = await this.prisma.client.savedReport.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type,
        format: dto.format,
        filters: dto.filters === undefined ? undefined : (dto.filters as never),
        scheduleFrequency: dto.scheduleFrequency,
        recipients: dto.recipients,
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      action: 'report.saved.update',
      entityType: 'SavedReport',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  async removeSaved(principal: Principal, id: string) {
    const before = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Saved report', 'SAVED_REPORT_NOT_FOUND');
    await this.prisma.client.savedReport.delete({ where: { id } });
    await this.audit.record({
      action: 'report.saved.delete',
      entityType: 'SavedReport',
      entityId: id,
      actorUserId: principal.userId,
      before,
    });
    return { id, deleted: true };
  }

  async runSaved(principal: Principal, id: string, overrides: ReportQueryDto = {}) {
    const saved = await this.prisma.client.savedReport.findFirst({ where: { id } });
    if (!saved) throw new NotFoundError('Saved report', 'SAVED_REPORT_NOT_FOUND');
    await this.assertReportPermission(principal, saved.type);

    const filters = (saved.filters ?? {}) as Record<string, unknown>;
    const query: ReportQueryDto = {
      ...filters,
      from: overrides.from ?? (filters['from'] as string | undefined),
      to: overrides.to ?? (filters['to'] as string | undefined),
      page: overrides.page,
      pageSize: overrides.pageSize,
    } as ReportQueryDto;

    const startedAt = new Date();
    const run = await this.prisma.transaction(async (tx) =>
      tx.reportRun.create({
        data: tenantScoped({
          savedReportId: saved.id,
          type: saved.type,
          format: saved.format,
          status: 'RUNNING',
          filters: (saved.filters ?? undefined) as never,
          requestedById: principal.userId,
          startedAt,
        }),
      }),
    );

    try {
      const result = await this.run(principal, saved.type, query);
      const completed = await this.prisma.transaction(async (tx) =>
        tx.reportRun.update({
          where: { id: run.id },
          data: { status: 'COMPLETED', rowCount: result.meta?.total ?? result.rows.length, completedAt: new Date() },
        }),
      );
      await this.prisma.client.savedReport.update({ where: { id: saved.id }, data: { lastRunAt: new Date() } });
      await this.audit.record({
        action: 'report.saved.run',
        entityType: 'ReportRun',
        entityId: run.id,
        actorUserId: principal.userId,
        metadata: { savedReportId: saved.id, type: saved.type, rows: completed.rowCount },
      });
      return { run: completed, ...result };
    } catch (error) {
      await this.prisma.transaction(async (tx) =>
        tx.reportRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            error: error instanceof Error ? error.message.slice(0, 500) : 'Report failed',
            completedAt: new Date(),
          },
        }),
      );
      throw error;
    }
  }

  async listRuns(query: ReportRunQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, RUN_SORTABLE, { createdAt: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.type) where['type'] = query.type;
    const [rows, total] = await Promise.all([
      this.prisma.client.reportRun.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { savedReport: { select: { id: true, name: true } } },
      }),
      this.prisma.client.reportRun.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  // ── Report implementations ────────────────────────────────────────────────

  private async build(principal: Principal, type: ReportType, query: ReportQueryDto): Promise<ReportResult> {
    switch (type) {
      case 'EMPLOYEES':
        return this.employeesReport(principal, query);
      case 'HEADCOUNT':
        return this.headcountReport(principal, query);
      case 'TURNOVER':
        return this.turnoverReport(principal, query);
      case 'ABSENCE':
        return this.absenceReport(principal, query);
      case 'LEAVE':
        return this.leaveReport(principal, query);
      case 'ATTENDANCE':
        return this.attendanceReport(principal, query);
      case 'OVERTIME':
        return this.overtimeReport(principal, query);
      case 'SALARY':
        return this.salaryReport(principal, query);
      case 'DEPARTMENT':
        return this.departmentReport(principal, query);
      case 'HIRING':
        return this.hiringReport(principal, query);
      case 'TERMINATION':
        return this.terminationReport(principal, query);
      case 'DEMOGRAPHICS':
        return this.demographicsReport(principal, query);
      default:
        throw new ValidationError(`Unsupported report type: ${String(type)}`);
    }
  }

  private async employeesReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const canSeeSalary = this.canSeeSalary(principal);
    const extra: Record<string, unknown> = {};
    if (query.departmentId) extra['departmentId'] = query.departmentId;
    if (query.locationId) extra['locationId'] = query.locationId;
    if (query.status) extra['status'] = query.status;
    else if (!query.includeTerminated) extra['status'] = { not: 'TERMINATED' };

    const where = await this.scope.employeeWhere(principal, extra);
    const employees = await this.prisma.client.employee.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        employeeNumber: true,
        firstName: true,
        lastName: true,
        workEmail: true,
        status: true,
        employmentType: true,
        hireDate: true,
        terminationDate: true,
        department: { select: { name: true } },
        team: { select: { name: true } },
        position: { select: { title: true } },
        location: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
        contracts: {
          where: { status: 'ACTIVE' },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { salaryAmount: true, currency: true, type: true },
        },
      },
    });

    const columns: ReportColumn[] = [
      { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
      { key: 'employee', label: 'Employee', type: 'string' },
      { key: 'workEmail', label: 'Work email', type: 'string' },
      { key: 'department', label: 'Department', type: 'string' },
      { key: 'team', label: 'Team', type: 'string' },
      { key: 'position', label: 'Position', type: 'string' },
      { key: 'location', label: 'Location', type: 'string' },
      { key: 'manager', label: 'Manager', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'employmentType', label: 'Employment type', type: 'string' },
      { key: 'hireDate', label: 'Hire date', type: 'date' },
      { key: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
    ];
    if (canSeeSalary) {
      columns.push(
        { key: 'contractType', label: 'Contract type', type: 'string' },
        { key: 'baseSalary', label: 'Base salary', type: 'currency' },
        { key: 'currency', label: 'Currency', type: 'string' },
      );
    }

    const rows = employees.map((employee) => {
      const contract = employee.contracts[0];
      const row: ReportRow = {
        employeeNumber: employee.employeeNumber,
        employee: `${employee.firstName} ${employee.lastName}`,
        workEmail: employee.workEmail,
        department: employee.department?.name ?? '',
        team: employee.team?.name ?? '',
        position: employee.position?.title ?? '',
        location: employee.location?.name ?? '',
        manager: employee.manager ? `${employee.manager.firstName} ${employee.manager.lastName}` : '',
        status: employee.status,
        employmentType: employee.employmentType,
        hireDate: employee.hireDate,
        tenureMonths: monthsBetween(employee.hireDate, employee.terminationDate ?? new Date()),
      };
      if (canSeeSalary) {
        row['contractType'] = contract?.type ?? '';
        row['baseSalary'] = contract?.salaryAmount === null || contract?.salaryAmount === undefined ? null : Number(contract.salaryAmount);
        row['currency'] = contract?.currency ?? '';
      }
      return row;
    });

    const byStatus = countBy(rows, (row) => String(row['status'] ?? 'UNKNOWN'));
    return {
      columns,
      rows,
      summary: {
        total: rows.length,
        active: rows.filter((row) => ACTIVE_STATUSES.includes(row['status'] as (typeof ACTIVE_STATUSES)[number])).length,
        terminated: byStatus['TERMINATED'] ?? 0,
        salaryVisible: canSeeSalary ? 'yes' : 'no',
      },
    };
  }

  private async headcountReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 365);
    const employees = await this.headcountSource(principal, query);

    const rows: ReportRow[] = bucketMonths(from, to).map((month) => {
      const end = monthEnd(month);
      const headcount = employees.filter(
        (employee) =>
          employee.hireDate <= end && (employee.terminationDate === null || employee.terminationDate > end),
      ).length;
      const hires = employees.filter((employee) => monthKey(employee.hireDate) === month).length;
      const leavers = employees.filter(
        (employee) => employee.terminationDate !== null && monthKey(employee.terminationDate) === month,
      ).length;
      return { month, headcount, hires, leavers, netChange: hires - leavers };
    });

    const first = rows[0];
    const last = rows[rows.length - 1];
    return {
      columns: [
        { key: 'month', label: 'Month', type: 'string' },
        { key: 'headcount', label: 'Headcount', type: 'number' },
        { key: 'hires', label: 'Hires', type: 'number' },
        { key: 'leavers', label: 'Leavers', type: 'number' },
        { key: 'netChange', label: 'Net change', type: 'number' },
      ],
      rows,
      summary: {
        openingHeadcount: Number(first?.['headcount'] ?? 0),
        closingHeadcount: Number(last?.['headcount'] ?? 0),
        hires: rows.reduce((sum, row) => sum + Number(row['hires']), 0),
        leavers: rows.reduce((sum, row) => sum + Number(row['leavers']), 0),
      },
    };
  }

  private async turnoverReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 365);
    const employees = await this.headcountSource(principal, query);

    const rows: ReportRow[] = bucketMonths(from, to).map((month) => {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = monthEnd(month);
      const atStart = employees.filter(
        (employee) => employee.hireDate <= start && (employee.terminationDate === null || employee.terminationDate > start),
      ).length;
      const atEnd = employees.filter(
        (employee) => employee.hireDate <= end && (employee.terminationDate === null || employee.terminationDate > end),
      ).length;
      const leavers = employees.filter(
        (employee) => employee.terminationDate !== null && monthKey(employee.terminationDate) === month,
      ).length;
      const averageHeadcount = (atStart + atEnd) / 2;
      return {
        month,
        headcountStart: atStart,
        headcountEnd: atEnd,
        averageHeadcount,
        leavers,
        turnoverRate: averageHeadcount === 0 ? 0 : round((leavers / averageHeadcount) * 100, 2),
      };
    });

    const totalLeavers = rows.reduce((sum, row) => sum + Number(row['leavers']), 0);
    const averageHeadcount =
      rows.length === 0 ? 0 : round(rows.reduce((sum, row) => sum + Number(row['averageHeadcount']), 0) / rows.length, 1);

    return {
      columns: [
        { key: 'month', label: 'Month', type: 'string' },
        { key: 'headcountStart', label: 'Headcount (start)', type: 'number' },
        { key: 'headcountEnd', label: 'Headcount (end)', type: 'number' },
        { key: 'averageHeadcount', label: 'Average headcount', type: 'number' },
        { key: 'leavers', label: 'Leavers', type: 'number' },
        { key: 'turnoverRate', label: 'Turnover rate (%)', type: 'number' },
      ],
      rows,
      summary: {
        totalLeavers,
        averageHeadcount,
        turnoverRate: averageHeadcount === 0 ? 0 : round((totalLeavers / averageHeadcount) * 100, 2),
      },
    };
  }

  private async absenceReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 30);
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    const groups = await this.prisma.client.attendanceEntry.groupBy({
      by: ['employeeId', 'status'],
      where: { date: { gte: from, lte: to }, employee: where },
      _count: { _all: true },
      _sum: { lateMinutes: true },
    });
    if (groups.length === 0) {
      return {
        columns: ABSENCE_COLUMNS,
        rows: [],
        summary: { employees: 0, absenceDays: 0, lateIncidents: 0 },
      };
    }

    const employees = await this.employeeLookup(groups.map((group) => group.employeeId));
    const byEmployee = new Map<string, ReportRow>();
    for (const group of groups) {
      const employee = employees.get(group.employeeId);
      const row: ReportRow =
        byEmployee.get(group.employeeId) ??
        ({
          employee: employee?.name ?? group.employeeId,
          employeeNumber: employee?.employeeNumber ?? '',
          department: employee?.department ?? '',
          absentDays: 0,
          halfDays: 0,
          leaveDays: 0,
          lateDays: 0,
          lateMinutes: 0,
          absenceDays: 0,
        } satisfies ReportRow);

      const count = group._count._all;
      if (group.status === 'ABSENT') row['absentDays'] = count;
      if (group.status === 'HALF_DAY') row['halfDays'] = count;
      if (group.status === 'LEAVE') row['leaveDays'] = count;
      if (group.status === 'LATE') row['lateDays'] = count;
      row['lateMinutes'] = Number(row['lateMinutes']) + Number(group._sum.lateMinutes ?? 0);
      byEmployee.set(group.employeeId, row);
    }

    const rows = [...byEmployee.values()]
      .map((row): ReportRow => ({
        ...row,
        absenceDays:
          Number(row['absentDays']) + Number(row['halfDays']) * 0.5 + Number(row['leaveDays']),
      }))
      .sort((a, b) => Number(b['absenceDays']) - Number(a['absenceDays']));

    return {
      columns: ABSENCE_COLUMNS,
      rows,
      summary: {
        employees: rows.length,
        absenceDays: round(rows.reduce((sum, row) => sum + Number(row['absenceDays']), 0), 2),
        lateIncidents: rows.reduce((sum, row) => sum + Number(row['lateDays']), 0),
        lateMinutes: rows.reduce((sum, row) => sum + Number(row['lateMinutes']), 0),
      },
    };
  }

  private async leaveReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 365);
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    const requests = await this.prisma.client.leaveRequest.findMany({
      where: {
        AND: [
          { employee: where },
          { status: (query.status ?? 'APPROVED') as never },
          { startDate: { lte: to } },
          { endDate: { gte: from } },
        ],
      },
      select: {
        daysRequested: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, department: { select: { name: true } } } },
        leaveType: { select: { name: true, isPaid: true } },
      },
    });

    const byKey = new Map<string, ReportRow>();
    for (const request of requests) {
      const key = `${request.employee.id}:${request.leaveType.name}`;
      const row: ReportRow =
        byKey.get(key) ??
        ({
          employee: `${request.employee.firstName} ${request.employee.lastName}`,
          employeeNumber: request.employee.employeeNumber,
          department: request.employee.department?.name ?? '',
          leaveType: request.leaveType.name,
          paid: request.leaveType.isPaid ? 'yes' : 'no',
          requests: 0,
          days: 0,
        } satisfies ReportRow);
      row['requests'] = Number(row['requests']) + 1;
      row['days'] = round(Number(row['days']) + Number(request.daysRequested), 2);
      byKey.set(key, row);
    }

    const rows = [...byKey.values()].sort((a, b) => Number(b['days']) - Number(a['days']));
    const byType = new Map<string, number>();
    for (const row of rows) {
      byType.set(String(row['leaveType']), round((byType.get(String(row['leaveType'])) ?? 0) + Number(row['days']), 2));
    }

    const summary: Record<string, number | string> = {
      requests: requests.length,
      totalDays: round(rows.reduce((sum, row) => sum + Number(row['days']), 0), 2),
      employees: new Set(requests.map((request) => request.employee.id)).size,
    };
    let index = 0;
    for (const [leaveType, days] of byType) {
      summary[`days.${index}.${leaveType}`] = days;
      index += 1;
    }

    return {
      columns: [
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'leaveType', label: 'Leave type', type: 'string' },
        { key: 'paid', label: 'Paid', type: 'string' },
        { key: 'requests', label: 'Requests', type: 'number' },
        { key: 'days', label: 'Days', type: 'number' },
      ],
      rows,
      summary,
    };
  }

  private async attendanceReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 30);
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    const groups = await this.prisma.client.attendanceEntry.groupBy({
      by: ['employeeId', 'status'],
      where: { date: { gte: from, lte: to }, employee: where },
      _count: { _all: true },
      _sum: { workedMinutes: true, lateMinutes: true, earlyLeaveMinutes: true },
    });

    const employees = await this.employeeLookup(groups.map((group) => group.employeeId));
    const byEmployee = new Map<string, ReportRow>();
    for (const group of groups) {
      const employee = employees.get(group.employeeId);
      const row: ReportRow =
        byEmployee.get(group.employeeId) ??
        ({
          employee: employee?.name ?? group.employeeId,
          employeeNumber: employee?.employeeNumber ?? '',
          department: employee?.department ?? '',
          presentDays: 0,
          lateDays: 0,
          remoteDays: 0,
          leaveDays: 0,
          absentDays: 0,
          trackedDays: 0,
          workedHours: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          presentRate: 0,
        } satisfies ReportRow);

      const count = group._count._all;
      if (group.status === 'PRESENT') row['presentDays'] = count;
      if (group.status === 'LATE') row['lateDays'] = count;
      if (group.status === 'REMOTE') row['remoteDays'] = count;
      if (group.status === 'LEAVE') row['leaveDays'] = count;
      if (group.status === 'ABSENT') row['absentDays'] = count;
      if (group.status !== 'WEEKEND' && group.status !== 'HOLIDAY') row['trackedDays'] = Number(row['trackedDays']) + count;
      row['workedHours'] = round(Number(row['workedHours']) + Number(group._sum.workedMinutes ?? 0) / 60, 2);
      row['lateMinutes'] = Number(row['lateMinutes']) + Number(group._sum.lateMinutes ?? 0);
      row['earlyLeaveMinutes'] = Number(row['earlyLeaveMinutes']) + Number(group._sum.earlyLeaveMinutes ?? 0);
      byEmployee.set(group.employeeId, row);
    }

    const rows = [...byEmployee.values()]
      .map((row): ReportRow => {
        const tracked = Number(row['trackedDays']);
        const attended = Number(row['presentDays']) + Number(row['lateDays']) + Number(row['remoteDays']);
        return { ...row, presentRate: tracked === 0 ? 0 : round((attended / tracked) * 100, 2) };
      })
      .sort((a, b) => Number(b['presentRate']) - Number(a['presentRate']));

    const trackedTotal = rows.reduce((sum, row) => sum + Number(row['trackedDays']), 0);
    const attendedTotal = rows.reduce(
      (sum, row) => sum + Number(row['presentDays']) + Number(row['lateDays']) + Number(row['remoteDays']),
      0,
    );

    return {
      columns: [
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'presentDays', label: 'Present days', type: 'number' },
        { key: 'lateDays', label: 'Late days', type: 'number' },
        { key: 'remoteDays', label: 'Remote days', type: 'number' },
        { key: 'leaveDays', label: 'Leave days', type: 'number' },
        { key: 'absentDays', label: 'Absent days', type: 'number' },
        { key: 'workedHours', label: 'Worked hours', type: 'number' },
        { key: 'lateMinutes', label: 'Late minutes', type: 'number' },
        { key: 'earlyLeaveMinutes', label: 'Early leave minutes', type: 'number' },
        { key: 'presentRate', label: 'Attendance rate (%)', type: 'number' },
      ],
      rows,
      summary: {
        employees: rows.length,
        attendanceRate: trackedTotal === 0 ? 0 : round((attendedTotal / trackedTotal) * 100, 2),
        workedHours: round(rows.reduce((sum, row) => sum + Number(row['workedHours']), 0), 2),
        lateMinutes: rows.reduce((sum, row) => sum + Number(row['lateMinutes']), 0),
      },
    };
  }

  private async overtimeReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 30);
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    const groups = await this.prisma.client.attendanceEntry.groupBy({
      by: ['employeeId'],
      where: { date: { gte: from, lte: to }, overtimeMinutes: { gt: 0 }, employee: where },
      _sum: { overtimeMinutes: true },
      _count: { _all: true },
    });

    const employees = await this.employeeLookup(groups.map((group) => group.employeeId));
    const rows: ReportRow[] = groups
      .map((group) => {
        const employee = employees.get(group.employeeId);
        const minutes = Number(group._sum.overtimeMinutes ?? 0);
        const days = group._count._all;
        return {
          employee: employee?.name ?? group.employeeId,
          employeeNumber: employee?.employeeNumber ?? '',
          department: employee?.department ?? '',
          overtimeDays: days,
          overtimeMinutes: minutes,
          overtimeHours: round(minutes / 60, 2),
          averageHoursPerDay: days === 0 ? 0 : round(minutes / 60 / days, 2),
        };
      })
      .sort((a, b) => Number(b['overtimeMinutes']) - Number(a['overtimeMinutes']));

    const totalMinutes = rows.reduce((sum, row) => sum + Number(row['overtimeMinutes']), 0);
    return {
      columns: [
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'overtimeDays', label: 'Days with overtime', type: 'number' },
        { key: 'overtimeHours', label: 'Overtime hours', type: 'number' },
        { key: 'averageHoursPerDay', label: 'Avg. hours/day', type: 'number' },
      ],
      rows,
      summary: {
        employees: rows.length,
        totalOvertimeHours: round(totalMinutes / 60, 2),
        averageOvertimeHours: rows.length === 0 ? 0 : round(totalMinutes / 60 / rows.length, 2),
      },
    };
  }

  private async salaryReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const canSeeSalary = this.canSeeSalary(principal);
    if (!canSeeSalary) {
      throw new ForbiddenError('Reading the salary report requires employees.salary.view', 'SALARY_REPORT_FORBIDDEN');
    }
    const extra: Record<string, unknown> = { ...this.departmentFilters(query) };
    if (query.status) extra['status'] = query.status;
    else extra['status'] = { not: 'TERMINATED' };
    const where = await this.scope.employeeWhere(principal, extra);

    const employees = await this.prisma.client.employee.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        employeeNumber: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
        contracts: {
          where: { status: 'ACTIVE' },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: { id: true, type: true, startDate: true, salaryAmount: true, currency: true },
        },
        compensation: {
          where: { type: 'BASE_SALARY' },
          orderBy: { effectiveDate: 'desc' },
          take: 1,
          select: { newAmount: true, currency: true, effectiveDate: true },
        },
      },
    });

    const rows: ReportRow[] = [];
    const totals = new Map<string, number>();
    for (const employee of employees) {
      const contract = employee.contracts[0];
      const latest = employee.compensation[0];
      const amount = latest ? Number(latest.newAmount) : contract?.salaryAmount ? Number(contract.salaryAmount) : null;
      const currency = latest?.currency ?? contract?.currency ?? 'EUR';
      if (amount !== null) totals.set(currency, (totals.get(currency) ?? 0) + amount);
      rows.push({
        employeeNumber: employee.employeeNumber,
        employee: `${employee.firstName} ${employee.lastName}`,
        department: employee.department?.name ?? '',
        position: employee.position?.title ?? '',
        contractType: contract?.type ?? '',
        baseSalary: amount,
        currency: amount === null ? '' : currency,
        effectiveDate: latest?.effectiveDate ?? contract?.startDate ?? null,
        lastChange: latest?.effectiveDate ?? null,
      });
    }

    rows.sort((a, b) => Number(b['baseSalary'] ?? -1) - Number(a['baseSalary'] ?? -1));
    const summary: Record<string, number | string> = {
      employees: rows.filter((row) => row['baseSalary'] !== null).length,
      averageSalary:
        rows.length === 0
          ? 0
          : round(
              rows.reduce((sum, row) => sum + Number(row['baseSalary'] ?? 0), 0) /
                Math.max(1, rows.filter((row) => row['baseSalary'] !== null).length),
              2,
            ),
    };
    for (const [currency, total] of totals) {
      summary[`total.${currency}`] = round(total, 2);
    }

    return {
      columns: [
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'position', label: 'Position', type: 'string' },
        { key: 'contractType', label: 'Contract type', type: 'string' },
        { key: 'baseSalary', label: 'Base salary', type: 'currency' },
        { key: 'currency', label: 'Currency', type: 'string' },
        { key: 'effectiveDate', label: 'Effective date', type: 'date' },
      ],
      rows,
      summary,
    };
  }

  private async departmentReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    const [departments, employees] = await Promise.all([
      this.prisma.client.department.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          costCenter: true,
          manager: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.employee.findMany({
        where,
        select: {
          departmentId: true,
          status: true,
          hireDate: true,
          terminationDate: true,
          _count: { select: { reports: true } },
        },
      }),
    ]);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setUTCFullYear(twelveMonthsAgo.getUTCFullYear() - 1);

    const rows: ReportRow[] = departments.map((department) => {
      const members = employees.filter((employee) => employee.departmentId === department.id);
      const active = members.filter((employee) => ACTIVE_STATUSES.includes(employee.status as (typeof ACTIVE_STATUSES)[number]));
      const tenure = active.map((employee) => monthsBetween(employee.hireDate, new Date()));
      return {
        department: department.name,
        code: department.code ?? '',
        costCenter: department.costCenter ?? '',
        manager: department.manager ? `${department.manager.firstName} ${department.manager.lastName}` : '',
        headcount: members.length,
        active: active.length,
        probation: members.filter((employee) => employee.status === 'PROBATION').length,
        terminated: members.filter((employee) => employee.status === 'TERMINATED').length,
        hires12Months: members.filter((employee) => employee.hireDate >= twelveMonthsAgo).length,
        leavers12Months: members.filter((employee) => employee.terminationDate !== null && employee.terminationDate >= twelveMonthsAgo).length,
        managerReports: active.reduce((sum, employee) => sum + employee._count.reports, 0),
        averageTenureMonths: tenure.length === 0 ? 0 : round(tenure.reduce((sum, value) => sum + value, 0) / tenure.length, 1),
      };
    });

    const unassigned = employees.filter((employee) => employee.departmentId === null);
    if (unassigned.length > 0) {
      rows.push({
        department: 'Unassigned',
        code: '',
        costCenter: '',
        manager: '',
        headcount: unassigned.length,
        active: unassigned.filter((employee) => ACTIVE_STATUSES.includes(employee.status as (typeof ACTIVE_STATUSES)[number])).length,
        probation: 0,
        terminated: 0,
        hires12Months: 0,
        leavers12Months: 0,
        managerReports: 0,
        averageTenureMonths: 0,
      });
    }

    return {
      columns: [
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'code', label: 'Code', type: 'string' },
        { key: 'costCenter', label: 'Cost center', type: 'string' },
        { key: 'manager', label: 'Manager', type: 'string' },
        { key: 'headcount', label: 'Headcount', type: 'number' },
        { key: 'active', label: 'Active', type: 'number' },
        { key: 'probation', label: 'On probation', type: 'number' },
        { key: 'terminated', label: 'Terminated', type: 'number' },
        { key: 'hires12Months', label: 'Hires (12m)', type: 'number' },
        { key: 'leavers12Months', label: 'Leavers (12m)', type: 'number' },
        { key: 'averageTenureMonths', label: 'Avg. tenure (months)', type: 'number' },
      ],
      rows,
      summary: {
        departments: rows.length,
        headcount: employees.length,
        active: employees.filter((employee) => ACTIVE_STATUSES.includes(employee.status as (typeof ACTIVE_STATUSES)[number])).length,
      },
    };
  }

  private async hiringReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 365);
    const where = await this.scope.employeeWhere(principal, {
      ...this.departmentFilters(query),
      hireDate: { gte: from, lte: to },
    });
    const employees = await this.prisma.client.employee.findMany({
      where,
      orderBy: { hireDate: 'desc' },
      select: {
        employeeNumber: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        employmentType: true,
        status: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
        location: { select: { name: true } },
      },
    });

    const rows: ReportRow[] = employees.map((employee) => ({
      employeeNumber: employee.employeeNumber,
      employee: `${employee.firstName} ${employee.lastName}`,
      department: employee.department?.name ?? '',
      position: employee.position?.title ?? '',
      location: employee.location?.name ?? '',
      employmentType: employee.employmentType,
      status: employee.status,
      hireDate: employee.hireDate,
      month: monthKey(employee.hireDate),
    }));

    const byDepartment = countBy(rows, (row) => String(row['department'] || 'Unassigned'));
    const summary: Record<string, number | string> = {
      hires: rows.length,
      averagePerMonth: round(rows.length / Math.max(1, bucketMonths(from, to).length), 2),
    };
    Object.entries(byDepartment).forEach(([department, count], index) => {
      summary[`hires.${index}.${department}`] = count;
    });

    return {
      columns: [
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'position', label: 'Position', type: 'string' },
        { key: 'location', label: 'Location', type: 'string' },
        { key: 'employmentType', label: 'Employment type', type: 'string' },
        { key: 'status', label: 'Status', type: 'string' },
        { key: 'hireDate', label: 'Hire date', type: 'date' },
      ],
      rows,
      summary,
    };
  }

  private async terminationReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const { from, to } = this.resolvePeriod(query, 365);
    const where = await this.scope.employeeWhere(principal, {
      ...this.departmentFilters(query),
      terminationDate: { gte: from, lte: to },
    });
    const employees = await this.prisma.client.employee.findMany({
      where,
      orderBy: { terminationDate: 'desc' },
      select: {
        employeeNumber: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        terminationDate: true,
        terminationReason: true,
        employmentType: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
      },
    });

    const rows: ReportRow[] = employees.map((employee) => ({
      employeeNumber: employee.employeeNumber,
      employee: `${employee.firstName} ${employee.lastName}`,
      department: employee.department?.name ?? '',
      position: employee.position?.title ?? '',
      employmentType: employee.employmentType,
      hireDate: employee.hireDate,
      terminationDate: employee.terminationDate,
      terminationReason: employee.terminationReason ?? '',
      tenureMonths:
        employee.terminationDate === null ? 0 : monthsBetween(employee.hireDate, employee.terminationDate),
      month: employee.terminationDate ? monthKey(employee.terminationDate) : '',
    }));

    const tenures = rows.map((row) => Number(row['tenureMonths']));
    return {
      columns: [
        { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
        { key: 'employee', label: 'Employee', type: 'string' },
        { key: 'department', label: 'Department', type: 'string' },
        { key: 'position', label: 'Position', type: 'string' },
        { key: 'employmentType', label: 'Employment type', type: 'string' },
        { key: 'hireDate', label: 'Hire date', type: 'date' },
        { key: 'terminationDate', label: 'Termination date', type: 'date' },
        { key: 'terminationReason', label: 'Reason', type: 'string' },
        { key: 'tenureMonths', label: 'Tenure (months)', type: 'number' },
      ],
      rows,
      summary: {
        terminations: rows.length,
        averageTenureMonths: tenures.length === 0 ? 0 : round(tenures.reduce((sum, value) => sum + value, 0) / tenures.length, 1),
        reasons: new Set(rows.map((row) => String(row['terminationReason'])).filter(Boolean)).size,
      },
    };
  }

  private async demographicsReport(principal: Principal, query: ReportQueryDto): Promise<ReportResult> {
    const extra: Record<string, unknown> = { ...this.departmentFilters(query) };
    extra['status'] = query.status ?? { not: 'TERMINATED' };
    const where = await this.scope.employeeWhere(principal, extra);
    const employees = await this.prisma.client.employee.findMany({
      where,
      select: {
        gender: true,
        birthDate: true,
        hireDate: true,
        employmentType: true,
        department: { select: { name: true } },
        location: { select: { name: true } },
        position: { select: { title: true } },
      },
    });

    const dimensions = new Map<string, Map<string, number>>();
    const push = (dimension: string, value: string) => {
      const bucket = dimensions.get(dimension) ?? new Map<string, number>();
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
      dimensions.set(dimension, bucket);
    };

    for (const employee of employees) {
      push('Gender', employee.gender ?? 'UNDISCLOSED');
      push('Age bracket', ageBracket(employee.birthDate));
      push('Tenure bracket', tenureBracket(employee.hireDate));
      push('Employment type', employee.employmentType);
      push('Department', employee.department?.name ?? 'Unassigned');
      push('Location', employee.location?.name ?? 'Unassigned');
      push('Position', employee.position?.title ?? 'Unassigned');
    }

    const rows: ReportRow[] = [];
    for (const [dimension, bucket] of dimensions) {
      const total = [...bucket.values()].reduce((sum, count) => sum + count, 0);
      for (const [value, count] of [...bucket.entries()].sort((a, b) => b[1] - a[1])) {
        rows.push({
          dimension,
          value,
          count,
          percentage: total === 0 ? 0 : round((count / total) * 100, 2),
        });
      }
    }

    const ages = employees
      .filter((employee) => employee.birthDate !== null)
      .map((employee) => yearsBetween(employee.birthDate as Date, new Date()));
    const tenures = employees.map((employee) => yearsBetween(employee.hireDate, new Date()));

    return {
      columns: [
        { key: 'dimension', label: 'Dimension', type: 'string' },
        { key: 'value', label: 'Value', type: 'string' },
        { key: 'count', label: 'Employees', type: 'number' },
        { key: 'percentage', label: 'Share (%)', type: 'number' },
      ],
      rows,
      summary: {
        employees: employees.length,
        averageAge: ages.length === 0 ? 0 : round(ages.reduce((sum, value) => sum + value, 0) / ages.length, 1),
        averageTenureYears: tenures.length === 0 ? 0 : round(tenures.reduce((sum, value) => sum + value, 0) / tenures.length, 1),
      },
    };
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  /** Employee rows used by headcount-derived reports (scope + filters applied). */
  private async headcountSource(principal: Principal, query: ReportQueryDto) {
    const where = await this.scope.employeeWhere(principal, this.departmentFilters(query));
    return this.prisma.client.employee.findMany({
      where,
      select: { hireDate: true, terminationDate: true },
    });
  }

  private departmentFilters(query: ReportQueryDto): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (query.departmentId) filters['departmentId'] = query.departmentId;
    if (query.locationId) filters['locationId'] = query.locationId;
    return filters;
  }

  private async employeeLookup(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, { name: string; employeeNumber: string; department: string }>();
    const employees = await this.prisma.client.employee.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeNumber: true,
        department: { select: { name: true } },
      },
    });
    return new Map(
      employees.map((employee) => [
        employee.id,
        {
          name: `${employee.firstName} ${employee.lastName}`,
          employeeNumber: employee.employeeNumber,
          department: employee.department?.name ?? '',
        },
      ]),
    );
  }

  private resolvePeriod(query: ReportQueryDto, defaultDays: number): { from: Date; to: Date } {
    const to = query.to ? endOfDay(new Date(query.to)) : new Date();
    const from = query.from ? startOfDay(new Date(query.from)) : new Date(to.getTime() - defaultDays * 86_400_000);
    if (from > to) throw new ValidationError('"from" must be before "to"', { from: query.from, to: query.to });
    return { from, to };
  }

  private canSeeSalary(principal: Principal): boolean {
    return principal.isSuperAdmin || principal.permissions.includes('employees.salary.view');
  }

  private scopeLabel(principal: Principal): string {
    const visibility = this.scope.visibilityOf(principal);
    if (visibility === 'all') return 'company-wide';
    return visibility === 'team' ? 'own team' : 'own records';
  }

  private typeLabel(type: ReportType): string {
    return CATALOG.find((entry) => entry.type === type)?.name ?? type;
  }

  private assertType(type: string): asserts type is ReportType {
    if (!CATALOG.some((entry) => entry.type === type)) {
      throw new ValidationError(`Unknown report type "${type}"`, { allowed: CATALOG.map((entry) => entry.type) });
    }
  }

  private async assertReportPermission(principal: Principal, type: ReportType): Promise<void> {
    const entry = CATALOG.find((item) => item.type === type);
    if (!entry) throw new ValidationError(`Unknown report type "${type}"`);
    if (principal.isSuperAdmin) return;
    const missing = entry.permissions.filter((permission) => !principal.permissions.includes(permission));
    if (missing.length > 0) {
      throw new ForbiddenError(`Missing permission(s) for the ${type} report: ${missing.join(', ')}`, 'REPORT_FORBIDDEN');
    }
  }

  private filterSnapshot(query: ReportQueryDto | ReportExportDto): Record<string, unknown> {
    return {
      from: query.from,
      to: query.to,
      departmentId: query.departmentId,
      locationId: query.locationId,
      status: query.status,
      includeTerminated: query.includeTerminated,
    };
  }
}

const CATALOG: readonly ReportCatalogEntry[] = [
  { type: 'EMPLOYEES', name: 'Employee directory', description: 'Master list of employees with organisational placement and tenure.', permissions: ['employees.view'], salary: false },
  { type: 'HEADCOUNT', name: 'Headcount', description: 'Month-by-month headcount, hires, leavers and net change.', permissions: ['employees.view'], salary: false },
  { type: 'TURNOVER', name: 'Turnover', description: 'Monthly attrition with average headcount and turnover rate.', permissions: ['employees.view'], salary: false },
  { type: 'ABSENCE', name: 'Absence', description: 'Absent, half-day and leave days per employee from attendance records.', permissions: ['attendance.view'], salary: false },
  { type: 'LEAVE', name: 'Leave usage', description: 'Approved leave days per employee and leave type.', permissions: ['leave.view'], salary: false },
  { type: 'ATTENDANCE', name: 'Attendance', description: 'Attendance rate, worked hours, lateness and early leave per employee.', permissions: ['attendance.view'], salary: false },
  { type: 'OVERTIME', name: 'Overtime', description: 'Overtime hours recorded per employee.', permissions: ['attendance.view'], salary: false },
  { type: 'SALARY', name: 'Compensation', description: 'Current base salary per employee with payroll totals.', permissions: ['employees.salary.view'], salary: true },
  { type: 'DEPARTMENT', name: 'Departments', description: 'Per-department headcount, movement and average tenure.', permissions: ['departments.view'], salary: false },
  { type: 'HIRING', name: 'Hiring', description: 'New hires in the period with department and position breakdown.', permissions: ['employees.view'], salary: false },
  { type: 'TERMINATION', name: 'Terminations', description: 'Employees who left in the period, reasons and tenure.', permissions: ['employees.view'], salary: false },
  { type: 'DEMOGRAPHICS', name: 'Demographics', description: 'Workforce distribution by gender, age, tenure, type and location.', permissions: ['employees.view'], salary: false },
];

const ABSENCE_COLUMNS: ReportColumn[] = [
  { key: 'employee', label: 'Employee', type: 'string' },
  { key: 'employeeNumber', label: 'Employee no.', type: 'string' },
  { key: 'department', label: 'Department', type: 'string' },
  { key: 'absentDays', label: 'Absent days', type: 'number' },
  { key: 'halfDays', label: 'Half days', type: 'number' },
  { key: 'leaveDays', label: 'Leave days', type: 'number' },
  { key: 'lateDays', label: 'Late days', type: 'number' },
  { key: 'lateMinutes', label: 'Late minutes', type: 'number' },
  { key: 'absenceDays', label: 'Total absence days', type: 'number' },
];

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** First day of the month after `month` (exclusive upper bound). */
function monthEnd(month: string): Date {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year as number, monthNumber as number, 1, 0, 0, 0, 0));
}

function bucketMonths(from: Date, to: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= last && months.length < 120) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (months.length === 0) months.push(monthKey(to));
  return months;
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()),
  );
}

function yearsBetween(from: Date, to: Date): number {
  return round(monthsBetween(from, to) / 12, 1);
}

function ageBracket(birthDate: Date | null): string {
  if (!birthDate) return 'Unknown';
  const age = yearsBetween(birthDate, new Date());
  if (age < 25) return '< 25';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  if (age < 55) return '45-54';
  return '55+';
}

function tenureBracket(hireDate: Date): string {
  const years = yearsBetween(hireDate, new Date());
  if (years < 1) return '< 1 year';
  if (years < 3) return '1-2 years';
  if (years < 5) return '3-4 years';
  if (years < 10) return '5-9 years';
  return '10+ years';
}

function countBy(rows: ReportRow[], key: (row: ReportRow) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
