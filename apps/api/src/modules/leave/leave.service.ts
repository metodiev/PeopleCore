import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Paginated, Principal } from '@peoplecore/shared';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  AdjustBalanceDto,
  CreateBlackoutDto,
  CreateHolidayDto,
  CreateLeavePolicyDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  LeaveRequestQueryDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto.js';

const SORTABLE = ['createdAt', 'startDate', 'endDate', 'status'] as const;

export interface LeaveRequestedEvent {
  tenantId: string;
  leaveRequestId: string;
  employeeId: string;
  approverUserId: string | null;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  days: number;
}

export interface LeaveDecidedEvent extends LeaveRequestedEvent {
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  comment?: string;
  decidedByUserId: string;
}

/**
 * Leave management: types, policies, balances, holidays, blackout dates and
 * the request lifecycle with multi-level approvals.
 *
 * Business rules are computed here — working days exclude weekends and company
 * holidays, balances move between `pending` and `used`, and approvals follow
 * the policy chain (manager → HR, or any explicit chain configured by HR).
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Leave types ───────────────────────────────────────────────────────────

  async listLeaveTypes(includeInactive = false) {
    const types = await this.prisma.client.leaveType.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
    return types.map((type) => ({ ...type, defaultDaysPerYear: type.defaultDaysPerYear ? Number(type.defaultDaysPerYear) : null }));
  }

  async createLeaveType(principal: Principal, dto: CreateLeaveTypeDto) {
    const existing = await this.prisma.client.leaveType.findFirst({ where: { key: dto.key.toUpperCase() } });
    if (existing) throw new ConflictError(`Leave type "${dto.key}" already exists`, 'LEAVE_TYPE_EXISTS');

    const type = await this.prisma.client.leaveType.create({
      data: tenantScoped({
        key: dto.key.toUpperCase(),
        name: dto.name,
        description: dto.description,
        isPaid: dto.isPaid ?? true,
        requiresApproval: dto.requiresApproval ?? true,
        accrualType: dto.accrualType ?? 'ANNUAL_FIXED',
        defaultDaysPerYear: dto.defaultDaysPerYear,
        maxCarryOverDays: dto.maxCarryOverDays,
        allowHalfDay: dto.allowHalfDay ?? true,
        requiresAttachment: dto.requiresAttachment ?? false,
        color: dto.color,
      }),
    });
    await this.audit.record({
      action: 'leaveType.create',
      entityType: 'LeaveType',
      entityId: type.id,
      actorUserId: principal.userId,
      after: type,
    });
    return type;
  }

  async updateLeaveType(principal: Principal, id: string, dto: UpdateLeaveTypeDto) {
    const before = await this.prisma.client.leaveType.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Leave type', 'LEAVE_TYPE_NOT_FOUND');
    const updated = await this.prisma.client.leaveType.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        isPaid: dto.isPaid,
        requiresApproval: dto.requiresApproval,
        accrualType: dto.accrualType,
        defaultDaysPerYear: dto.defaultDaysPerYear,
        maxCarryOverDays: dto.maxCarryOverDays,
        allowHalfDay: dto.allowHalfDay,
        requiresAttachment: dto.requiresAttachment,
        color: dto.color,
        isActive: dto.isActive,
      },
    });
    await this.audit.record({
      action: 'leaveType.update',
      entityType: 'LeaveType',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  async listPolicies() {
    return this.prisma.client.leavePolicy.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  }

  async upsertPolicy(principal: Principal, dto: CreateLeavePolicyDto, policyId?: string) {
    const chain = dto.approvalChain.map((step) => ({ type: step.type, approverId: step.approverId ?? null }));
    const scope = {
      departmentIds: dto.departmentIds ?? [],
      locationIds: dto.locationIds ?? [],
    };

    const policy = await this.prisma.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.leavePolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }
      if (policyId) {
        return tx.leavePolicy.update({
          where: { id: policyId },
          data: {
            name: dto.name,
            description: dto.description,
            approvalChain: chain,
            scope,
            minNoticeDays: dto.minNoticeDays ?? 0,
            maxConsecutiveDays: dto.maxConsecutiveDays,
            requiresAttachmentOverDays: dto.requiresAttachmentOverDays,
            allowNegativeBalance: dto.allowNegativeBalance ?? false,
            isDefault: dto.isDefault ?? false,
          },
        });
      }
      return tx.leavePolicy.create({
        data: tenantScoped({
          name: dto.name,
          description: dto.description,
          approvalChain: chain,
          scope,
          minNoticeDays: dto.minNoticeDays ?? 0,
          maxConsecutiveDays: dto.maxConsecutiveDays,
          requiresAttachmentOverDays: dto.requiresAttachmentOverDays,
          allowNegativeBalance: dto.allowNegativeBalance ?? false,
          isDefault: dto.isDefault ?? false,
        }),
      });
    });

    await this.audit.record({
      action: policyId ? 'leavePolicy.update' : 'leavePolicy.create',
      entityType: 'LeavePolicy',
      entityId: policy.id,
      actorUserId: principal.userId,
      after: policy,
    });
    return policy;
  }

  async deletePolicy(principal: Principal, id: string) {
    const policy = await this.prisma.client.leavePolicy.findFirst({ where: { id } });
    if (!policy) throw new NotFoundError('Leave policy', 'POLICY_NOT_FOUND');
    if (policy.isDefault) throw new ConflictError('The default policy cannot be deleted', 'POLICY_DEFAULT');
    await this.prisma.client.leavePolicy.delete({ where: { id } });
    await this.audit.record({
      action: 'leavePolicy.delete',
      entityType: 'LeavePolicy',
      entityId: id,
      actorUserId: principal.userId,
      before: policy,
    });
    return { deleted: true };
  }

  // ── Holidays & blackout dates ─────────────────────────────────────────────

  async listHolidays(year?: number) {
    const targetYear = year ?? new Date().getUTCFullYear();
    const holidays = await this.prisma.client.holiday.findMany({ orderBy: { date: 'asc' } });
    return holidays
      .map((holiday) => ({ ...holiday, date: holiday.date.toISOString().slice(0, 10) }))
      .filter(
        (holiday) =>
          Number(holiday.date.slice(0, 4)) === targetYear ||
          (holiday.isRecurringYearly && holiday.date.slice(4) === `-${String(targetYear).slice(4)}`),
      );
  }

  async createHoliday(principal: Principal, dto: CreateHolidayDto) {
    const date = new Date(`${dto.date}T00:00:00.000Z`);
    const existing = await this.prisma.client.holiday.findFirst({ where: { date, name: dto.name } });
    if (existing) throw new ConflictError('Holiday already exists', 'HOLIDAY_EXISTS');

    const holiday = await this.prisma.client.holiday.create({
      data: tenantScoped({
        name: dto.name,
        date,
        isRecurringYearly: dto.isRecurringYearly ?? false,
        locationId: dto.locationId,
      }),
    });
    await this.audit.record({
      action: 'holiday.create',
      entityType: 'Holiday',
      entityId: holiday.id,
      actorUserId: principal.userId,
      after: holiday,
    });
    return holiday;
  }

  async deleteHoliday(principal: Principal, id: string) {
    const holiday = await this.prisma.client.holiday.findFirst({ where: { id } });
    if (!holiday) throw new NotFoundError('Holiday', 'HOLIDAY_NOT_FOUND');
    await this.prisma.client.holiday.delete({ where: { id } });
    await this.audit.record({
      action: 'holiday.delete',
      entityType: 'Holiday',
      entityId: id,
      actorUserId: principal.userId,
      before: holiday,
    });
    return { deleted: true };
  }

  async listBlackouts() {
    return this.prisma.client.leaveBlackoutDate.findMany({ orderBy: { startDate: 'asc' } });
  }

  async createBlackout(principal: Principal, dto: CreateBlackoutDto) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) {
      throw new ValidationError('Blackout end date must be after the start date');
    }
    const blackout = await this.prisma.client.leaveBlackoutDate.create({
      data: tenantScoped({
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        leaveTypeId: dto.leaveTypeId,
        reason: dto.reason,
      }),
    });
    await this.audit.record({
      action: 'leaveBlackout.create',
      entityType: 'LeaveBlackoutDate',
      entityId: blackout.id,
      actorUserId: principal.userId,
      after: blackout,
    });
    return blackout;
  }

  async deleteBlackout(principal: Principal, id: string) {
    const blackout = await this.prisma.client.leaveBlackoutDate.findFirst({ where: { id } });
    if (!blackout) throw new NotFoundError('Blackout period', 'BLACKOUT_NOT_FOUND');
    await this.prisma.client.leaveBlackoutDate.delete({ where: { id } });
    await this.audit.record({
      action: 'leaveBlackout.delete',
      entityType: 'LeaveBlackoutDate',
      entityId: id,
      actorUserId: principal.userId,
      before: blackout,
    });
    return { deleted: true };
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  async myBalances(principal: Principal, year?: number) {
    if (!principal.employeeId) return { year: year ?? new Date().getUTCFullYear(), balances: [] };
    return this.balancesFor(principal, principal.employeeId, year);
  }

  async balancesFor(principal: Principal, employeeId: string, year?: number) {
    await this.scope.assertEmployeeAccess(principal, employeeId);
    const targetYear = year ?? new Date().getUTCFullYear();

    let balances = await this.prisma.client.leaveBalance.findMany({
      where: { employeeId, year: targetYear },
      include: { leaveType: true },
      orderBy: { leaveType: { name: 'asc' } },
    });

    if (balances.length === 0) {
      await this.ensureBalancesForYear(employeeId, targetYear);
      balances = await this.prisma.client.leaveBalance.findMany({
        where: { employeeId, year: targetYear },
        include: { leaveType: true },
        orderBy: { leaveType: { name: 'asc' } },
      });
    }

    return {
      year: targetYear,
      balances: balances.map((balance) => {
        const entitled = Number(balance.entitled) + Number(balance.carriedOver) + Number(balance.adjustment);
        return {
          id: balance.id,
          leaveTypeId: balance.leaveTypeId,
          leaveTypeKey: balance.leaveType.key,
          leaveType: balance.leaveType.name,
          color: balance.leaveType.color,
          isPaid: balance.leaveType.isPaid,
          entitled,
          accrued: Number(balance.accrued),
          available: entitled + Number(balance.accrued),
          used: Number(balance.used),
          pending: Number(balance.pending),
          remaining: entitled + Number(balance.accrued) - Number(balance.used) - Number(balance.pending),
        };
      }),
    };
  }

  async adjustBalance(principal: Principal, dto: AdjustBalanceDto) {
    const balance = await this.prisma.transaction(async (tx) => {
      const existing = await tx.leaveBalance.findFirst({
        where: { employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year },
      });
      if (!existing) {
        const leaveType = await tx.leaveType.findFirst({ where: { id: dto.leaveTypeId } });
        if (!leaveType) throw new NotFoundError('Leave type', 'LEAVE_TYPE_NOT_FOUND');
        return tx.leaveBalance.create({
          data: tenantScoped({
            employeeId: dto.employeeId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
            entitled: dto.entitled ?? leaveType.defaultDaysPerYear ?? 0,
            carriedOver: dto.carriedOver ?? 0,
            adjustment: dto.adjustment ?? 0,
          }),
        });
      }
      return tx.leaveBalance.update({
        where: { id: existing.id },
        data: {
          adjustment: dto.adjustment !== undefined ? existing.adjustment.add(dto.adjustment) : undefined,
          entitled: dto.entitled ?? undefined,
          carriedOver: dto.carriedOver ?? undefined,
        },
      });
    });

    await this.audit.record({
      action: 'leaveBalance.adjust',
      entityType: 'LeaveBalance',
      entityId: balance.id,
      actorUserId: principal.userId,
      after: { ...balance, reason: dto.reason },
    });
    return balance;
  }

  // ── Requests ──────────────────────────────────────────────────────────────

  async createRequest(principal: Principal, dto: CreateLeaveRequestDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('Your user is not linked to an employee record');
    if (dto.employeeId && dto.employeeId !== principal.employeeId) {
      const allowed = principal.isSuperAdmin || principal.permissions.includes('leave.manage');
      if (!allowed) throw new ForbiddenError('Only HR can file leave on behalf of another employee', 'PERMISSION_DENIED');
    }

    const [employee, leaveType] = await Promise.all([
      this.prisma.client.employee.findFirst({ where: { id: employeeId } }),
      this.prisma.client.leaveType.findFirst({ where: { id: dto.leaveTypeId } }),
    ]);
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (!leaveType || !leaveType.isActive) throw new NotFoundError('Leave type', 'LEAVE_TYPE_NOT_FOUND');

    const startDate = new Date(`${dto.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${dto.endDate}T00:00:00.000Z`);
    if (endDate < startDate) throw new ValidationError('End date must be on or after the start date');
    if ((dto.startHalfDay || dto.endHalfDay) && !leaveType.allowHalfDay) {
      throw new ValidationError(`${leaveType.name} does not allow half days`);
    }

    const policy = await this.resolvePolicy(employee.departmentId, employee.locationId);
    const today = new Date();
    if (policy?.minNoticeDays) {
      const noticeDays = Math.floor((startDate.getTime() - today.getTime()) / 86_400_000);
      if (noticeDays < policy.minNoticeDays) {
        throw new ValidationError(`This leave type requires ${policy.minNoticeDays} days of notice`);
      }
    }
    if (policy?.maxConsecutiveDays) {
      const days = await this.workingDaysBetween(employeeId, startDate, endDate, dto.startHalfDay, dto.endHalfDay);
      if (days > policy.maxConsecutiveDays) {
        throw new ValidationError(`A single request cannot exceed ${policy.maxConsecutiveDays} days`);
      }
    }
    if (leaveType.requiresAttachment && !dto.documentId) {
      throw new ValidationError(`${leaveType.name} requires a supporting document`);
    }

    const blackouts = await this.prisma.client.leaveBlackoutDate.findMany({
      where: { OR: [{ leaveTypeId: null }, { leaveTypeId: leaveType.id }] },
    });
    const conflictingBlackout = blackouts.find(
      (blackout) => startDate <= blackout.endDate && endDate >= blackout.startDate,
    );
    if (conflictingBlackout) {
      throw new ValidationError(`Leave is blocked by "${conflictingBlackout.name}" for the selected period`);
    }

    const days = await this.workingDaysBetween(employeeId, startDate, endDate, dto.startHalfDay, dto.endHalfDay);
    if (days <= 0) throw new ValidationError('The selected period contains no working days');

    const year = startDate.getUTCFullYear();
    await this.ensureBalancesForYear(employeeId, year);
    const balance = await this.prisma.client.leaveBalance.findFirst({
      where: { employeeId, leaveTypeId: leaveType.id, year },
    });

    if (balance && !policy?.allowNegativeBalance && leaveType.accrualType !== 'NONE') {
      const entitled = Number(balance.entitled) + Number(balance.carriedOver) + Number(balance.adjustment) + Number(balance.accrued);
      const remaining = entitled - Number(balance.used) - Number(balance.pending);
      if (days > remaining) {
        throw new ValidationError(
          `Insufficient balance: ${remaining} day(s) left for ${leaveType.name}, ${days} requested`,
          { code: 'INSUFFICIENT_BALANCE', remaining, requested: days },
        );
      }
    }

    // Resolve the approval chain *before* opening the transaction: every
    // query inside a transaction must go through `tx` (the connection is
    // single-session), so lookups are hoisted out.
    const chain = this.buildApprovalChain(policy?.approvalChain, employee.managerId !== null);
    const resolvedChain: { type: 'MANAGER' | 'HR' | 'USER'; approverId: string | null }[] = [];
    for (const step of chain) {
      resolvedChain.push({
        type: step.type,
        approverId: await this.resolveApprover(step, employee.managerId, employee.departmentId),
      });
    }

    const request = await this.prisma.transaction(async (tx) => {
      const created = await tx.leaveRequest.create({
        data: tenantScoped({
          employeeId,
          leaveTypeId: leaveType.id,
          startDate,
          endDate,
          startHalfDay: dto.startHalfDay ?? false,
          endHalfDay: dto.endHalfDay ?? false,
          daysRequested: days,
          reason: dto.reason,
          documentId: dto.documentId,
          status: leaveType.requiresApproval ? 'PENDING' : 'APPROVED',
          submittedAt: new Date(),
          createdById: principal.userId,
          decidedAt: leaveType.requiresApproval ? null : new Date(),
        }),
      });

      if (leaveType.requiresApproval) {
        let order = 1;
        for (const step of resolvedChain) {
          await tx.leaveApproval.create({
            data: tenantScoped({
              leaveRequestId: created.id,
              stepOrder: order,
              approverType: step.type,
              approverId: step.approverId,
              status: 'PENDING',
            }),
          });
          order += 1;
        }
      }

      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: leaveType.requiresApproval
            ? { pending: balance.pending.add(days) }
            : { used: balance.used.add(days) },
        });
      }

      return created;
    });

    const firstApprover = await this.firstApproverUserId(request.id);
    this.events.emit('leave.requested', {
      tenantId: principal.tenantId!,
      leaveRequestId: request.id,
      employeeId,
      approverUserId: firstApprover,
      leaveTypeName: leaveType.name,
      startDate: dto.startDate,
      endDate: dto.endDate,
      days,
    } satisfies LeaveRequestedEvent);

    await this.audit.record({
      action: 'leave.request',
      entityType: 'LeaveRequest',
      entityId: request.id,
      actorUserId: principal.userId,
      after: { leaveType: leaveType.name, startDate: dto.startDate, endDate: dto.endDate, days },
    });

    return { id: request.id, days, status: request.status };
  }

  async listRequests(principal: Principal, query: LeaveRequestQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { startDate: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.leaveTypeId) where['leaveTypeId'] = query.leaveTypeId;
    if (query.from || query.to) {
      where['AND'] = [
        ...(query.from ? [{ endDate: { gte: new Date(query.from) } }] : []),
        ...(query.to ? [{ startDate: { lte: new Date(query.to) } }] : []),
      ];
    }

    let employeeScope: Record<string, unknown>;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      employeeScope = { id: query.employeeId };
    } else {
      employeeScope = await this.scope.employeeWhere(principal);
    }

    const filters: Record<string, unknown>[] = [{ employee: employeeScope }];
    if (Object.keys(where).length > 0) filters.push(where);

    if (query.pendingMyApproval) {
      filters.push({
        approvals: { some: { status: 'PENDING', approverId: principal.userId } },
      });
      filters.push({ status: 'PENDING' });
    }

    const finalWhere = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.leaveRequest.findMany({
        where: finalWhere,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, employeeNumber: true } },
          leaveType: { select: { id: true, name: true, color: true, isPaid: true } },
          approvals: { orderBy: { stepOrder: 'asc' } },
        },
      }),
      this.prisma.client.leaveRequest.count({ where: finalWhere }),
    ]);

    return paginate(
      rows.map((row) => ({ ...row, daysRequested: Number(row.daysRequested) })),
      total,
      query,
    );
  }

  async getRequest(principal: Principal, id: string) {
    const request = await this.prisma.client.leaveRequest.findFirst({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, workEmail: true, managerId: true } },
        leaveType: true,
        approvals: { orderBy: { stepOrder: 'asc' } },
      },
    });
    if (!request) throw new NotFoundError('Leave request', 'LEAVE_REQUEST_NOT_FOUND');
    await this.scope.assertEmployeeAccess(principal, request.employeeId);
    return { ...request, daysRequested: Number(request.daysRequested) };
  }

  async approve(principal: Principal, id: string, dto: DecideLeaveRequestDto) {
    const request = await this.loadPendingRequest(id);
    const approval = await this.currentApproval(id);
    await this.assertCanDecide(principal, request.employeeId, approval?.approverId ?? null, request.approvals.length);

    await this.prisma.transaction(async (tx) => {
      if (approval) {
        await tx.leaveApproval.update({
          where: { id: approval.id },
          data: { status: 'APPROVED', comment: dto.comment, decidedAt: new Date(), approverId: principal.userId },
        });
      }

      const remaining = await tx.leaveApproval.count({
        where: { leaveRequestId: id, status: 'PENDING', ...(approval ? { stepOrder: { gt: approval.stepOrder } } : {}) },
      });

      if (remaining === 0) {
        await tx.leaveRequest.update({
          where: { id },
          data: { status: 'APPROVED', decidedAt: new Date(), currentStep: request.approvals.length },
        });
        await this.movePendingToUsed(tx, request);
      } else {
        await tx.leaveRequest.update({ where: { id }, data: { currentStep: (approval?.stepOrder ?? 0) + 1 } });
      }
    });

    const employee = await this.prisma.client.employee.findFirst({ where: { id: request.employeeId } });
    this.events.emit('leave.approved', {
      tenantId: principal.tenantId!,
      leaveRequestId: id,
      employeeId: request.employeeId,
      approverUserId: employee?.userId ?? null,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate.toISOString().slice(0, 10),
      endDate: request.endDate.toISOString().slice(0, 10),
      days: Number(request.daysRequested),
      status: 'APPROVED',
      comment: dto.comment,
      decidedByUserId: principal.userId,
    } satisfies LeaveDecidedEvent);

    await this.audit.record({
      action: 'leave.approve',
      entityType: 'LeaveRequest',
      entityId: id,
      actorUserId: principal.userId,
      after: { step: approval?.stepOrder ?? null, comment: dto.comment },
    });

    const updated = await this.getRequest(principal, id);
    return { id, status: updated.status };
  }

  async reject(principal: Principal, id: string, dto: DecideLeaveRequestDto) {
    const request = await this.loadPendingRequest(id);
    const approval = await this.currentApproval(id);
    await this.assertCanDecide(principal, request.employeeId, approval?.approverId ?? null, request.approvals.length);

    await this.prisma.transaction(async (tx) => {
      if (approval) {
        await tx.leaveApproval.update({
          where: { id: approval.id },
          data: { status: 'REJECTED', comment: dto.comment, decidedAt: new Date(), approverId: principal.userId },
        });
      }
      await tx.leaveApproval.updateMany({
        where: { leaveRequestId: id, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await tx.leaveRequest.update({
        where: { id },
        data: { status: 'REJECTED', decidedAt: new Date() },
      });
      await this.refundPending(tx, request);
    });

    const employee = await this.prisma.client.employee.findFirst({ where: { id: request.employeeId } });
    this.events.emit('leave.rejected', {
      tenantId: principal.tenantId!,
      leaveRequestId: id,
      employeeId: request.employeeId,
      approverUserId: employee?.userId ?? null,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate.toISOString().slice(0, 10),
      endDate: request.endDate.toISOString().slice(0, 10),
      days: Number(request.daysRequested),
      status: 'REJECTED',
      comment: dto.comment,
      decidedByUserId: principal.userId,
    } satisfies LeaveDecidedEvent);

    await this.audit.record({
      action: 'leave.reject',
      entityType: 'LeaveRequest',
      entityId: id,
      actorUserId: principal.userId,
      after: { comment: dto.comment },
    });
    return { id, status: 'REJECTED' };
  }

  async cancel(principal: Principal, id: string, reason?: string) {
    const request = await this.prisma.client.leaveRequest.findFirst({
      where: { id },
      include: { leaveType: true, approvals: true },
    });
    if (!request) throw new NotFoundError('Leave request', 'LEAVE_REQUEST_NOT_FOUND');
    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new ConflictError('This request can no longer be cancelled', 'REQUEST_NOT_CANCELLABLE');
    }
    const isOwner = request.employeeId === principal.employeeId;
    const canManage = principal.isSuperAdmin || principal.permissions.includes('leave.manage');
    if (!isOwner && !canManage) {
      throw new ForbiddenError('Only the requester or HR can cancel a leave request', 'PERMISSION_DENIED');
    }

    await this.prisma.transaction(async (tx) => {
      await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), reason: reason ?? request.reason },
      });
      await tx.leaveApproval.updateMany({ where: { leaveRequestId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
      if (request.status === 'PENDING') await this.refundPending(tx, request);
      if (request.status === 'APPROVED') await this.refundUsed(tx, request);
    });

    this.events.emit('leave.cancelled', {
      tenantId: principal.tenantId!,
      leaveRequestId: id,
      employeeId: request.employeeId,
      approverUserId: null,
      leaveTypeName: request.leaveType.name,
      startDate: request.startDate.toISOString().slice(0, 10),
      endDate: request.endDate.toISOString().slice(0, 10),
      days: Number(request.daysRequested),
      status: 'CANCELLED',
      decidedByUserId: principal.userId,
    } satisfies LeaveDecidedEvent);

    await this.audit.record({
      action: 'leave.cancel',
      entityType: 'LeaveRequest',
      entityId: id,
      actorUserId: principal.userId,
      after: { reason },
    });
    return { id, status: 'CANCELLED' };
  }

  /** Who is on leave between two dates — powers the team calendar view. */
  async teamCalendar(principal: Principal, from?: string, to?: string) {
    const start = from ? new Date(from) : new Date();
    const end = to ? new Date(to) : new Date(Date.now() + 60 * 86_400_000);
    const employeeScope = await this.scope.employeeWhere(principal);

    const requests = await this.prisma.client.leaveRequest.findMany({
      where: {
        AND: [
          { employee: employeeScope },
          { status: 'APPROVED' },
          { startDate: { lte: end } },
          { endDate: { gte: start } },
        ],
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, departmentId: true } },
        leaveType: { select: { name: true, color: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    return requests.map((request) => ({
      id: request.id,
      employee: request.employee,
      leaveType: request.leaveType,
      startDate: request.startDate.toISOString().slice(0, 10),
      endDate: request.endDate.toISOString().slice(0, 10),
      days: Number(request.daysRequested),
      status: request.status,
    }));
  }

  /** Runs monthly accrual for a tenant (invoked by the scheduler). */
  async accrueMonthly(tenantId: string, date = new Date()): Promise<number> {
    return this.prisma.forTenant(tenantId, async (db) => {
      const year = date.getUTCFullYear();
      const accruingTypes = await db.leaveType.findMany({ where: { isActive: true, accrualType: 'MONTHLY_ACCRUAL' } });
      let updated = 0;

      for (const leaveType of accruingTypes) {
        const perMonth = Number(leaveType.defaultDaysPerYear ?? 0) / 12;
        if (perMonth <= 0) continue;
        const employees = await db.employee.findMany({ where: { status: { not: 'TERMINATED' } }, select: { id: true } });
        for (const employee of employees) {
          const balance = await db.leaveBalance.findFirst({
            where: { employeeId: employee.id, leaveTypeId: leaveType.id, year },
          });
          if (!balance) continue;
          const maxAccrual = Number(leaveType.defaultDaysPerYear ?? 0);
          const nextAccrued = Math.min(maxAccrual, Number(balance.accrued) + perMonth);
          await db.leaveBalance.update({ where: { id: balance.id }, data: { accrued: nextAccrued } });
          updated += 1;
        }
      }
      return updated;
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async ensureBalancesForYear(employeeId: string, year: number): Promise<void> {
    const leaveTypes = await this.prisma.client.leaveType.findMany({ where: { isActive: true } });
    if (leaveTypes.length === 0) return;
    const existing = await this.prisma.client.leaveBalance.findMany({ where: { employeeId, year } });
    const existingTypeIds = new Set(existing.map((balance) => balance.leaveTypeId));
    const missing = leaveTypes.filter((leaveType) => !existingTypeIds.has(leaveType.id));
    if (missing.length === 0) return;

    await this.prisma.client.leaveBalance.createMany({
      data: missing.map((leaveType) => ({
        tenantId: this.prisma.currentTenantIdOrThrow(),
        employeeId,
        leaveTypeId: leaveType.id,
        year,
        entitled: Number(leaveType.defaultDaysPerYear ?? 0),
      })),
      skipDuplicates: true,
    });
  }

  private async resolvePolicy(departmentId: string | null, locationId: string | null) {
    const policies = await this.prisma.client.leavePolicy.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }],
    });
    const scoped = policies.find((policy) => {
      const scope = (policy.scope ?? {}) as { departmentIds?: string[]; locationIds?: string[] };
      const departments = scope.departmentIds ?? [];
      const locations = scope.locationIds ?? [];
      if (departments.length > 0 && departmentId && !departments.includes(departmentId)) return false;
      if (locations.length > 0 && locationId && !locations.includes(locationId)) return false;
      return departments.length > 0 || locations.length > 0;
    });
    return scoped ?? policies.find((policy) => policy.isDefault) ?? policies[0] ?? null;
  }

  private buildApprovalChain(chain: unknown, hasManager: boolean): { type: 'MANAGER' | 'HR' | 'USER'; approverId?: string }[] {
    const steps = Array.isArray(chain) && chain.length > 0
      ? (chain as { type: 'MANAGER' | 'HR' | 'USER'; approverId?: string | null }[])
      : [{ type: 'MANAGER' as const, approverId: null }];
    const result = steps.map((step) => ({ type: step.type, approverId: step.approverId ?? undefined }));
    const withoutManager = result.filter((step) => step.type !== 'MANAGER');
    return hasManager ? result : withoutManager.length > 0 ? withoutManager : [{ type: 'HR' }];
  }

  private async resolveApprover(
    step: { type: 'MANAGER' | 'HR' | 'USER'; approverId?: string },
    managerId: string | null,
    _departmentId: string | null,
  ): Promise<string | null> {
    if (step.type === 'USER') return step.approverId ?? null;
    if (step.type === 'MANAGER' && managerId) {
      const manager = await this.prisma.client.employee.findFirst({ where: { id: managerId }, select: { userId: true } });
      return manager?.userId ?? null;
    }
    if (step.type === 'HR' || (step.type === 'MANAGER' && !managerId)) {
      const hrUser = await this.prisma.raw.user.findFirst({
        where: {
          tenantId: this.prisma.currentTenantIdOrThrow(),
          status: 'ACTIVE',
          roles: { some: { role: { key: { in: ['HR_ADMIN', 'HR_MANAGER', 'COMPANY_ADMIN'] } } } },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return hrUser?.id ?? null;
    }
    return null;
  }

  private async firstApproverUserId(requestId: string): Promise<string | null> {
    const approval = await this.prisma.client.leaveApproval.findFirst({
      where: { leaveRequestId: requestId, status: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });
    return approval?.approverId ?? null;
  }

  private async loadPendingRequest(id: string) {
    const request = await this.prisma.client.leaveRequest.findFirst({
      where: { id },
      include: { leaveType: true, approvals: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!request) throw new NotFoundError('Leave request', 'LEAVE_REQUEST_NOT_FOUND');
    if (request.status !== 'PENDING') {
      throw new ConflictError(`This request is already ${request.status.toLowerCase()}`, 'REQUEST_ALREADY_DECIDED');
    }
    return request;
  }

  private async currentApproval(requestId: string) {
    return this.prisma.client.leaveApproval.findFirst({
      where: { leaveRequestId: requestId, status: 'PENDING' },
      orderBy: { stepOrder: 'asc' },
    });
  }

  private async assertCanDecide(
    principal: Principal,
    employeeId: string,
    approverUserId: string | null,
    _totalSteps: number,
  ): Promise<void> {
    const isAdmin = principal.isSuperAdmin;
    const isAssignedApprover = approverUserId !== null && approverUserId === principal.userId;
    const isHr = principal.permissions.includes('leave.manage');
    const isDirectManager =
      principal.employeeId !== null && (await this.isManagerOf(principal.employeeId, employeeId));

    if (!isAdmin && !isAssignedApprover && !isHr && !isDirectManager) {
      throw new ForbiddenError('You are not the approver for this request', 'NOT_APPROVER');
    }
  }

  private async isManagerOf(managerEmployeeId: string, employeeId: string): Promise<boolean> {
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: employeeId },
      select: { managerId: true, team: { select: { leadId: true } }, department: { select: { managerId: true } } },
    });
    if (!employee) return false;
    return (
      employee.managerId === managerEmployeeId ||
      employee.team?.leadId === managerEmployeeId ||
      employee.department?.managerId === managerEmployeeId
    );
  }

  private async movePendingToUsed(tx: PrismaTransaction, request: {
    employeeId: string;
    leaveTypeId: string;
    startDate: Date;
    daysRequested: unknown;
  }): Promise<void> {
    const days = Number(request.daysRequested);
    const year = request.startDate.getUTCFullYear();
    await tx.leaveBalance.updateMany({
      where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
      data: { pending: { decrement: days }, used: { increment: days } },
    });
  }

  private async refundPending(tx: PrismaTransaction, request: {
    employeeId: string;
    leaveTypeId: string;
    startDate: Date;
    daysRequested: unknown;
  }): Promise<void> {
    const days = Number(request.daysRequested);
    const year = request.startDate.getUTCFullYear();
    await tx.leaveBalance.updateMany({
      where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
      data: { pending: { decrement: days } },
    });
  }

  private async refundUsed(tx: PrismaTransaction, request: {
    employeeId: string;
    leaveTypeId: string;
    startDate: Date;
    daysRequested: unknown;
  }): Promise<void> {
    const days = Number(request.daysRequested);
    const year = request.startDate.getUTCFullYear();
    await tx.leaveBalance.updateMany({
      where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
      data: { used: { decrement: days } },
    });
  }

  /**
   * Working days between two dates, excluding non-working weekdays (from the
   * employee's schedule when set, else Mon–Fri) and company holidays.
   */
  async workingDaysBetween(
    employeeId: string,
    start: Date,
    end: Date,
    startHalfDay = false,
    endHalfDay = false,
  ): Promise<number> {
    const [employee, holidays] = await Promise.all([
      this.prisma.client.employee.findFirst({ where: { id: employeeId }, include: { schedule: true } }),
      this.prisma.client.holiday.findMany({
        where: { date: { lte: end } },
      }),
    ]);

    const workDays = new Set(employee?.schedule?.workDays ?? [1, 2, 3, 4, 5]);
    const holidayKeys = new Set(
      holidays
        .filter((holiday) => holiday.isRecurringYearly || (holiday.date >= start && holiday.date <= end))
        .map((holiday) => {
          const month = holiday.date.getUTCMonth();
          const day = holiday.date.getUTCDate();
          return holiday.isRecurringYearly
            ? `${month + 1}-${day}`
            : holiday.date.toISOString().slice(0, 10);
        }),
    );

    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      const isoWeekday = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
      if (workDays.has(isoWeekday) && !holidayKeys.has(key)) days += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (startHalfDay) days -= 0.5;
    if (endHalfDay) days -= 0.5;
    return Math.max(0, days);
  }
}
