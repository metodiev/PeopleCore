import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { currentContext } from '../../prisma/request-context.js';
import type { Paginated } from '@peoplecore/shared';
import { paginate, type PaginationInput } from '../../common/utils/pagination.util.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  actorUserId?: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'API' | 'INTEGRATION';
  tenantId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditQuery extends PaginationInput {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: string;
  to?: string;
}

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'secret',
  'token',
  'refreshtoken',
  'accesstoken',
  'mfarecoverycode',
  'iban',
  'nationalid',
  'signature',
];

/**
 * Converts a value into a JSON-safe, secret-free snapshot for the audit trail.
 * Dates, Decimals, class instances, functions and cycles are all handled so an
 * audit write can never fail because of the shape of the value it records.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[truncated]';
  if (typeof value === 'function') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…[truncated]`;
    return value;
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1, seen));

  const prototype = Object.getPrototypeOf(value) as object | null;
  const isPlain = prototype === Object.prototype || prototype === null;
  if (!isPlain) {
    // Prisma Decimal, Map, Set and other library types: use a readable form.
    if (typeof (value as { toJSON?: () => unknown }).toJSON === 'function') {
      return redact((value as { toJSON: () => unknown }).toJSON(), depth + 1, seen);
    }
    return String(value);
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'constructor') continue;
    if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
      result[key] = '[redacted]';
      continue;
    }
    const redacted = redact(entry, depth + 1, seen);
    if (redacted !== undefined) result[key] = redacted;
  }
  return result;
}

/**
 * Append-only audit trail. Every significant change (who did what, when,
 * with which before/after values) is recorded here. Records are never updated
 * or deleted through the API.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const context = currentContext();
    try {
      await this.prisma.raw.auditLog.create({
        data: {
          tenantId: input.tenantId !== undefined ? input.tenantId : (context?.tenantId ?? null),
          actorUserId: input.actorUserId ?? context?.userId ?? null,
          actorType: input.actorType ?? (context?.userId ? 'USER' : 'SYSTEM'),
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          before: input.before === undefined ? undefined : (redact(input.before) as never),
          after: input.after === undefined ? undefined : (redact(input.after) as never),
          metadata: input.metadata === undefined ? undefined : (redact(input.metadata) as never),
          ip: input.ip ?? null,
          userAgent: input.userAgent?.slice(0, 512) ?? null,
          requestId: context?.requestId ?? null,
        },
      });
    } catch (error) {
      // Audit failures must never break the business operation, but they are loud.
      this.logger.error(`Failed to write audit entry ${input.action}/${input.entityType}`, error as Error);
    }
  }

  async recordRequest(
    input: Omit<AuditInput, 'ip' | 'userAgent'>,
    request?: { ip?: string; headers: Record<string, unknown> },
  ): Promise<void> {
    await this.record({
      ...input,
      ip: request?.ip ?? null,
      userAgent: typeof request?.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    });
  }

  async list(tenantId: string, query: AuditQuery): Promise<Paginated<unknown>> {
    const where: Record<string, unknown> = { tenantId };
    if (query.entityType) where['entityType'] = query.entityType;
    if (query.entityId) where['entityId'] = query.entityId;
    if (query.actorUserId) where['actorUserId'] = query.actorUserId;
    if (query.action) where['action'] = { contains: query.action, mode: 'insensitive' };
    if (query.from || query.to) {
      where['createdAt'] = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const [rows, total] = await Promise.all([
      this.prisma.raw.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.raw.auditLog.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      { page, pageSize },
    );
  }
}
