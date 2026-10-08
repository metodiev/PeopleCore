import { Injectable } from '@nestjs/common';
import type { Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  BenefitDto,
  CompensationChangeDto,
  ContractQueryDto,
  CreateContractDto,
  UpdateContractDto,
} from './dto/employment.dto.js';

const SORTABLE = ['createdAt', 'startDate', 'endDate', 'status'] as const;

/**
 * Contracts, compensation and benefits. Salary data is gated by the
 * `employees.salary.view` / `compensation.manage` permissions and every
 * change is recorded with old and new values in the audit trail.
 */
@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Contracts ─────────────────────────────────────────────────────────────

  async listContracts(principal: Principal, query: ContractQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { startDate: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.employeeId) where['employeeId'] = query.employeeId;
    if (query.status) where['status'] = query.status;
    if (query.endingWithinDays) {
      const until = new Date(Date.now() + query.endingWithinDays * 86_400_000);
      where['endDate'] = { not: null, lte: until };
    }

    const employeeScope = await this.scope.employeeWhere(principal);
    const finalWhere = { AND: [where, { employee: employeeScope }] };

    const [rows, total] = await Promise.all([
      this.prisma.client.contract.findMany({
        where: finalWhere,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true } },
          position: { select: { id: true, title: true } },
        },
      }),
      this.prisma.client.contract.count({ where: finalWhere }),
    ]);

    const canSeeSalary = principal.permissions.includes('employees.salary.view') || principal.isSuperAdmin;
    return paginate(
      rows.map((contract) => ({
        ...contract,
        salaryAmount: canSeeSalary ? contract.salaryAmount : undefined,
      })),
      total,
      query,
    );
  }

  async createContract(principal: Principal, dto: CreateContractDto) {
    const employee = await this.prisma.client.employee.findFirst({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (dto.endDate && new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new ValidationError('Contract end date must be after the start date');
    }

    const contract = await this.prisma.client.contract.create({
      data: tenantScoped({
        employeeId: dto.employeeId,
        type: dto.type,
        status: dto.status ?? 'ACTIVE',
        number: dto.number,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        probationEndDate: dto.probationEndDate ? new Date(dto.probationEndDate) : null,
        salaryAmount: dto.salaryAmount,
        currency: dto.currency ?? 'EUR',
        workingHoursPerWeek: dto.workingHoursPerWeek ?? employee.workingHoursPerWeek ?? undefined,
        positionId: dto.positionId ?? employee.positionId ?? undefined,
        documentId: dto.documentId,
        notes: dto.notes,
        createdById: principal.userId,
        signedAt: dto.status === 'ACTIVE' ? new Date() : null,
      }),
    });

    if (dto.salaryAmount !== undefined) {
      await this.recordCompensation(principal, dto.employeeId, {
        type: 'BASE_SALARY',
        newAmount: dto.salaryAmount,
        effectiveDate: dto.startDate,
        reason: `Contract ${contract.number ?? contract.id} created`,
        currency: dto.currency ?? 'EUR',
      });
    }

    await this.audit.record({
      action: 'contract.create',
      entityType: 'Contract',
      entityId: contract.id,
      actorUserId: principal.userId,
      after: contract,
    });
    return contract;
  }

  async updateContract(principal: Principal, contractId: string, dto: UpdateContractDto) {
    const before = await this.prisma.client.contract.findFirst({ where: { id: contractId } });
    if (!before) throw new NotFoundError('Contract', 'CONTRACT_NOT_FOUND');

    const updated = await this.prisma.client.contract.update({
      where: { id: contractId },
      data: {
        type: dto.type,
        status: dto.status,
        number: dto.number,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
        probationEndDate:
          dto.probationEndDate === undefined ? undefined : dto.probationEndDate ? new Date(dto.probationEndDate) : null,
        salaryAmount: dto.salaryAmount,
        currency: dto.currency,
        workingHoursPerWeek: dto.workingHoursPerWeek,
        positionId: dto.positionId,
        documentId: dto.documentId,
        notes: dto.notes,
      },
    });

    await this.audit.record({
      action: 'contract.update',
      entityType: 'Contract',
      entityId: contractId,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  /** Contracts, probations and certifications that need attention soon. */
  async expiringItems(principal: Principal, days = 60) {
    const until = new Date(Date.now() + days * 86_400_000);
    const employeeScope = await this.scope.employeeWhere(principal);

    const [contracts, probations, certifications, documents] = await Promise.all([
      this.prisma.client.contract.findMany({
        where: { AND: [{ status: 'ACTIVE', endDate: { not: null, lte: until } }, { employee: employeeScope }] },
        include: { employee: { select: { id: true, firstName: true, lastName: true, workEmail: true } } },
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.client.contract.findMany({
        where: { AND: [{ status: 'ACTIVE', probationEndDate: { not: null, lte: until } }, { employee: employeeScope }] },
        include: { employee: { select: { id: true, firstName: true, lastName: true, workEmail: true } } },
        orderBy: { probationEndDate: 'asc' },
      }),
      this.prisma.client.certification.findMany({
        where: { AND: [{ expiresAt: { not: null, lte: until } }, { employee: employeeScope }] },
        include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.client.document.findMany({
        where: { AND: [{ expiresAt: { not: null, lte: until }, status: 'ACTIVE' }, { employee: employeeScope }] },
        include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    return { contracts, probations, certifications, documents };
  }

  // ── Compensation ──────────────────────────────────────────────────────────

  async listCompensation(principal: Principal, employeeId: string) {
    await this.assertSalaryAccess(principal);
    await this.scope.assertEmployeeAccess(principal, employeeId);

    const history = await this.prisma.client.compensationChange.findMany({
      where: { employeeId },
      orderBy: { effectiveDate: 'desc' },
    });
    const current = history[0] ?? null;
    return { current, history };
  }

  async recordCompensation(principal: Principal, employeeId: string, dto: CompensationChangeDto) {
    await this.assertSalaryAccess(principal);
    const previous = await this.prisma.client.compensationChange.findFirst({
      where: { employeeId, type: dto.type },
      orderBy: { effectiveDate: 'desc' },
    });

    const change = await this.prisma.client.compensationChange.create({
      data: tenantScoped({
        employeeId,
        type: dto.type,
        oldAmount: previous?.newAmount ?? null,
        newAmount: dto.newAmount,
        currency: dto.currency ?? previous?.currency ?? 'EUR',
        effectiveDate: new Date(dto.effectiveDate),
        reason: dto.reason,
        changedById: principal.userId,
      }),
    });

    await this.audit.record({
      action: 'compensation.change',
      entityType: 'CompensationChange',
      entityId: change.id,
      actorUserId: principal.userId,
      before: previous ? { amount: Number(previous.newAmount), effectiveDate: previous.effectiveDate } : undefined,
      after: { amount: dto.newAmount, effectiveDate: dto.effectiveDate, reason: dto.reason, type: dto.type },
    });
    return change;
  }

  // ── Benefits ──────────────────────────────────────────────────────────────

  async listBenefits(principal: Principal, employeeId: string) {
    await this.scope.assertEmployeeAccess(principal, employeeId);
    return this.prisma.client.benefit.findMany({ where: { employeeId }, orderBy: { startDate: 'desc' } });
  }

  async addBenefit(principal: Principal, employeeId: string, dto: BenefitDto) {
    const employee = await this.prisma.client.employee.findFirst({ where: { id: employeeId } });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const benefit = await this.prisma.client.benefit.create({
      data: tenantScoped({
        employeeId,
        type: dto.type,
        name: dto.name,
        provider: dto.provider,
        amount: dto.amount,
        currency: dto.currency ?? 'EUR',
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        isActive: dto.isActive ?? true,
        notes: dto.notes,
      }),
    });
    await this.audit.record({
      action: 'benefit.create',
      entityType: 'Benefit',
      entityId: benefit.id,
      actorUserId: principal.userId,
      after: benefit,
    });
    return benefit;
  }

  async removeBenefit(principal: Principal, benefitId: string) {
    const benefit = await this.prisma.client.benefit.findFirst({ where: { id: benefitId } });
    if (!benefit) throw new NotFoundError('Benefit', 'BENEFIT_NOT_FOUND');
    await this.prisma.client.benefit.delete({ where: { id: benefitId } });
    await this.audit.record({
      action: 'benefit.delete',
      entityType: 'Benefit',
      entityId: benefitId,
      actorUserId: principal.userId,
      before: benefit,
    });
    return { deleted: true };
  }

  private async assertSalaryAccess(principal: Principal): Promise<void> {
    const allowed =
      principal.isSuperAdmin ||
      principal.permissions.includes('employees.salary.view') ||
      principal.permissions.includes('compensation.view');
    if (!allowed) {
      throw new ForbiddenError('Compensation data requires additional permissions', 'SALARY_FORBIDDEN');
    }
  }
}
