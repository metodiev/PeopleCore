import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import {
  ACCOUNTING_EXPORT_PORT,
  type AccountingExportPort,
  type AccountingExportRow,
} from './accounting-export.port.js';
import type {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ExpenseCategoryQueryDto,
  ExpenseQueryDto,
  ExpenseSummaryQueryDto,
  ExportExpensesDto,
  ReviewExpenseDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/expenses.dto.js';

const SORTABLE_CATEGORIES = ['createdAt', 'key', 'name'] as const;
const SORTABLE_EXPENSES = ['createdAt', 'expenseDate', 'amount', 'status', 'submittedAt'] as const;

/** Statuses an owner may still edit. */
const EDITABLE_STATUSES = ['DRAFT', 'CHANGES_REQUESTED'];
const CANCELLABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED'];

export interface ExpenseEvent {
  tenantId: string;
  expenseId: string;
  employeeId: string;
  managerUserId: string | null;
  amount: number;
  currency: string;
}

/**
 * Expense claims: categories with receipt/amount rules, the employee
 * create → submit flow, the approver decision flow and the finance-side
 * reimbursement + accounting export.
 *
 * Visibility: employees see their own claims, managers their team, and
 * `expenses.manage` holders (HR / finance) the whole company.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    @Inject(ACCOUNTING_EXPORT_PORT) private readonly accountingExport: AccountingExportPort,
  ) {}

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(query: ExpenseCategoryQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_CATEGORIES, { name: 'asc' });
    const where: Record<string, unknown> = {};
    if (!query.includeInactive) where['isActive'] = true;
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { key: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.expenseCategory.findMany({ where, skip, take, orderBy, include: { _count: { select: { expenses: true } } } }),
      this.prisma.client.expenseCategory.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeCategory(row)), total, query);
  }

  async createCategory(principal: Principal, dto: CreateExpenseCategoryDto) {
    const key = dto.key.toUpperCase();
    const existing = await this.prisma.client.expenseCategory.findFirst({ where: { key } });
    if (existing) throw new ConflictError(`Expense category "${key}" already exists`, 'EXPENSE_CATEGORY_EXISTS');

    const category = await this.prisma.client.expenseCategory.create({
      data: tenantScoped({
        key,
        name: dto.name,
        description: dto.description,
        requiresReceipt: dto.requiresReceipt ?? true,
        maxAmount: dto.maxAmount,
        isActive: dto.isActive ?? true,
      }),
    });
    await this.audit.record({
      action: 'expenseCategory.create',
      entityType: 'ExpenseCategory',
      entityId: category.id,
      actorUserId: principal.userId,
      after: { key: category.key, name: category.name, requiresReceipt: category.requiresReceipt },
    });
    return this.serializeCategory(category);
  }

  async updateCategory(principal: Principal, id: string, dto: UpdateExpenseCategoryDto) {
    const before = await this.prisma.client.expenseCategory.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Expense category', 'EXPENSE_CATEGORY_NOT_FOUND');

    const updated = await this.prisma.client.expenseCategory.update({
      where: { id },
      data: {
        key: dto.key ? dto.key.toUpperCase() : undefined,
        name: dto.name,
        description: dto.description,
        requiresReceipt: dto.requiresReceipt,
        maxAmount: dto.maxAmount,
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      action: 'expenseCategory.update',
      entityType: 'ExpenseCategory',
      entityId: id,
      actorUserId: principal.userId,
      before: { name: before.name, requiresReceipt: before.requiresReceipt, maxAmount: before.maxAmount?.toString() ?? null },
      after: {
        name: updated.name,
        requiresReceipt: updated.requiresReceipt,
        maxAmount: updated.maxAmount?.toString() ?? null,
      },
    });
    return this.serializeCategory(updated);
  }

  async deleteCategory(principal: Principal, id: string) {
    const category = await this.prisma.client.expenseCategory.findFirst({ where: { id } });
    if (!category) throw new NotFoundError('Expense category', 'EXPENSE_CATEGORY_NOT_FOUND');

    const used = await this.prisma.client.expense.count({ where: { categoryId: id } });
    if (used > 0) {
      throw new ConflictError(
        `This category is used by ${used} expense(s) — deactivate it instead of deleting`,
        'EXPENSE_CATEGORY_IN_USE',
      );
    }

    await this.prisma.client.expenseCategory.delete({ where: { id } });
    await this.audit.record({
      action: 'expenseCategory.delete',
      entityType: 'ExpenseCategory',
      entityId: id,
      actorUserId: principal.userId,
      before: { key: category.key, name: category.name },
    });
    return { deleted: true };
  }

  // ── Employee flow ─────────────────────────────────────────────────────────

  async create(principal: Principal, dto: CreateExpenseDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('employeeId is required — the caller has no employee record');
    if (employeeId !== principal.employeeId) {
      if (!this.canSeeEveryone(principal)) {
        throw new ForbiddenError('You can only file expenses for yourself', 'EXPENSE_SCOPE_DENIED');
      }
      await this.scope.assertEmployeeAccess(principal, employeeId);
    }

    const category = await this.prisma.client.expenseCategory.findFirst({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundError('Expense category', 'EXPENSE_CATEGORY_NOT_FOUND');
    if (!category.isActive) throw new ValidationError('This expense category is deactivated', { code: 'CATEGORY_INACTIVE' });
    this.validateAgainstCategory(category, dto.amount, dto.receiptDocumentId);

    const expense = await this.prisma.client.expense.create({
      data: tenantScoped({
        employeeId,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        currency: (dto.currency ?? 'EUR').toUpperCase(),
        expenseDate: new Date(dto.expenseDate),
        receiptDocumentId: dto.receiptDocumentId,
        status: 'DRAFT',
      }),
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: 'expense.create',
      entityType: 'Expense',
      entityId: expense.id,
      actorUserId: principal.userId,
      after: { employeeId, categoryKey: category.key, amount: Number(expense.amount), currency: expense.currency },
    });
    return this.serializeExpense(expense);
  }

  async update(principal: Principal, id: string, dto: UpdateExpenseDto) {
    const expense = await this.loadExpense(principal, id);
    this.assertOwnerOrManager(principal, expense);
    if (!EDITABLE_STATUSES.includes(expense.status)) {
      throw new ConflictError(`A ${expense.status.toLowerCase()} expense can no longer be edited`, 'EXPENSE_NOT_EDITABLE');
    }

    const categoryId = dto.categoryId ?? expense.categoryId;
    const category = await this.prisma.client.expenseCategory.findFirst({ where: { id: categoryId } });
    if (!category) throw new NotFoundError('Expense category', 'EXPENSE_CATEGORY_NOT_FOUND');
    const amount = dto.amount ?? Number(expense.amount);
    const receiptDocumentId = dto.receiptDocumentId ?? expense.receiptDocumentId ?? undefined;
    this.validateAgainstCategory(category, amount, receiptDocumentId);

    const updated = await this.prisma.client.expense.update({
      where: { id },
      data: {
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ? dto.currency.toUpperCase() : undefined,
        expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : undefined,
        receiptDocumentId: dto.receiptDocumentId,
      },
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: 'expense.update',
      entityType: 'Expense',
      entityId: id,
      actorUserId: principal.userId,
      before: { amount: Number(expense.amount), categoryId: expense.categoryId, status: expense.status },
      after: { amount: Number(updated.amount), categoryId: updated.categoryId, status: updated.status },
    });
    return this.serializeExpense(updated);
  }

  async submit(principal: Principal, id: string) {
    const expense = await this.loadExpense(principal, id);
    this.assertOwnerOrManager(principal, expense);
    if (!EDITABLE_STATUSES.includes(expense.status)) {
      throw new ConflictError(`Only a draft or changes-requested expense can be submitted (current: ${expense.status})`, 'EXPENSE_NOT_SUBMITTABLE');
    }

    const updated = await this.prisma.client.expense.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: 'expense.submit',
      entityType: 'Expense',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: expense.status },
      after: { status: updated.status },
    });
    this.events.emit('expense.submitted', await this.buildEvent(principal, updated));
    return this.serializeExpense(updated);
  }

  async cancel(principal: Principal, id: string) {
    const expense = await this.loadExpense(principal, id);
    this.assertOwnerOrManager(principal, expense);
    if (!CANCELLABLE_STATUSES.includes(expense.status)) {
      throw new ConflictError(`A ${expense.status.toLowerCase()} expense cannot be cancelled`, 'EXPENSE_NOT_CANCELLABLE');
    }

    const updated = await this.prisma.client.expense.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: 'expense.cancel',
      entityType: 'Expense',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: expense.status },
      after: { status: updated.status },
    });
    return this.serializeExpense(updated);
  }

  // ── Approver flow ─────────────────────────────────────────────────────────

  async approve(principal: Principal, id: string, dto: ReviewExpenseDto) {
    return this.decide(principal, id, 'APPROVED', dto.reviewNote, 'expense.approved');
  }

  async reject(principal: Principal, id: string, dto: ReviewExpenseDto) {
    if (!dto.reviewNote?.trim()) throw new ValidationError('A reason is required to reject an expense');
    return this.decide(principal, id, 'REJECTED', dto.reviewNote, 'expense.rejected');
  }

  async requestChanges(principal: Principal, id: string, dto: ReviewExpenseDto) {
    if (!dto.reviewNote?.trim()) throw new ValidationError('A note is required to request changes');
    return this.decide(principal, id, 'CHANGES_REQUESTED', dto.reviewNote, 'expense.changes_requested');
  }

  async reimburse(principal: Principal, id: string, dto: ReviewExpenseDto) {
    const expense = await this.loadExpense(principal, id);
    if (expense.status !== 'APPROVED') {
      throw new ConflictError('Only an approved expense can be reimbursed', 'EXPENSE_NOT_APPROVED');
    }

    const updated = await this.prisma.client.expense.update({
      where: { id },
      data: { status: 'REIMBURSED', reimbursedAt: new Date(), reviewNote: dto.reviewNote ?? expense.reviewNote },
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: 'expense.reimburse',
      entityType: 'Expense',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: expense.status },
      after: { status: updated.status },
    });
    this.events.emit('expense.reimbursed', await this.buildEvent(principal, updated));
    return this.serializeExpense(updated);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(principal: Principal, query: ExpenseQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_EXPENSES, { createdAt: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.categoryId) filters.push({ categoryId: query.categoryId });
    if (query.from || query.to) {
      filters.push({
        expenseDate: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }
    if (query.minAmount !== undefined || query.maxAmountLimit !== undefined) {
      filters.push({
        amount: {
          ...(query.minAmount !== undefined ? { gte: query.minAmount } : {}),
          ...(query.maxAmountLimit !== undefined ? { lte: query.maxAmountLimit } : {}),
        },
      });
    }

    if (query.employeeId) {
      if (query.employeeId !== principal.employeeId) await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else {
      filters.push({ employee: await this.expenseScope(principal) });
    }
    if (query.search) {
      filters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          category: { select: { id: true, key: true, name: true, maxAmount: true, requiresReceipt: true } },
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        },
      }),
      this.prisma.client.expense.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeExpense(row)), total, query);
  }

  async get(principal: Principal, id: string) {
    const expense = await this.prisma.client.expense.findFirst({
      where: { id },
      include: {
        category: true,
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, workEmail: true } },
      },
    });
    if (!expense) throw new NotFoundError('Expense', 'EXPENSE_NOT_FOUND');
    await this.assertReadAccess(principal, expense.employeeId);
    return this.serializeExpense(expense);
  }

  /** Totals by status and category — the finance view of submitted claims. */
  async summary(principal: Principal, query: ExpenseSummaryQueryDto) {
    const filters: Record<string, unknown>[] = [{ employee: await this.expenseScope(principal) }];
    if (query.employeeId) {
      if (query.employeeId !== principal.employeeId) await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    }
    if (query.from || query.to) {
      filters.push({
        expenseDate: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }
    const where = { AND: filters };

    const [byStatus, byCategory, categories] = await Promise.all([
      this.prisma.client.expense.groupBy({ by: ['status', 'currency'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.client.expense.groupBy({ by: ['categoryId', 'currency'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.client.expenseCategory.findMany({ select: { id: true, key: true, name: true } }),
    ]);

    const categoryById = new Map(categories.map((category) => [category.id, category]));
    return {
      from: query.from ?? null,
      to: query.to ?? null,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        currency: row.currency,
        count: row._count._all,
        total: Number(row._sum.amount ?? 0),
      })),
      byCategory: byCategory.map((row) => ({
        categoryId: row.categoryId,
        categoryKey: categoryById.get(row.categoryId)?.key ?? null,
        categoryName: categoryById.get(row.categoryId)?.name ?? null,
        currency: row.currency,
        count: row._count._all,
        total: Number(row._sum.amount ?? 0),
      })),
    };
  }

  /** Accounting export of approved + reimbursed expenses through the port. */
  async export(principal: Principal, dto: ExportExpensesDto) {
    const filters: Record<string, unknown>[] = [
      { employee: await this.expenseScope(principal) },
      { status: dto.status ?? { in: ['APPROVED', 'REIMBURSED'] } },
    ];
    if (dto.from || dto.to) {
      filters.push({
        expenseDate: {
          ...(dto.from ? { gte: new Date(dto.from) } : {}),
          ...(dto.to ? { lte: new Date(dto.to) } : {}),
        },
      });
    }

    const expenses = await this.prisma.client.expense.findMany({
      where: { AND: filters },
      orderBy: { expenseDate: 'asc' },
      include: {
        category: { select: { key: true, name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    const rows: AccountingExportRow[] = expenses.map((expense) => ({
      id: expense.id,
      employeeId: expense.employeeId,
      employeeName: `${expense.employee.firstName} ${expense.employee.lastName}`,
      categoryKey: expense.category.key,
      categoryName: expense.category.name,
      title: expense.title,
      description: expense.description,
      amount: Number(expense.amount),
      currency: expense.currency,
      expenseDate: expense.expenseDate.toISOString().slice(0, 10),
      status: expense.status,
      submittedAt: expense.submittedAt?.toISOString() ?? null,
      reviewedAt: expense.reviewedAt?.toISOString() ?? null,
      reimbursedAt: expense.reimbursedAt?.toISOString() ?? null,
      reviewNote: expense.reviewNote,
    }));

    const result = await this.accountingExport.export({
      tenantId: principal.tenantId!,
      rows,
      from: dto.from,
      to: dto.to,
    });
    await this.audit.record({
      action: 'expense.export',
      entityType: 'Expense',
      actorUserId: principal.userId,
      metadata: { rowCount: result.rowCount, from: dto.from ?? null, to: dto.to ?? null, status: dto.status ?? null },
    });
    return result;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async decide(
    principal: Principal,
    id: string,
    status: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
    reviewNote: string | undefined,
    eventName: string,
  ) {
    const expense = await this.loadExpense(principal, id);
    if (expense.status !== 'SUBMITTED') {
      throw new ConflictError(`Only a submitted expense can be ${status.toLowerCase()} (current: ${expense.status})`, 'EXPENSE_NOT_SUBMITTABLE');
    }
    if (expense.employeeId === principal.employeeId && !principal.isSuperAdmin) {
      throw new ForbiddenError('You cannot decide on your own expense claim', 'EXPENSE_SELF_APPROVAL');
    }

    const updated = await this.prisma.client.expense.update({
      where: { id },
      data: { status, reviewNote, reviewedById: principal.userId, reviewedAt: new Date() },
      include: { category: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    await this.audit.record({
      action: `expense.${status.toLowerCase()}`,
      entityType: 'Expense',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: expense.status },
      after: { status: updated.status, reviewNote },
    });
    this.events.emit(eventName, await this.buildEvent(principal, updated));
    return this.serializeExpense(updated);
  }

  private async buildEvent(
    principal: Principal,
    expense: { id: string; employeeId: string; amount: unknown; currency: string },
  ): Promise<ExpenseEvent> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: expense.employeeId },
      select: { manager: { select: { userId: true } } },
    });
    return {
      tenantId: principal.tenantId!,
      expenseId: expense.id,
      employeeId: expense.employeeId,
      managerUserId: employee?.manager?.userId ?? null,
      amount: Number(expense.amount),
      currency: expense.currency,
    };
  }

  private validateAgainstCategory(
    category: { name: string; maxAmount: unknown; requiresReceipt: boolean },
    amount: number,
    receiptDocumentId?: string,
  ): void {
    if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('The amount must be greater than zero');
    if (category.maxAmount !== null && category.maxAmount !== undefined && amount > Number(category.maxAmount)) {
      throw new ValidationError(
        `The amount exceeds the ${category.name} limit of ${Number(category.maxAmount)}`,
        { code: 'CATEGORY_LIMIT_EXCEEDED', maxAmount: Number(category.maxAmount), amount },
      );
    }
    if (category.requiresReceipt && !receiptDocumentId) {
      throw new ValidationError(`A receipt must be attached to a ${category.name} expense`, { code: 'RECEIPT_REQUIRED' });
    }
  }

  private async loadExpense(principal: Principal, id: string) {
    const expense = await this.prisma.client.expense.findFirst({ where: { id } });
    if (!expense) throw new NotFoundError('Expense', 'EXPENSE_NOT_FOUND');
    await this.assertReadAccess(principal, expense.employeeId);
    return expense;
  }

  private async assertReadAccess(principal: Principal, employeeId: string): Promise<void> {
    if (employeeId === principal.employeeId) return;
    if (this.canSeeEveryone(principal)) return;
    await this.scope.assertEmployeeAccess(principal, employeeId);
  }

  private assertOwnerOrManager(principal: Principal, expense: { employeeId: string }): void {
    if (expense.employeeId === principal.employeeId) return;
    if (this.canSeeEveryone(principal)) return;
    throw new ForbiddenError('You can only change your own expenses', 'EXPENSE_SCOPE_DENIED');
  }

  /**
   * Expense visibility spans HR/finance (`expenses.manage`) and the employee's
   * own team, which the employee-scope service alone cannot express.
   */
  private async expenseScope(principal: Principal): Promise<Record<string, unknown>> {
    if (this.canSeeEveryone(principal)) return {};
    return this.scope.employeeWhere(principal);
  }

  private canSeeEveryone(principal: Principal): boolean {
    return (
      principal.isSuperAdmin ||
      principal.permissions.includes('expenses.manage') ||
      principal.permissions.includes('employees.sensitive.view')
    );
  }

  private serializeCategory<T extends { maxAmount?: unknown }>(category: T) {
    return {
      ...category,
      maxAmount: category.maxAmount === null || category.maxAmount === undefined ? null : Number(category.maxAmount),
    };
  }

  private serializeExpense<T extends object>(expense: T) {
    const value = expense as T & { amount?: unknown; category?: { maxAmount?: unknown } | null };
    return {
      ...value,
      amount: Number(value.amount),
      category: value.category ? this.serializeCategory(value.category) : value.category,
    };
  }
}
