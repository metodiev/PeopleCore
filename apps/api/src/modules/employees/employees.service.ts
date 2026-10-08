import { Inject, Injectable } from '@nestjs/common';
import type { Paginated, Principal } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { CryptoService } from '../../common/utils/crypto.util.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { ScopeService } from './scope.service.js';
import type { CreateEmployeeDto, EmployeeQueryDto, TerminateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto.js';

const SORTABLE = ['createdAt', 'firstName', 'lastName', 'hireDate', 'employeeNumber', 'status'] as const;

export interface EmployeeListFilters extends EmployeeQueryDto {}

/**
 * Employee records: CRUD, directory search, employment data and termination.
 * Every query is restricted by {@link ScopeService} so managers only reach
 * their own organisation unit and employees only their own record.
 */
@Injectable()
export class EmployeesService {
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
  }

  async list(principal: Principal, query: EmployeeQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { lastName: 'asc' });

    const filters: Record<string, unknown> = {};
    if (query.status) filters['status'] = query.status;
    else if (!query.includeTerminated) filters['status'] = { not: 'TERMINATED' };
    if (query.departmentId) filters['departmentId'] = query.departmentId;
    if (query.teamId) filters['teamId'] = query.teamId;
    if (query.locationId) filters['locationId'] = query.locationId;
    if (query.managerId) filters['managerId'] = query.managerId;
    if (query.employmentType) filters['employmentType'] = query.employmentType;
    if (query.search) {
      filters['OR'] = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { workEmail: { contains: query.search, mode: 'insensitive' } },
        { employeeNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const where = await this.scope.employeeWhere(principal, filters);

    const [rows, total] = await Promise.all([
      this.prisma.client.employee.findMany({
        where,
        skip,
        take,
        orderBy,
        select: {
          id: true,
          employeeNumber: true,
          firstName: true,
          lastName: true,
          preferredName: true,
          photoUrl: true,
          workEmail: true,
          phone: true,
          status: true,
          hireDate: true,
          terminationDate: true,
          employmentType: true,
          department: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          position: { select: { id: true, title: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.employee.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  /** Full profile including the caller's own employee record. */
  async me(principal: Principal) {
    if (!principal.employeeId) return null;
    return this.get(principal, principal.employeeId);
  }

  async get(principal: Principal, employeeId: string) {
    await this.scope.assertEmployeeAccess(principal, employeeId);

    const employee = await this.prisma.client.employee.findFirst({
      where: { id: employeeId },
      include: {
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
        manager: { select: { id: true, firstName: true, lastName: true, photoUrl: true } },
        schedule: true,
        user: { select: { id: true, email: true, status: true, mfaEnabled: true, lastLoginAt: true } },
      },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    return this.maskSensitive(principal, employee);
  }

  async create(principal: Principal, dto: CreateEmployeeDto) {
    const workEmail = dto.workEmail.toLowerCase();
    const existing = await this.prisma.client.employee.findFirst({ where: { workEmail } });
    if (existing) throw new ConflictError('An employee with this work email already exists', 'WORK_EMAIL_TAKEN');

    await this.assertReferences(dto);

    const employeeNumber = dto.employeeNumber ?? (await this.nextEmployeeNumber());

    const employee = await this.prisma.transaction(async (tx) => {
      const created = await tx.employee.create({
        data: tenantScoped({
          employeeNumber,
          firstName: dto.firstName,
          lastName: dto.lastName,
          workEmail,
          personalEmail: dto.personalEmail,
          phone: dto.phone,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          gender: dto.gender,
          address: dto.address,
          city: dto.city,
          country: dto.country,
          nationalIdEnc: this.crypto.encryptOptional(dto.nationalId),
          hireDate: new Date(dto.hireDate),
          employmentType: dto.employmentType ?? 'FULL_TIME',
          workingHoursPerWeek: dto.workingHoursPerWeek,
          managerId: dto.managerId,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          locationId: dto.locationId,
          positionId: dto.positionId,
          scheduleId: dto.scheduleId,
          status: 'ACTIVE',
        }),
      });

      await tx.employmentHistory.create({
        data: tenantScoped({
          employeeId: created.id,
          departmentId: dto.departmentId,
          positionId: dto.positionId,
          managerId: dto.managerId,
          locationId: dto.locationId,
          effectiveFrom: new Date(dto.hireDate),
          changeReason: 'HIRE',
          createdById: principal.userId,
        }),
      });

      await this.seedLeaveBalances(tx, created.id, new Date(dto.hireDate));
      return created;
    });

    if (dto.createUserAccount) {
      await this.users.create(
        principal.tenantId!,
        {
          email: workEmail,
          firstName: dto.firstName,
          lastName: dto.lastName,
          roleKeys: dto.roleKeys ?? ['EMPLOYEE'],
          employeeId: employee.id,
        },
        principal.userId,
      );
    }

    await this.audit.record({
      action: 'employee.create',
      entityType: 'Employee',
      entityId: employee.id,
      actorUserId: principal.userId,
      after: { ...employee, nationalIdEnc: employee.nationalIdEnc ? '[encrypted]' : null },
    });
    return { id: employee.id, employeeNumber: employee.employeeNumber };
  }

  async update(principal: Principal, employeeId: string, dto: UpdateEmployeeDto) {
    await this.scope.assertEmployeeAccess(principal, employeeId);
    const before = await this.prisma.client.employee.findFirst({ where: { id: employeeId } });
    if (!before) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    await this.assertReferences(dto);

    const organizationalChange =
      (dto.departmentId !== undefined && dto.departmentId !== before.departmentId) ||
      (dto.positionId !== undefined && dto.positionId !== before.positionId) ||
      (dto.managerId !== undefined && dto.managerId !== before.managerId) ||
      (dto.locationId !== undefined && dto.locationId !== before.locationId);

    const updated = await this.prisma.transaction(async (tx) => {
      const result = await tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          personalEmail: dto.personalEmail,
          phone: dto.phone,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          gender: dto.gender,
          address: dto.address,
          city: dto.city,
          country: dto.country,
          ...(dto.nationalId !== undefined ? { nationalIdEnc: this.crypto.encryptOptional(dto.nationalId) } : {}),
          employmentType: dto.employmentType,
          workingHoursPerWeek: dto.workingHoursPerWeek,
          managerId: dto.managerId,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          locationId: dto.locationId,
          positionId: dto.positionId,
          scheduleId: dto.scheduleId,
          status: dto.status,
        },
      });

      if (organizationalChange) {
        await tx.employmentHistory.updateMany({
          where: { employeeId, effectiveTo: null },
          data: { effectiveTo: new Date() },
        });
        await tx.employmentHistory.create({
          data: tenantScoped({
            employeeId,
            departmentId: result.departmentId,
            positionId: result.positionId,
            managerId: result.managerId,
            locationId: result.locationId,
            effectiveFrom: new Date(),
            changeReason: 'ORG_CHANGE',
            createdById: principal.userId,
          }),
        });
      }
      return result;
    });

    await this.audit.record({
      action: 'employee.update',
      entityType: 'Employee',
      entityId: employeeId,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  /** Ends employment: revokes the login, closes contracts and records history. */
  async terminate(principal: Principal, employeeId: string, dto: TerminateEmployeeDto) {
    const employee = await this.prisma.client.employee.findFirst({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (employee.status === 'TERMINATED') throw new ConflictError('Employee is already terminated', 'ALREADY_TERMINATED');

    const terminationDate = new Date(dto.terminationDate);
    await this.prisma.transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: { status: 'TERMINATED', terminationDate, terminationReason: dto.reason },
      });
      await tx.employmentHistory.updateMany({
        where: { employeeId, effectiveTo: null },
        data: { effectiveTo: terminationDate },
      });
      await tx.contract.updateMany({
        where: { employeeId, status: { in: ['ACTIVE', 'DRAFT'] } },
        data: { status: 'TERMINATED', terminatedAt: terminationDate, terminationReason: dto.reason },
      });
      await tx.leaveRequest.updateMany({
        where: { employeeId, status: 'PENDING' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.leaveBalance.updateMany({
        where: { employeeId, year: terminationDate.getUTCFullYear() },
        data: { pending: 0 },
      });
    });

    if (employee.userId) {
      await this.users.update(
        principal.tenantId!,
        employee.userId,
        { status: 'DISABLED' },
        principal.userId,
      );
    }

    await this.audit.record({
      action: 'employee.terminate',
      entityType: 'Employee',
      entityId: employeeId,
      actorUserId: principal.userId,
      before: { status: employee.status },
      after: { status: 'TERMINATED', terminationDate: terminationDate.toISOString(), reason: dto.reason },
    });
    return { terminated: true };
  }

  async history(principal: Principal, employeeId: string) {
    await this.scope.assertEmployeeAccess(principal, employeeId);
    return this.prisma.client.employmentHistory.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Hides sensitive fields unless the caller holds the matching permission. */
  maskSensitive<T extends { nationalIdEnc?: string | null }>(principal: Principal, employee: T) {
    const canSeeSensitive = principal.permissions.includes('employees.sensitive.view') || principal.isSuperAdmin;
    const canSeeSalary = principal.permissions.includes('employees.salary.view') || principal.isSuperAdmin;
    return {
      ...employee,
      nationalId: canSeeSensitive ? this.decryptSafe(employee.nationalIdEnc) : undefined,
      nationalIdEnc: undefined,
      _permissions: { sensitive: canSeeSensitive, salary: canSeeSalary },
    };
  }

  decryptSafe(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      return this.crypto.decrypt(value);
    } catch {
      return null;
    }
  }

  encrypt(value: string | null | undefined): string | null {
    return this.crypto.encryptOptional(value);
  }

  /** Prisma delegate access for the profile service. */
  get db() {
    return this.prisma.client;
  }

  private async assertReferences(dto: Partial<CreateEmployeeDto & UpdateEmployeeDto>): Promise<void> {
    const checks: [string | undefined, (id: string) => Promise<unknown>, string][] = [
      [dto.departmentId, (id) => this.prisma.client.department.findFirst({ where: { id } }), 'Department'],
      [dto.teamId, (id) => this.prisma.client.team.findFirst({ where: { id } }), 'Team'],
      [dto.locationId, (id) => this.prisma.client.location.findFirst({ where: { id } }), 'Location'],
      [dto.positionId, (id) => this.prisma.client.position.findFirst({ where: { id } }), 'Position'],
      [dto.scheduleId, (id) => this.prisma.client.workSchedule.findFirst({ where: { id } }), 'Work schedule'],
      [dto.managerId, (id) => this.prisma.client.employee.findFirst({ where: { id } }), 'Manager'],
    ];
    for (const [id, check, label] of checks) {
      if (!id) continue;
      const found = await check(id);
      if (!found) throw new ValidationError(`${label} does not exist`);
    }
  }

  private async nextEmployeeNumber(): Promise<string> {
    const total = await this.prisma.client.employee.count();
    return `EMP-${String(total + 1).padStart(4, '0')}`;
  }

  /** Creates a leave balance row per active leave type for the hire year. */
  private async seedLeaveBalances(tx: PrismaTransaction, employeeId: string, hireDate: Date): Promise<void> {
    const year = hireDate.getUTCFullYear();
    const leaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
    if (leaveTypes.length === 0) return;

    const tenantId = this.prisma.currentTenantIdOrThrow();
    await tx.leaveBalance.createMany({
      data: leaveTypes.map((leaveType) => ({
        tenantId,
        employeeId,
        leaveTypeId: leaveType.id,
        year,
        entitled: leaveType.defaultDaysPerYear ?? 0,
      })),
      skipDuplicates: true,
    });
  }
}
