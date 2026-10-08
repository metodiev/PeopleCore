import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { HRRequestStatus, Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  AssignHRRequestDto,
  CreateHRRequestDto,
  HRRequestCommentDto,
  HRRequestQueryDto,
  HRRequestStatsQueryDto,
  UpdateHRRequestStatusDto,
} from './dto/requests.dto.js';

const SORTABLE = ['createdAt', 'updatedAt', 'priority', 'status', 'dueDate'] as const;

const OPEN_STATUSES: HRRequestStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_EMPLOYEE'];

export interface HRRequestCreatedEvent {
  tenantId: string;
  requestId: string;
  employeeId: string;
  type: string;
  priority: string;
  subject: string;
}

export interface HRRequestEvent {
  tenantId: string;
  requestId: string;
  employeeId: string;
  status: string;
  assignedToUserId: string | null;
  resolution: string | null;
}

export interface HRRequestCommentEvent {
  tenantId: string;
  requestId: string;
  commentId: string;
  authorUserId: string;
  isInternal: boolean;
}

/**
 * HR self-service tickets ("my request to HR"): employees raise tickets, HR
 * works them in an inbox with assignment, internal comments, status handling
 * and SLA statistics.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Employee side ─────────────────────────────────────────────────────────

  async create(principal: Principal, dto: CreateHRRequestDto) {
    const employeeId = dto.employeeId ?? principal.employeeId;
    if (!employeeId) throw new ValidationError('employeeId is required — the caller has no employee record');
    if (employeeId !== principal.employeeId) {
      if (!this.isHr(principal)) throw new ForbiddenError('You can only raise requests for yourself', 'REQUEST_SCOPE_DENIED');
      await this.scope.assertEmployeeAccess(principal, employeeId);
    }

    const request = await this.prisma.client.hRRequest.create({
      data: tenantScoped({
        employeeId,
        type: dto.type,
        subject: dto.subject,
        description: dto.description,
        priority: dto.priority ?? 'NORMAL',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: 'OPEN',
      }),
    });
    this.events.emit('request.created', {
      tenantId: principal.tenantId!,
      requestId: request.id,
      employeeId,
      type: request.type,
      priority: request.priority,
      subject: request.subject,
    } satisfies HRRequestCreatedEvent);

    await this.audit.record({
      action: 'hrRequest.create',
      entityType: 'HRRequest',
      entityId: request.id,
      actorUserId: principal.userId,
      after: { employeeId, type: request.type, priority: request.priority, subject: request.subject },
    });
    return request;
  }

  async list(principal: Principal, query: HRRequestQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { createdAt: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
    if (query.unassigned) filters.push({ assigneeId: null });
    if (query.search) {
      filters.push({
        OR: [
          { subject: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.mine) {
      filters.push({ employeeId: principal.employeeId ?? NO_MATCH_ID });
    } else if (query.employeeId) {
      if (query.employeeId !== principal.employeeId) await this.scope.assertEmployeeAccess(principal, query.employeeId);
      filters.push({ employeeId: query.employeeId });
    } else if (this.hasRequestsView(principal)) {
      filters.push({ employee: await this.scope.employeeWhere(principal) });
    } else {
      filters.push({ employeeId: principal.employeeId ?? NO_MATCH_ID });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.hRRequest.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true } },
          _count: { select: { comments: true } },
        },
      }),
      this.prisma.client.hRRequest.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async get(principal: Principal, id: string) {
    const request = await this.prisma.client.hRRequest.findFirst({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, workEmail: true } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundError('HR request', 'HR_REQUEST_NOT_FOUND');
    this.assertCanView(principal, request);

    const canSeeInternal = this.isHr(principal);
    const comments = request.comments.filter((comment) => canSeeInternal || !comment.isInternal);
    const authors = await this.authorNames(comments.map((comment) => comment.authorUserId));
    return {
      ...request,
      comments: comments.map((comment) => ({
        ...comment,
        author: authors.get(comment.authorUserId) ?? null,
      })),
    };
  }

  async addComment(principal: Principal, id: string, dto: HRRequestCommentDto) {
    const request = await this.prisma.client.hRRequest.findFirst({ where: { id } });
    if (!request) throw new NotFoundError('HR request', 'HR_REQUEST_NOT_FOUND');
    this.assertCanView(principal, request);
    if (dto.isInternal && !this.isHr(principal)) {
      throw new ForbiddenError('Only HR can add internal comments', 'REQUEST_INTERNAL_COMMENT_DENIED');
    }
    if (request.status === 'CLOSED' || request.status === 'CANCELLED') {
      throw new ConflictError('A closed ticket can no longer be commented on', 'REQUEST_NOT_OPEN');
    }

    const comment = await this.prisma.client.hRRequestComment.create({
      data: tenantScoped({
        requestId: id,
        authorUserId: principal.userId,
        body: dto.body,
        // Employees can never widen visibility, whatever they send.
        isInternal: this.isHr(principal) ? (dto.isInternal ?? false) : false,
      }),
    });

    this.events.emit('request.comment', {
      tenantId: principal.tenantId!,
      requestId: id,
      commentId: comment.id,
      authorUserId: principal.userId,
      isInternal: comment.isInternal,
    } satisfies HRRequestCommentEvent);

    await this.audit.record({
      action: 'hrRequest.comment',
      entityType: 'HRRequestComment',
      entityId: comment.id,
      actorUserId: principal.userId,
      after: { requestId: id, isInternal: comment.isInternal },
    });
    return comment;
  }

  async cancel(principal: Principal, id: string) {
    const request = await this.prisma.client.hRRequest.findFirst({ where: { id } });
    if (!request) throw new NotFoundError('HR request', 'HR_REQUEST_NOT_FOUND');
    this.assertCanView(principal, request);
    if (!OPEN_STATUSES.includes(request.status)) {
      throw new ConflictError(`A ${request.status.toLowerCase()} ticket cannot be cancelled`, 'REQUEST_NOT_CANCELLABLE');
    }

    const updated = await this.prisma.client.hRRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record({
      action: 'hrRequest.cancel',
      entityType: 'HRRequest',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: request.status },
      after: { status: updated.status },
    });
    return updated;
  }

  // ── HR inbox ──────────────────────────────────────────────────────────────

  /** The HR inbox is company-wide by design — `requests.manage` is the gate. */
  async inbox(_principal: Principal, query: HRRequestQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { priority: 'desc' });
    const filters: Record<string, unknown>[] = [];
    if (query.status) filters.push({ status: query.status });
    if (query.type) filters.push({ type: query.type });
    if (query.priority) filters.push({ priority: query.priority });
    if (query.assigneeId) filters.push({ assigneeId: query.assigneeId });
    if (query.unassigned) filters.push({ assigneeId: null });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.search) {
      filters.push({
        OR: [
          { subject: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where = { AND: filters };
    const [rows, total] = await Promise.all([
      this.prisma.client.hRRequest.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, photoUrl: true } },
          _count: { select: { comments: true } },
        },
      }),
      this.prisma.client.hRRequest.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async assign(principal: Principal, id: string, dto: AssignHRRequestDto) {
    const request = await this.prisma.client.hRRequest.findFirst({ where: { id } });
    if (!request) throw new NotFoundError('HR request', 'HR_REQUEST_NOT_FOUND');
    if (request.status === 'CLOSED' || request.status === 'CANCELLED') {
      throw new ConflictError('A closed ticket can no longer be assigned', 'REQUEST_NOT_OPEN');
    }

    const assignee = await this.prisma.client.user.findFirst({
      where: { id: dto.assigneeId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!assignee) throw new NotFoundError('Assignee', 'ASSIGNEE_NOT_FOUND');

    const updated = await this.prisma.client.hRRequest.update({
      where: { id },
      data: { assigneeId: dto.assigneeId, status: request.status === 'OPEN' ? 'IN_PROGRESS' : request.status },
    });

    this.events.emit('request.assigned', {
      tenantId: principal.tenantId!,
      requestId: id,
      employeeId: request.employeeId,
      status: updated.status,
      assignedToUserId: assignee.id,
      resolution: updated.resolution,
    } satisfies HRRequestEvent);

    await this.audit.record({
      action: 'hrRequest.assign',
      entityType: 'HRRequest',
      entityId: id,
      actorUserId: principal.userId,
      before: { assigneeId: request.assigneeId, status: request.status },
      after: { assigneeId: updated.assigneeId, status: updated.status },
    });
    return { ...updated, assignee };
  }

  async updateStatus(principal: Principal, id: string, dto: UpdateHRRequestStatusDto) {
    const request = await this.prisma.client.hRRequest.findFirst({ where: { id } });
    if (!request) throw new NotFoundError('HR request', 'HR_REQUEST_NOT_FOUND');
    if (request.status === 'CLOSED' && dto.status !== 'CLOSED') {
      throw new ConflictError('A closed ticket can no longer change status', 'REQUEST_NOT_OPEN');
    }
    if (dto.status === 'RESOLVED' && !dto.resolution?.trim()) {
      throw new ValidationError('A resolution text is required to resolve a ticket');
    }

    const resolvedAt = dto.status === 'RESOLVED' ? (request.resolvedAt ?? new Date()) : request.resolvedAt;
    const updated = await this.prisma.client.hRRequest.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution ?? request.resolution,
        resolvedAt: dto.status === 'RESOLVED' ? resolvedAt : request.resolvedAt,
        assigneeId: request.assigneeId ?? principal.userId,
      },
    });

    this.events.emit('request.resolved', {
      tenantId: principal.tenantId!,
      requestId: id,
      employeeId: request.employeeId,
      status: updated.status,
      assignedToUserId: updated.assigneeId,
      resolution: updated.resolution,
    } satisfies HRRequestEvent);

    await this.audit.record({
      action: 'hrRequest.status',
      entityType: 'HRRequest',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: request.status },
      after: { status: updated.status, resolution: updated.resolution },
    });
    return updated;
  }

  /** SLA view: open volume, average resolution time and the oldest open ticket. */
  async stats(principal: Principal, query: HRRequestStatsQueryDto) {
    const created = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
    const scopeFilter = this.isHr(principal) ? {} : { employee: await this.scope.employeeWhere(principal) };
    const where = { AND: [scopeFilter, Object.keys(created).length > 0 ? { createdAt: created } : {}] };

    const [byType, byPriority, resolved, openCount, oldestOpen] = await Promise.all([
      this.prisma.client.hRRequest.groupBy({
        by: ['type'],
        where: { AND: [where, { status: { in: OPEN_STATUSES } }] },
        _count: { _all: true },
      }),
      this.prisma.client.hRRequest.groupBy({
        by: ['priority'],
        where: { AND: [where, { status: { in: OPEN_STATUSES } }] },
        _count: { _all: true },
      }),
      this.prisma.client.hRRequest.findMany({
        where: { AND: [where, { resolvedAt: { not: null } }] },
        select: { createdAt: true, resolvedAt: true, type: true },
        orderBy: { resolvedAt: 'desc' },
        take: 1000,
      }),
      this.prisma.client.hRRequest.count({ where: { AND: [where, { status: { in: OPEN_STATUSES } }] } }),
      this.prisma.client.hRRequest.findFirst({
        where: { AND: [where, { status: { in: OPEN_STATUSES } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true, subject: true, type: true, priority: true, createdAt: true, employeeId: true },
      }),
    ]);

    const resolutionHours = resolved
      .filter((row) => row.resolvedAt !== null)
      .map((row) => (row.resolvedAt!.getTime() - row.createdAt.getTime()) / 3_600_000);
    const averageResolutionHours =
      resolutionHours.length > 0
        ? Number((resolutionHours.reduce((sum, hours) => sum + hours, 0) / resolutionHours.length).toFixed(2))
        : null;

    const perType: Record<string, number> = {};
    for (const group of byType) perType[group.type] = group._count._all;
    const perPriority: Record<string, number> = {};
    for (const group of byPriority) perPriority[group.priority] = group._count._all;

    const oldestAgeHours = oldestOpen
      ? Number(((Date.now() - oldestOpen.createdAt.getTime()) / 3_600_000).toFixed(2))
      : null;

    return {
      open: openCount,
      openByType: perType,
      openByPriority: perPriority,
      resolved: resolutionHours.length,
      averageResolutionHours,
      oldestOpen: oldestOpen ? { ...oldestOpen, ageHours: oldestAgeHours } : null,
      oldestOpenAgeHours: oldestAgeHours,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private isHr(principal: Principal): boolean {
    return principal.isSuperAdmin || principal.permissions.includes('requests.manage');
  }

  private hasRequestsView(principal: Principal): boolean {
    return this.isHr(principal) || principal.permissions.includes('requests.view');
  }

  /** The ticket owner, its assignee and anyone with `requests.view` may read it. */
  private assertCanView(
    principal: Principal,
    request: { employeeId: string; assigneeId: string | null },
  ): void {
    if (this.hasRequestsView(principal)) return;
    if (request.employeeId === principal.employeeId) return;
    if (request.assigneeId && request.assigneeId === principal.userId) return;
    throw new ForbiddenError('You do not have access to this request', 'REQUEST_SCOPE_DENIED');
  }

  private async authorNames(userIds: string[]) {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map<string, { id: string; firstName: string; lastName: string; email: string }>();
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }
}

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';
