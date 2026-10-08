import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { GoalStatus, Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  CreateFeedbackDto,
  CreateGoalDto,
  CreateKeyResultDto,
  CreateReviewCycleDto,
  CreateReviewDto,
  FeedbackQueryDto,
  FeedbackVisibilityValue,
  GoalQueryDto,
  ReviewCycleQueryDto,
  ReviewQueryDto,
  SubmitReviewDto,
  UpdateGoalDto,
  UpdateGoalProgressDto,
  UpdateKeyResultDto,
  UpdateReviewCycleDto,
} from './dto/performance.dto.js';

const SORTABLE_CYCLES = ['createdAt', 'name', 'startDate', 'endDate', 'status'] as const;
const SORTABLE_REVIEWS = ['createdAt', 'updatedAt', 'submittedAt', 'status'] as const;
const SORTABLE_GOALS = ['createdAt', 'dueDate', 'progress', 'status', 'priority', 'title'] as const;
const SORTABLE_FEEDBACK = ['createdAt'] as const;

/** Never matches, used when a filter targets an employee the caller does not have. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

const CLOSED_GOAL_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

export interface PerformanceReviewAssignedEvent {
  tenantId: string;
  reviewId: string;
  cycleId: string;
  cycleName: string;
  employeeId: string;
  reviewerId: string | null;
  reviewerUserId: string | null;
  type: string;
}

/**
 * Performance management: review cycles, reviews (self / manager / peer),
 * goals & OKRs with key results, and continuous feedback.
 *
 * Visibility follows the permission model: employees reach their own records
 * (`performance.self.view`), managers their team, HR everyone. Feedback has an
 * additional per-record visibility ladder (HR_ONLY → MANAGER → EMPLOYEE → PUBLIC).
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Review cycles ─────────────────────────────────────────────────────────

  async listCycles(query: ReviewCycleQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_CYCLES, { startDate: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.client.reviewCycle.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { _count: { select: { reviews: true, goals: true } } },
      }),
      this.prisma.client.reviewCycle.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async getCycle(id: string) {
    const cycle = await this.prisma.client.reviewCycle.findFirst({
      where: { id },
      include: {
        _count: { select: { reviews: true, goals: true } },
        reviews: { select: { status: true } },
      },
    });
    if (!cycle) throw new NotFoundError('Review cycle', 'REVIEW_CYCLE_NOT_FOUND');

    const byStatus: Record<string, number> = {};
    for (const review of cycle.reviews) byStatus[review.status] = (byStatus[review.status] ?? 0) + 1;
    const { reviews: _reviews, ...cycleFields } = cycle;
    return { ...cycleFields, reviewsByStatus: byStatus };
  }

  async createCycle(principal: Principal, dto: CreateReviewCycleDto) {
    this.assertDateRange(dto.startDate, dto.endDate, 'Review cycle');
    const existing = await this.prisma.client.reviewCycle.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictError(`Review cycle "${dto.name}" already exists`, 'REVIEW_CYCLE_EXISTS');

    const cycle = await this.prisma.client.reviewCycle.create({
      data: tenantScoped({
        name: dto.name,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        includesSelfReview: dto.includesSelfReview ?? true,
        includesPeerReview: dto.includesPeerReview ?? false,
        status: dto.status ?? 'DRAFT',
      }),
    });
    await this.audit.record({
      action: 'reviewCycle.create',
      entityType: 'ReviewCycle',
      entityId: cycle.id,
      actorUserId: principal.userId,
      after: cycle,
    });
    return cycle;
  }

  async updateCycle(principal: Principal, id: string, dto: UpdateReviewCycleDto) {
    const before = await this.prisma.client.reviewCycle.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Review cycle', 'REVIEW_CYCLE_NOT_FOUND');
    if (before.status === 'CLOSED') throw new ConflictError('A closed review cycle can no longer be edited', 'REVIEW_CYCLE_CLOSED');
    if (dto.name && dto.name !== before.name) {
      const duplicate = await this.prisma.client.reviewCycle.findFirst({ where: { name: dto.name } });
      if (duplicate) throw new ConflictError(`Review cycle "${dto.name}" already exists`, 'REVIEW_CYCLE_EXISTS');
    }
    if (dto.startDate || dto.endDate) {
      this.assertDateRange(
        dto.startDate ?? before.startDate.toISOString().slice(0, 10),
        dto.endDate ?? before.endDate.toISOString().slice(0, 10),
        'Review cycle',
      );
    }

    const updated = await this.prisma.client.reviewCycle.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        includesSelfReview: dto.includesSelfReview,
        includesPeerReview: dto.includesPeerReview,
        status: dto.status,
      },
    });
    await this.audit.record({
      action: 'reviewCycle.update',
      entityType: 'ReviewCycle',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  async activateCycle(principal: Principal, id: string) {
    const cycle = await this.prisma.client.reviewCycle.findFirst({ where: { id } });
    if (!cycle) throw new NotFoundError('Review cycle', 'REVIEW_CYCLE_NOT_FOUND');
    if (cycle.status === 'ACTIVE') return cycle;
    if (cycle.status === 'CLOSED') throw new ConflictError('A closed cycle cannot be re-activated', 'REVIEW_CYCLE_CLOSED');

    const updated = await this.prisma.client.reviewCycle.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.record({
      action: 'reviewCycle.activate',
      entityType: 'ReviewCycle',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: cycle.status },
      after: { status: updated.status },
    });
    return updated;
  }

  async closeCycle(principal: Principal, id: string) {
    const cycle = await this.prisma.client.reviewCycle.findFirst({ where: { id } });
    if (!cycle) throw new NotFoundError('Review cycle', 'REVIEW_CYCLE_NOT_FOUND');
    if (cycle.status === 'CLOSED') return cycle;

    const updated = await this.prisma.client.reviewCycle.update({ where: { id }, data: { status: 'CLOSED' } });
    await this.audit.record({
      action: 'reviewCycle.close',
      entityType: 'ReviewCycle',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: cycle.status },
      after: { status: updated.status },
    });
    return updated;
  }

  // ── Reviews ───────────────────────────────────────────────────────────────

  async createReview(principal: Principal, dto: CreateReviewDto) {
    const type = dto.type ?? 'MANAGER';
    const cycle = await this.prisma.client.reviewCycle.findFirst({ where: { id: dto.cycleId } });
    if (!cycle) throw new NotFoundError('Review cycle', 'REVIEW_CYCLE_NOT_FOUND');
    if (cycle.status === 'CLOSED') throw new ConflictError('Reviews cannot be created in a closed cycle', 'REVIEW_CYCLE_CLOSED');
    if (type === 'SELF' && !cycle.includesSelfReview) {
      throw new ValidationError('This review cycle does not include self reviews', { code: 'SELF_REVIEW_DISABLED' });
    }
    if (type === 'PEER' && !cycle.includesPeerReview) {
      throw new ValidationError('This review cycle does not include peer reviews', { code: 'PEER_REVIEW_DISABLED' });
    }

    await this.scope.assertEmployeeAccess(principal, dto.employeeId);
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: dto.employeeId },
      select: { id: true, userId: true, managerId: true, firstName: true, lastName: true },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const reviewerId = dto.reviewerId ?? (type === 'SELF' ? employee.id : employee.managerId) ?? null;
    if (!reviewerId) {
      throw new ValidationError('A reviewer is required — the employee has no manager on record', {
        code: 'REVIEWER_REQUIRED',
      });
    }
    const reviewer = await this.prisma.client.employee.findFirst({
      where: { id: reviewerId },
      select: { id: true, userId: true },
    });
    if (!reviewer) throw new NotFoundError('Reviewer', 'REVIEWER_NOT_FOUND');

    const duplicate = await this.prisma.client.performanceReview.findFirst({
      where: { cycleId: dto.cycleId, employeeId: dto.employeeId, type, reviewerId },
    });
    if (duplicate) throw new ConflictError('This review already exists for the cycle', 'REVIEW_EXISTS');

    const review = await this.prisma.client.performanceReview.create({
      data: tenantScoped({
        cycleId: dto.cycleId,
        employeeId: dto.employeeId,
        reviewerId,
        reviewerUserId: reviewer.userId,
        type,
        status: 'PENDING',
      }),
      include: { cycle: { select: { id: true, name: true } } },
    });

    this.events.emit('performance.review.assigned', {
      tenantId: principal.tenantId!,
      reviewId: review.id,
      cycleId: cycle.id,
      cycleName: cycle.name,
      employeeId: dto.employeeId,
      reviewerId,
      reviewerUserId: reviewer.userId,
      type,
    } satisfies PerformanceReviewAssignedEvent);

    await this.audit.record({
      action: 'performanceReview.create',
      entityType: 'PerformanceReview',
      entityId: review.id,
      actorUserId: principal.userId,
      after: { cycleId: dto.cycleId, employeeId: dto.employeeId, reviewerId, type },
    });
    return review;
  }

  async listReviews(principal: Principal, query: ReviewQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_REVIEWS, { createdAt: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.cycleId) filters.push({ cycleId: query.cycleId });
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (query.mineAsReviewer) filters.push(this.reviewerFilter(principal));
    if (query.mineAsSubject) filters.push({ employeeId: principal.employeeId ?? NO_MATCH_ID });

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else if (this.canReachOthers(principal)) {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    } else {
      filters.push({
        OR: [{ employeeId: principal.employeeId ?? NO_MATCH_ID }, this.reviewerFilter(principal)],
      });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.performanceReview.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          cycle: { select: { id: true, name: true, status: true, includesSelfReview: true, includesPeerReview: true } },
          employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, employeeNumber: true } },
          reviewer: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.performanceReview.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeReview(row)), total, query);
  }

  async getReview(principal: Principal, id: string) {
    const review = await this.prisma.client.performanceReview.findFirst({
      where: { id },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        feedback: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!review) throw new NotFoundError('Performance review', 'REVIEW_NOT_FOUND');
    await this.assertReviewAccess(principal, review);
    return this.serializeReview(review);
  }

  async submitReview(principal: Principal, id: string, dto: SubmitReviewDto) {
    const review = await this.prisma.client.performanceReview.findFirst({ where: { id } });
    if (!review) throw new NotFoundError('Performance review', 'REVIEW_NOT_FOUND');
    if (review.status === 'ACKNOWLEDGED') {
      throw new ConflictError('An acknowledged review can no longer be edited', 'REVIEW_ACKNOWLEDGED');
    }
    this.assertCanSubmit(principal, review);
    if (dto.overallRating === undefined && !dto.summary && !dto.strengths && !dto.improvements && dto.submit !== false) {
      throw new ValidationError('Provide at least a rating or a written section before submitting');
    }

    const submit = dto.submit !== false;
    const updated = await this.prisma.client.performanceReview.update({
      where: { id },
      data: {
        overallRating: dto.overallRating,
        summary: dto.summary,
        strengths: dto.strengths,
        improvements: dto.improvements,
        status: submit ? 'SUBMITTED' : 'IN_PROGRESS',
        submittedAt: submit ? new Date() : null,
      },
    });
    await this.audit.record({
      action: submit ? 'performanceReview.submit' : 'performanceReview.draft',
      entityType: 'PerformanceReview',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: review.status },
      after: { status: updated.status, overallRating: updated.overallRating ? Number(updated.overallRating) : null },
    });
    return this.serializeReview(updated);
  }

  async acknowledgeReview(principal: Principal, id: string) {
    const review = await this.prisma.client.performanceReview.findFirst({ where: { id } });
    if (!review) throw new NotFoundError('Performance review', 'REVIEW_NOT_FOUND');
    if (review.status !== 'SUBMITTED') {
      throw new ConflictError('Only a submitted review can be acknowledged', 'REVIEW_NOT_SUBMITTED');
    }
    const isSubject = review.employeeId === principal.employeeId;
    if (!isSubject && !this.isHr(principal)) {
      throw new ForbiddenError('Only the reviewed employee can acknowledge this review', 'REVIEW_ACK_DENIED');
    }

    const updated = await this.prisma.client.performanceReview.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    await this.audit.record({
      action: 'performanceReview.acknowledge',
      entityType: 'PerformanceReview',
      entityId: id,
      actorUserId: principal.userId,
      after: { status: updated.status },
    });
    return this.serializeReview(updated);
  }

  // ── Goals / OKRs / KPIs ───────────────────────────────────────────────────

  async listGoals(principal: Principal, query: GoalQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_GOALS, { createdAt: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (query.reviewCycleId) filters.push({ reviewCycleId: query.reviewCycleId });
    if (query.parentId) filters.push({ parentId: query.parentId });
    if (query.overdue) {
      filters.push({ dueDate: { lt: new Date() }, status: { notIn: [...CLOSED_GOAL_STATUSES] } });
    }

    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else if (this.canReachOthers(principal)) {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    } else {
      filters.push({ employeeId: principal.employeeId ?? NO_MATCH_ID });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.goal.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          keyResults: true,
          _count: { select: { children: true } },
        },
      }),
      this.prisma.client.goal.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeGoal(row)), total, query);
  }

  async getGoal(principal: Principal, id: string) {
    const goal = await this.prisma.client.goal.findFirst({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        keyResults: { orderBy: { createdAt: 'asc' } },
        children: { select: { id: true, title: true, progress: true, status: true } },
      },
    });
    if (!goal) throw new NotFoundError('Goal', 'GOAL_NOT_FOUND');
    await this.assertGoalAccess(principal, goal.employeeId);
    return this.serializeGoal(goal);
  }

  async createGoal(principal: Principal, dto: CreateGoalDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('employeeId is required — the caller has no employee record');
    await this.assertGoalAccess(principal, employeeId);
    if (dto.parentId === employeeId) throw new ValidationError('A goal cannot be its own parent');

    const goal = await this.prisma.client.goal.create({
      data: tenantScoped({
        employeeId,
        ownerUserId: principal.userId,
        title: dto.title,
        description: dto.description,
        type: dto.type ?? 'GOAL',
        status: dto.status ?? 'DRAFT',
        priority: dto.priority ?? 'MEDIUM',
        parentId: dto.parentId,
        alignedToId: dto.alignedToId,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        progress: dto.progress ?? 0,
        weight: dto.weight,
        reviewCycleId: dto.reviewCycleId,
        keyResults: dto.keyResults
          ? {
              create: dto.keyResults.map((keyResult) => tenantScoped(this.keyResultData(keyResult))),
            }
          : undefined,
      }),
      include: { keyResults: true },
    });
    await this.audit.record({
      action: 'goal.create',
      entityType: 'Goal',
      entityId: goal.id,
      actorUserId: principal.userId,
      after: { title: goal.title, type: goal.type, employeeId },
    });
    return this.serializeGoal(goal);
  }

  async updateGoal(principal: Principal, id: string, dto: UpdateGoalDto) {
    const before = await this.loadGoal(id);
    await this.assertGoalAccess(principal, before.employeeId);
    if (dto.employeeId && dto.employeeId !== before.employeeId) {
      await this.assertGoalAccess(principal, dto.employeeId);
    }

    const updated = await this.prisma.client.goal.update({
      where: { id },
      data: {
        employeeId: dto.employeeId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        status: dto.status,
        priority: dto.priority,
        parentId: dto.parentId,
        alignedToId: dto.alignedToId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        progress: dto.progress,
        weight: dto.weight,
        reviewCycleId: dto.reviewCycleId,
        completedAt: dto.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
    await this.audit.record({
      action: 'goal.update',
      entityType: 'Goal',
      entityId: id,
      actorUserId: principal.userId,
      before: { title: before.title, status: before.status, progress: before.progress },
      after: { title: updated.title, status: updated.status, progress: updated.progress },
    });
    return this.serializeGoal(updated);
  }

  async deleteGoal(principal: Principal, id: string) {
    const goal = await this.loadGoal(id);
    await this.assertGoalAccess(principal, goal.employeeId);

    await this.prisma.client.goal.delete({ where: { id } });
    await this.audit.record({
      action: 'goal.delete',
      entityType: 'Goal',
      entityId: id,
      actorUserId: principal.userId,
      before: { title: goal.title, status: goal.status },
    });
    return { deleted: true };
  }

  async addKeyResult(principal: Principal, goalId: string, dto: CreateKeyResultDto) {
    const goal = await this.loadGoal(goalId);
    await this.assertGoalAccess(principal, goal.employeeId);

    const keyResult = await this.prisma.client.keyResult.create({
      data: tenantScoped({ goalId, ...this.keyResultData(dto) }),
    });
    await this.recomputeGoalProgress(goalId);
    await this.audit.record({
      action: 'goal.keyResult.create',
      entityType: 'KeyResult',
      entityId: keyResult.id,
      actorUserId: principal.userId,
      after: { goalId, title: keyResult.title, targetValue: Number(keyResult.targetValue) },
    });
    return this.serializeKeyResult(keyResult);
  }

  async updateKeyResult(principal: Principal, id: string, dto: UpdateKeyResultDto) {
    const before = await this.prisma.client.keyResult.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Key result', 'KEY_RESULT_NOT_FOUND');
    const goal = await this.loadGoal(before.goalId);
    await this.assertGoalAccess(principal, goal.employeeId);

    const currentValue = dto.currentValue ?? Number(before.currentValue);
    const targetValue = dto.targetValue ?? Number(before.targetValue);
    const updated = await this.prisma.client.keyResult.update({
      where: { id },
      data: {
        title: dto.title,
        targetValue: dto.targetValue,
        currentValue: dto.currentValue,
        unit: dto.unit,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        progress: keyResultProgress(currentValue, targetValue),
      },
    });

    const goalProgress = await this.recomputeGoalProgress(before.goalId);
    await this.audit.record({
      action: 'goal.keyResult.update',
      entityType: 'KeyResult',
      entityId: id,
      actorUserId: principal.userId,
      before: { currentValue: Number(before.currentValue), progress: before.progress },
      after: { currentValue: Number(updated.currentValue), progress: updated.progress, goalProgress },
    });
    return { ...this.serializeKeyResult(updated), goalProgress };
  }

  /** Updates the explicit goal progress (and status), or rolls it up from key results. */
  async updateGoalProgress(principal: Principal, id: string, dto: UpdateGoalProgressDto) {
    const goal = await this.loadGoal(id);
    await this.assertGoalAccess(principal, goal.employeeId);

    const keyResults = await this.prisma.client.keyResult.findMany({ where: { goalId: id } });
    const progress = dto.recomputeFromKeyResults
      ? weightedProgress(keyResults)
      : (dto.progress ?? (keyResults.length > 0 ? weightedProgress(keyResults) : goal.progress));

    const status = dto.status ?? statusForProgress(progress, goal.status);
    const updated = await this.prisma.client.goal.update({
      where: { id },
      data: {
        progress,
        status,
        completedAt: status === 'COMPLETED' ? (goal.completedAt ?? new Date()) : null,
      },
    });
    await this.audit.record({
      action: 'goal.progress',
      entityType: 'Goal',
      entityId: id,
      actorUserId: principal.userId,
      before: { progress: goal.progress, status: goal.status },
      after: { progress: updated.progress, status: updated.status },
    });
    return this.serializeGoal(updated);
  }

  // ── Feedback ──────────────────────────────────────────────────────────────

  async createFeedback(principal: Principal, dto: CreateFeedbackDto) {
    const subject = await this.prisma.client.employee.findFirst({
      where: { id: dto.subjectEmployeeId },
      select: { id: true },
    });
    if (!subject) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (dto.subjectEmployeeId !== principal.employeeId) {
      await this.scope.assertEmployeeAccess(principal, dto.subjectEmployeeId);
    }
    if (dto.reviewId) {
      const review = await this.prisma.client.performanceReview.findFirst({
        where: { id: dto.reviewId, employeeId: dto.subjectEmployeeId },
      });
      if (!review) throw new NotFoundError('Performance review', 'REVIEW_NOT_FOUND');
    }

    const feedback = await this.prisma.client.reviewFeedback.create({
      data: tenantScoped({
        reviewId: dto.reviewId,
        subjectEmployeeId: dto.subjectEmployeeId,
        authorEmployeeId: principal.employeeId,
        authorUserId: principal.userId,
        type: dto.type ?? 'COMMENT',
        message: dto.message,
        isAnonymous: dto.isAnonymous ?? false,
        visibility: dto.visibility ?? 'MANAGER',
      }),
    });
    await this.audit.record({
      action: 'reviewFeedback.create',
      entityType: 'ReviewFeedback',
      entityId: feedback.id,
      actorUserId: principal.userId,
      after: {
        subjectEmployeeId: dto.subjectEmployeeId,
        visibility: feedback.visibility,
        type: feedback.type,
        isAnonymous: feedback.isAnonymous,
      },
    });
    return this.serializeFeedback(feedback);
  }

  /** Feedback visible to the caller, honouring the visibility ladder and anonymity. */
  async listFeedback(principal: Principal, query: FeedbackQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE_FEEDBACK, { createdAt: 'desc' });
    const employeeId = query.employeeId ?? principal.employeeId ?? NO_MATCH_ID;
    if (employeeId !== principal.employeeId) {
      await this.scope.assertEmployeeAccess(principal, employeeId);
    }

    const filters: Record<string, unknown>[] = [{ subjectEmployeeId: employeeId }];
    if (query.type) filters.push({ type: query.type });
    if (query.visibility) filters.push({ visibility: query.visibility });
    filters.push(this.feedbackVisibilityFilter(principal, employeeId));

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.reviewFeedback.findMany({ where, skip, take, orderBy }),
      this.prisma.client.reviewFeedback.count({ where }),
    ]);
    return paginate(
      rows.map((row) => this.hideAnonymousAuthor(this.serializeFeedback(row), principal)),
      total,
      query,
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async dashboard(principal: Principal) {
    const now = new Date();
    const reviewScope = this.canReachOthers(principal)
      ? { employee: await this.scope.employeeWhere(principal) }
      : { OR: [{ employeeId: principal.employeeId ?? NO_MATCH_ID }, this.reviewerFilter(principal)] };
    const goalScope = this.canReachOthers(principal)
      ? { employee: await this.scope.employeeWhere(principal) }
      : { employeeId: principal.employeeId ?? NO_MATCH_ID };

    const [cycles, pendingReviews, awaitingMe, rating, goals, overdueGoals, dueSoonGoals] = await Promise.all([
      this.prisma.client.reviewCycle.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { endDate: 'asc' },
        select: { id: true, name: true, startDate: true, endDate: true, _count: { select: { reviews: true } } },
      }),
      this.prisma.client.performanceReview.count({
        where: { AND: [reviewScope, { status: { in: ['PENDING', 'IN_PROGRESS'] } }] },
      }),
      this.prisma.client.performanceReview.count({
        where: { AND: [this.reviewerFilter(principal), { status: { in: ['PENDING', 'IN_PROGRESS'] } }] },
      }),
      this.prisma.client.performanceReview.aggregate({
        where: { AND: [reviewScope, { status: { in: ['SUBMITTED', 'ACKNOWLEDGED'] } }] },
        _avg: { overallRating: true },
        _count: { _all: true },
      }),
      this.prisma.client.goal.groupBy({
        by: ['status'],
        where: goalScope,
        _count: { _all: true },
      }),
      this.prisma.client.goal.count({
        where: { AND: [goalScope, { dueDate: { lt: now }, status: { notIn: [...CLOSED_GOAL_STATUSES] } }] },
      }),
      this.prisma.client.goal.count({
        where: {
          AND: [
            goalScope,
            { dueDate: { gte: now, lte: new Date(now.getTime() + 30 * 86_400_000) }, status: { notIn: [...CLOSED_GOAL_STATUSES] } },
          ],
        },
      }),
    ]);

    const goalsByStatus: Record<string, number> = {};
    let goalsTotal = 0;
    for (const group of goals) {
      goalsByStatus[group.status] = group._count._all;
      goalsTotal += group._count._all;
    }

    return {
      activeCycles: cycles.map((cycle) => ({
        id: cycle.id,
        name: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        reviewCount: cycle._count.reviews,
      })),
      pendingReviews,
      reviewsAwaitingMyAction: awaitingMe,
      averageRating: rating._avg.overallRating === null ? null : Number(Number(rating._avg.overallRating).toFixed(2)),
      ratedReviews: rating._count._all,
      goals: { total: goalsTotal, byStatus: goalsByStatus, overdue: overdueGoals, dueWithin30Days: dueSoonGoals },
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private isHr(principal: Principal): boolean {
    return principal.isSuperAdmin || principal.permissions.includes('performance.manage');
  }

  /** Managers (`performance.view`) and HR may look beyond their own records. */
  private canReachOthers(principal: Principal): boolean {
    return this.isHr(principal) || principal.permissions.includes('performance.view');
  }

  private reviewerFilter(principal: Principal): Record<string, unknown> {
    const or: Record<string, unknown>[] = [{ reviewerUserId: principal.userId }];
    if (principal.employeeId) or.push({ reviewerId: principal.employeeId });
    return { OR: or };
  }

  private feedbackVisibilityFilter(principal: Principal, subjectEmployeeId: string): Record<string, unknown> {
    if (this.isHr(principal)) return {};
    const visibilities: FeedbackVisibilityValue[] = ['PUBLIC'];
    if (this.canReachOthers(principal)) visibilities.push('MANAGER');
    if (subjectEmployeeId === principal.employeeId) visibilities.push('EMPLOYEE');
    return { OR: [{ visibility: { in: visibilities } }, { authorUserId: principal.userId }] };
  }

  private assertDateRange(startDate: string, endDate: string, label: string): void {
    if (new Date(endDate) < new Date(startDate)) throw new ValidationError(`${label} end date must be after the start date`);
  }

  private async assertReviewAccess(principal: Principal, review: { employeeId: string; reviewerId: string | null; reviewerUserId: string | null }) {
    if (this.canReachOthers(principal)) {
      await this.scope.assertEmployeeAccess(principal, review.employeeId);
      return;
    }
    const isSubject = review.employeeId === principal.employeeId;
    const isReviewer = review.reviewerUserId === principal.userId || review.reviewerId === principal.employeeId;
    if (!isSubject && !isReviewer) {
      throw new ForbiddenError('You do not have access to this review', 'REVIEW_SCOPE_DENIED');
    }
  }

  private assertCanSubmit(principal: Principal, review: { employeeId: string; reviewerId: string | null; reviewerUserId: string | null; type: string }) {
    if (this.isHr(principal)) return;
    const isReviewer = review.reviewerUserId === principal.userId || review.reviewerId === principal.employeeId;
    const isSelfReview = review.type === 'SELF' && review.employeeId === principal.employeeId;
    if (!isReviewer && !isSelfReview) {
      throw new ForbiddenError('Only the assigned reviewer can complete this review', 'REVIEW_WRITE_DENIED');
    }
  }

  /**
   * Goals are self-managed under `performance.self.view`; anything beyond the
   * caller's own record requires team scope and `performance.view`/`manage`.
   */
  private async assertGoalAccess(principal: Principal, employeeId: string) {
    if (employeeId === principal.employeeId) return;
    if (!this.canReachOthers(principal)) {
      throw new ForbiddenError('You can only manage your own goals', 'GOAL_SCOPE_DENIED');
    }
    await this.scope.assertEmployeeAccess(principal, employeeId);
  }

  private async loadGoal(id: string) {
    const goal = await this.prisma.client.goal.findFirst({ where: { id } });
    if (!goal) throw new NotFoundError('Goal', 'GOAL_NOT_FOUND');
    return goal;
  }

  private keyResultData(dto: CreateKeyResultDto) {
    const targetValue = dto.targetValue;
    const currentValue = dto.currentValue ?? 0;
    return {
      title: dto.title,
      targetValue,
      currentValue,
      unit: dto.unit,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      progress: keyResultProgress(currentValue, targetValue),
    };
  }

  private async recomputeGoalProgress(goalId: string): Promise<number> {
    const keyResults = await this.prisma.client.keyResult.findMany({ where: { goalId } });
    if (keyResults.length === 0) return 0;
    const progress = weightedProgress(keyResults);
    const goal = await this.prisma.client.goal.findFirst({ where: { id: goalId } });
    if (!goal) return progress;
    await this.prisma.client.goal.update({
      where: { id: goalId },
      data: {
        progress,
        status: statusForProgress(progress, goal.status),
        completedAt: progress === 100 ? (goal.completedAt ?? new Date()) : null,
      },
    });
    return progress;
  }

  private serializeReview<T extends { overallRating?: unknown }>(review: T) {
    return {
      ...review,
      overallRating: review.overallRating === null || review.overallRating === undefined ? null : Number(review.overallRating),
    };
  }

  private serializeGoal<T extends object>(goal: T) {
    const withKeyResults = goal as T & { keyResults?: { targetValue: unknown; currentValue: unknown }[] };
    return {
      ...withKeyResults,
      keyResults: withKeyResults.keyResults?.map((keyResult) => this.serializeKeyResult(keyResult)),
    };
  }

  private serializeKeyResult<T extends { targetValue: unknown; currentValue: unknown }>(keyResult: T) {
    return {
      ...keyResult,
      targetValue: Number(keyResult.targetValue),
      currentValue: Number(keyResult.currentValue),
    };
  }

  private serializeFeedback<T extends object>(feedback: T) {
    return { ...feedback };
  }

  /** Anonymous feedback keeps its author only for HR; everyone else gets `null`. */
  private hideAnonymousAuthor<T extends { isAnonymous: boolean; authorEmployeeId: string | null; authorUserId: string | null }>(
    feedback: T,
    principal: Principal,
  ) {
    if (!feedback.isAnonymous || this.isHr(principal)) return feedback;
    return { ...feedback, authorEmployeeId: null, authorUserId: null };
  }
}

function keyResultProgress(currentValue: number, targetValue: number): number {
  if (!targetValue) return currentValue > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((currentValue / targetValue) * 100)));
}

function weightedProgress(keyResults: { currentValue: unknown; targetValue: unknown }[]): number {
  if (keyResults.length === 0) return 0;
  const total = keyResults.reduce((sum, item) => sum + keyResultProgress(Number(item.currentValue), Number(item.targetValue)), 0);
  return Math.round(total / keyResults.length);
}

/** Keeps the status consistent with progress unless it was set explicitly. */
function statusForProgress(progress: number, current: GoalStatus): GoalStatus {
  if (current === 'DRAFT') return progress >= 100 ? 'COMPLETED' : 'DRAFT';
  if (progress >= 100) return 'COMPLETED';
  if (current === 'COMPLETED' || current === 'CANCELLED') return current;
  if (progress >= 70) return 'ON_TRACK';
  if (progress >= 30) return 'AT_RISK';
  return 'OFF_TRACK';
}
