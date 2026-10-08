import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomUUID } from 'node:crypto';
import type { Paginated, Principal } from '@peoplecore/shared';
import { APP_CONFIG, type AppConfig } from '../../config/configuration.js';
import { PrismaService, type PrismaTransaction } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { CryptoService } from '../../common/utils/crypto.util.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { STORAGE } from '../../storage/storage.module.js';
import type { StoragePort } from '../../storage/storage.port.js';
import { AuditService } from '../audit/audit.service.js';
import type {
  ApplyRetentionDto,
  ConsentQueryDto,
  CreateConsentDto,
  CreateDataExportDto,
  CreateErasureDto,
  CreateRetentionPolicyDto,
  DataExportQueryDto,
  DecideErasureDto,
  ErasureQueryDto,
  UpdateRetentionPolicyDto,
} from './dto/gdpr.dto.js';

interface EncryptedFields {
  nationalIdEnc: string | null;
  bankAccounts: { ibanEnc: string }[];
}

const CONSENT_SORTABLE = ['grantedAt', 'type'] as const;
const REQUEST_SORTABLE = ['createdAt', 'status', 'completedAt'] as const;
const EXPORT_CATEGORY_KEY = 'EXPORT';
const EXPORT_CATEGORY_NAME = 'Data export';

/**
 * GDPR: consent tracking, subject access (data export), erasure and retention.
 *
 * Self-service is deliberately available without `gdpr.manage`: an employee may
 * manage their own consents and request an export or erasure of their own data
 * (subject to the company privacy settings). Anything touching somebody else's
 * personal data requires the corresponding GDPR permission.
 */
@Injectable()
export class GdprService {
  private readonly logger = new Logger(GdprService.name);
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.crypto = new CryptoService(config.encryptionKey);
  }

  // ── Consents ──────────────────────────────────────────────────────────────

  async listConsents(principal: Principal, query: ConsentQueryDto): Promise<Paginated<unknown>> {
    const canManageOthers = this.hasPermission(principal, 'gdpr.view');
    const employeeId = query.employeeId ?? (canManageOthers ? undefined : principal.employeeId ?? undefined);
    if (!canManageOthers && query.employeeId && query.employeeId !== principal.employeeId) {
      throw new ForbiddenError('Missing permission: gdpr.view', 'PERMISSION_DENIED');
    }

    const where: Record<string, unknown> = {};
    if (employeeId) where['employeeId'] = employeeId;
    if (query.type) where['type'] = query.type;
    if (!query.includeRevoked) where['revokedAt'] = null;

    const { skip, take, orderBy } = buildQueryOptions(query, CONSENT_SORTABLE, { grantedAt: 'desc' });
    const [rows, total] = await Promise.all([
      this.prisma.client.consentRecord.findMany({ where, skip, take, orderBy }),
      this.prisma.client.consentRecord.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  async createConsent(principal: Principal, dto: CreateConsentDto) {
    const employeeId = dto.employeeId ?? principal.employeeId ?? null;
    const isSelf = employeeId !== null && employeeId === principal.employeeId;
    if (!isSelf && !this.hasPermission(principal, 'gdpr.manage')) {
      throw new ForbiddenError('Missing permission: gdpr.manage', 'PERMISSION_DENIED');
    }
    if (employeeId) {
      const employee = await this.prisma.client.employee.findFirst({ where: { id: employeeId } });
      if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    }

    const record = await this.prisma.client.consentRecord.create({
      data: tenantScoped({
        employeeId,
        userId: isSelf ? principal.userId : null,
        type: dto.type,
        granted: dto.granted,
        version: dto.version,
        source: dto.source ?? 'api',
        grantedAt: new Date(),
        revokedAt: dto.granted ? null : new Date(),
      }),
    });
    await this.audit.record({
      action: 'gdpr.consent.record',
      entityType: 'ConsentRecord',
      entityId: record.id,
      actorUserId: principal.userId,
      after: { type: record.type, granted: record.granted, version: record.version, employeeId: record.employeeId },
    });
    return record;
  }

  async revokeConsent(principal: Principal, id: string) {
    const record = await this.prisma.client.consentRecord.findFirst({ where: { id } });
    if (!record) throw new NotFoundError('Consent record', 'CONSENT_NOT_FOUND');

    const isSelf = (record.employeeId !== null && record.employeeId === principal.employeeId) || record.userId === principal.userId;
    if (!isSelf && !this.hasPermission(principal, 'gdpr.manage')) {
      throw new ForbiddenError('Missing permission: gdpr.manage', 'PERMISSION_DENIED');
    }

    const updated = await this.prisma.client.consentRecord.update({
      where: { id },
      data: { granted: false, revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'gdpr.consent.revoke',
      entityType: 'ConsentRecord',
      entityId: id,
      actorUserId: principal.userId,
      before: { granted: record.granted, revokedAt: record.revokedAt },
      after: { granted: updated.granted, revokedAt: updated.revokedAt },
    });
    return updated;
  }

  // ── Subject access (data export) ──────────────────────────────────────────

  /**
   * Builds the subject access bundle, stores it through the storage port as a
   * document in the `EXPORT` category and marks the request completed.
   *
   * `gdpr.export.completed` is emitted for the notifications module, which
   * delivers the download link through its queue.
   */
  async requestExport(principal: Principal, dto: CreateDataExportDto) {
    const settings = await this.privacySettings();
    const subject = await this.resolveSubject(principal, dto.subjectUserId, dto.subjectEmployeeId);

    const isSelf = subject.employeeId !== null && subject.employeeId === principal.employeeId;
    if (!isSelf && !this.hasPermission(principal, 'gdpr.manage')) {
      throw new ForbiddenError('Missing permission: gdpr.manage', 'PERMISSION_DENIED');
    }
    if (isSelf && settings?.allowEmployeeExport === false) {
      throw new ForbiddenError('Self-service data export is disabled for this company', 'EXPORT_DISABLED');
    }

    const request = await this.prisma.client.dataExportRequest.create({
      data: tenantScoped({
        subjectUserId: subject.userId ?? principal.userId,
        subjectEmployeeId: subject.employeeId,
        requestedById: principal.userId,
        status: 'PROCESSING',
        format: 'JSON',
      }),
    });

    try {
      const bundle = await this.buildBundle(principal, subject);
      const buffer = Buffer.from(JSON.stringify(bundle, null, 2), 'utf8');
      const stored = await this.storeExport(principal, subject, buffer);
      const completed = await this.prisma.client.dataExportRequest.update({
        where: { id: request.id },
        data: { status: 'COMPLETED', completedAt: new Date(), fileDocumentId: stored.documentId },
      });

      await this.audit.record({
        action: 'gdpr.export.completed',
        entityType: 'DataExportRequest',
        entityId: request.id,
        actorUserId: principal.userId,
        metadata: {
          subjectEmployeeId: subject.employeeId,
          subjectUserId: subject.userId,
          documentId: stored.documentId,
          sizeBytes: stored.sizeBytes,
        },
      });

      this.events.emit('gdpr.export.completed', {
        tenantId: this.prisma.currentTenantIdOrThrow(),
        requestId: completed.id,
        subjectUserId: completed.subjectUserId,
        subjectEmployeeId: completed.subjectEmployeeId,
        requestedById: principal.userId,
        documentId: stored.documentId,
        sizeBytes: stored.sizeBytes,
      });

      return {
        id: completed.id,
        status: completed.status,
        subjectUserId: completed.subjectUserId,
        subjectEmployeeId: completed.subjectEmployeeId,
        documentId: stored.documentId,
        sizeBytes: stored.sizeBytes,
        completedAt: completed.completedAt,
        sections: Object.keys(bundle),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Data export failed';
      await this.prisma.client.dataExportRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED', error: message },
      });
      this.logger.error(`Data export ${request.id} failed: ${message}`);
      throw error;
    }
  }

  async listExports(query: DataExportQueryDto): Promise<Paginated<unknown>> {
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    const { skip, take, orderBy } = buildQueryOptions(query, REQUEST_SORTABLE, { createdAt: 'desc' });
    const [rows, total] = await Promise.all([
      this.prisma.client.dataExportRequest.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { fileDocument: { select: { id: true, name: true } } },
      }),
      this.prisma.client.dataExportRequest.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  // ── Erasure ───────────────────────────────────────────────────────────────

  async requestErasure(principal: Principal, dto: CreateErasureDto) {
    const settings = await this.privacySettings();
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: dto.subjectEmployeeId },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const isSelf = employee.id === principal.employeeId;
    if (!isSelf && !this.hasPermission(principal, 'gdpr.manage')) {
      throw new ForbiddenError('Missing permission: gdpr.manage', 'PERMISSION_DENIED');
    }
    if (isSelf && settings?.allowEmployeeErasure === false) {
      throw new ForbiddenError('Self-service erasure requests are disabled for this company', 'ERASURE_DISABLED');
    }

    const pending = await this.prisma.client.erasureRequest.findFirst({
      where: { subjectEmployeeId: employee.id, status: { in: ['REQUESTED', 'PROCESSING'] } },
    });
    if (pending) throw new ConflictError('An erasure request for this employee is already pending', 'ERASURE_ALREADY_REQUESTED');

    const request = await this.prisma.client.erasureRequest.create({
      data: tenantScoped({
        subjectEmployeeId: employee.id,
        requestedById: principal.userId,
        status: 'REQUESTED',
        method: dto.method ?? 'ANONYMIZE',
        reason: dto.reason,
      }),
    });
    await this.audit.record({
      action: 'gdpr.erasure.request',
      entityType: 'ErasureRequest',
      entityId: request.id,
      actorUserId: principal.userId,
      after: { subjectEmployeeId: employee.id, method: request.method, reason: request.reason },
    });
    return request;
  }

  async listErasures(query: ErasureQueryDto): Promise<Paginated<unknown>> {
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    const { skip, take, orderBy } = buildQueryOptions(query, REQUEST_SORTABLE, { createdAt: 'desc' });
    const [rows, total] = await Promise.all([
      this.prisma.client.erasureRequest.findMany({ where, skip, take, orderBy }),
      this.prisma.client.erasureRequest.count({ where }),
    ]);
    return paginate(rows, total, query);
  }

  /**
   * Executes an approved erasure request.
   *
   * ANONYMIZE keeps the aggregate records (leave, attendance, payroll history)
   * but replaces every personal identifier with a neutral value and disables
   * the linked user account. DELETE removes the personal sub-resources
   * outright and soft-deletes the employee record.
   */
  async approveErasure(principal: Principal, id: string, dto: DecideErasureDto) {
    const request = await this.prisma.client.erasureRequest.findFirst({ where: { id } });
    if (!request) throw new NotFoundError('Erasure request', 'ERASURE_NOT_FOUND');
    if (request.status === 'COMPLETED') throw new ConflictError('This erasure request is already completed', 'ERASURE_COMPLETED');
    if (request.status === 'REJECTED') throw new ConflictError('This erasure request was rejected', 'ERASURE_REJECTED');

    const method = dto.method ?? request.method;
    const employee = await this.prisma.client.employee.findFirst({
      where: { id: request.subjectEmployeeId },
      select: { id: true, userId: true, workEmail: true, employeeNumber: true },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const affected =
      method === 'ANONYMIZE'
        ? await this.anonymize(employee.id, employee.userId)
        : await this.deletePersonalData(employee.id, employee.userId);

    const completed = await this.prisma.client.erasureRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        method,
        decidedById: principal.userId,
        decidedAt: new Date(),
        completedAt: new Date(),
        notes: dto.notes ?? request.notes,
      },
    });

    await this.audit.record({
      action: method === 'ANONYMIZE' ? 'gdpr.erasure.anonymize' : 'gdpr.erasure.delete',
      entityType: 'ErasureRequest',
      entityId: completed.id,
      actorUserId: principal.userId,
      metadata: { subjectEmployeeId: employee.id, method, affected },
    });

    this.events.emit('gdpr.erasure.completed', {
      tenantId: this.prisma.currentTenantIdOrThrow(),
      requestId: completed.id,
      subjectEmployeeId: employee.id,
      method,
      completedById: principal.userId,
    });

    return { ...completed, affected };
  }

  // ── Retention ─────────────────────────────────────────────────────────────

  async listRetention() {
    return this.prisma.client.retentionPolicy.findMany({ orderBy: { dataType: 'asc' } });
  }

  async createRetentionPolicy(principal: Principal, dto: CreateRetentionPolicyDto) {
    const existing = await this.prisma.client.retentionPolicy.findFirst({ where: { dataType: dto.dataType } });
    if (existing) throw new ConflictError(`A retention policy for ${dto.dataType} already exists`, 'RETENTION_POLICY_EXISTS');

    const policy = await this.prisma.client.retentionPolicy.create({
      data: tenantScoped({
        dataType: dto.dataType,
        retentionDays: dto.retentionDays,
        action: dto.action ?? 'ANONYMIZE',
        isActive: dto.isActive ?? true,
        updatedById: principal.userId,
      }),
    });
    await this.audit.record({
      action: 'gdpr.retention.create',
      entityType: 'RetentionPolicy',
      entityId: policy.id,
      actorUserId: principal.userId,
      after: policy,
    });
    return policy;
  }

  async updateRetentionPolicy(principal: Principal, id: string, dto: UpdateRetentionPolicyDto) {
    const before = await this.prisma.client.retentionPolicy.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Retention policy', 'RETENTION_POLICY_NOT_FOUND');

    const updated = await this.prisma.client.retentionPolicy.update({
      where: { id },
      data: {
        dataType: dto.dataType,
        retentionDays: dto.retentionDays,
        action: dto.action,
        isActive: dto.isActive,
        updatedById: principal.userId,
      },
    });
    await this.audit.record({
      action: 'gdpr.retention.update',
      entityType: 'RetentionPolicy',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  async deleteRetentionPolicy(principal: Principal, id: string) {
    const before = await this.prisma.client.retentionPolicy.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Retention policy', 'RETENTION_POLICY_NOT_FOUND');
    await this.prisma.client.retentionPolicy.delete({ where: { id } });
    await this.audit.record({
      action: 'gdpr.retention.delete',
      entityType: 'RetentionPolicy',
      entityId: id,
      actorUserId: principal.userId,
      before,
    });
    return { id, deleted: true };
  }

  /**
   * Runs the tenant's active retention policies. Intended to be invoked by the
   * daily scheduler (see the README note in the module docs) — it is idempotent
   * and safe to re-run.
   */
  async applyRetention(principal: Principal, dto: ApplyRetentionDto) {
    const policies = await this.prisma.client.retentionPolicy.findMany({
      where: {
        isActive: true,
        ...(dto.dataTypes && dto.dataTypes.length > 0 ? { dataType: { in: [...dto.dataTypes] } } : {}),
      },
      orderBy: { dataType: 'asc' },
    });
    if (policies.length === 0) {
      return { applied: [], total: 0, dryRun: dto.dryRun ?? false };
    }

    const tenantId = this.prisma.currentTenantIdOrThrow();
    const applied: { dataType: string; action: string; retentionDays: number; affected: number }[] = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 86_400_000);
      const affected = dto.dryRun
        ? await this.countForRetention(policy.dataType, policy.retentionDays, tenantId)
        : await this.applyPolicy(policy.dataType, policy.action, policy.retentionDays, tenantId);
      applied.push({
        dataType: policy.dataType,
        action: policy.action,
        retentionDays: policy.retentionDays,
        affected,
      });
      if (!dto.dryRun) {
        this.logger.log(`Retention ${policy.dataType} (${policy.action}, ${policy.retentionDays}d) affected ${affected} row(s) up to ${cutoff.toISOString()}`);
      }
    }

    if (!dto.dryRun) {
      await this.audit.record({
        action: 'gdpr.retention.apply',
        entityType: 'RetentionPolicy',
        actorUserId: principal.userId,
        actorType: 'SYSTEM',
        metadata: { applied },
      });
    }

    return { applied, total: applied.reduce((sum, entry) => sum + entry.affected, 0), dryRun: dto.dryRun ?? false };
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  async overview() {
    const [privacy, exports, erasures, consents, policies] = await Promise.all([
      this.privacySettings(),
      this.prisma.client.dataExportRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.erasureRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.consentRecord.groupBy({ by: ['type', 'granted'], _count: { _all: true } }),
      this.prisma.client.retentionPolicy.findMany({ orderBy: { dataType: 'asc' } }),
    ]);

    const consentStats: Record<string, { granted: number; revoked: number }> = {};
    let granted = 0;
    let revoked = 0;
    for (const entry of consents) {
      const bucket = (consentStats[entry.type] ??= { granted: 0, revoked: 0 });
      if (entry.granted) {
        bucket.granted += entry._count._all;
        granted += entry._count._all;
      } else {
        bucket.revoked += entry._count._all;
        revoked += entry._count._all;
      }
    }

    const byStatus = (rows: { status: string; _count: { _all: number } }[]) => {
      const result: Record<string, number> = {};
      for (const row of rows) result[row.status] = row._count._all;
      return result;
    };

    return {
      privacySettings: privacy,
      exports: { total: exports.reduce((sum, row) => sum + row._count._all, 0), byStatus: byStatus(exports) },
      erasures: { total: erasures.reduce((sum, row) => sum + row._count._all, 0), byStatus: byStatus(erasures) },
      consents: { total: granted + revoked, granted, revoked, byType: consentStats },
      retention: {
        policies: policies.length,
        active: policies.filter((policy) => policy.isActive).length,
        byDataType: policies.map((policy) => ({
          dataType: policy.dataType,
          retentionDays: policy.retentionDays,
          action: policy.action,
          isActive: policy.isActive,
        })),
      },
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private hasPermission(principal: Principal, permission: string): boolean {
    return principal.isSuperAdmin || principal.permissions.includes(permission);
  }

  private privacySettings() {
    return this.prisma.client.tenantPrivacySettings.findFirst();
  }

  private async resolveSubject(principal: Principal, subjectUserId?: string, subjectEmployeeId?: string) {
    if (!subjectUserId && !subjectEmployeeId) {
      const employee = principal.employeeId
        ? await this.prisma.client.employee.findFirst({
            where: { id: principal.employeeId },
            select: { id: true, userId: true },
          })
        : null;
      return { userId: employee?.userId ?? principal.userId, employeeId: employee?.id ?? null };
    }

    const employee = subjectEmployeeId
      ? await this.prisma.client.employee.findFirst({
          where: { id: subjectEmployeeId },
          select: { id: true, userId: true },
        })
      : await this.prisma.client.employee.findFirst({
          where: { userId: subjectUserId },
          select: { id: true, userId: true },
        });
    if (!employee && !subjectUserId) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');

    const userId = subjectUserId ?? employee?.userId ?? null;
    if (!employee && !userId) throw new NotFoundError('Subject', 'SUBJECT_NOT_FOUND');
    return { userId, employeeId: employee?.id ?? null };
  }

  /** Everything the platform stores about one person, as a JSON-safe bundle. */
  private async buildBundle(principal: Principal, subject: { userId: string | null; employeeId: string | null }) {
    const db = this.prisma.client;
    const tenantId = this.prisma.currentTenantIdOrThrow();
    const employeeId = subject.employeeId;

    const user = subject.userId
      ? await db.user.findFirst({
          where: { id: subject.userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            locale: true,
            status: true,
            isSuperAdmin: true,
            emailVerifiedAt: true,
            mfaEnabled: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            roles: { select: { role: { select: { key: true, name: true } } } },
          },
        })
      : null;

    const employee = employeeId
      ? await db.employee.findFirst({
          where: { id: employeeId },
          include: {
            department: { select: { name: true } },
            team: { select: { name: true } },
            location: { select: { name: true } },
            position: { select: { title: true } },
            manager: { select: { firstName: true, lastName: true } },
            emergencyContacts: true,
            bankAccounts: true,
            education: true,
            skills: { include: { skill: { select: { name: true, category: true } } } },
            languages: true,
            notes: { select: { id: true, body: true, visibility: true, createdAt: true } },
            contracts: true,
            compensation: true,
            benefits: true,
            history: true,
            leaveBalances: { include: { leaveType: { select: { name: true, key: true } } } },
            leaveRequests: {
              include: { leaveType: { select: { name: true, key: true } }, approvals: true },
            },
            attendance: { orderBy: { date: 'desc' }, take: 730 },
            corrections: true,
            documents: {
              select: {
                id: true,
                name: true,
                description: true,
                status: true,
                confidentiality: true,
                issuedAt: true,
                expiresAt: true,
                category: { select: { key: true, name: true } },
                createdAt: true,
              },
            },
            documentAcks: { select: { id: true, documentId: true, acknowledgedAt: true, ip: true } },
            expenses: { include: { category: { select: { name: true } } } },
            requests: { include: { comments: true } },
            reviews: { include: { cycle: { select: { name: true } }, reviewer: { select: { firstName: true, lastName: true } } } },
            reviewsWritten: { select: { id: true, cycleId: true, employeeId: true, status: true, submittedAt: true } },
            feedbackReceived: true,
            feedbackWritten: true,
            goals: { include: { keyResults: true } },
            training: { include: { course: { select: { title: true } } } },
            certifications: true,
            learningPlans: { include: { items: true } },
            assets: { select: { id: true, name: true, category: true, status: true, serialNumber: true, assignedAt: true, returnedAt: true } },
            assetHistory: true,
          },
        })
      : null;

    const [notifications, consents, auditTrail] = await Promise.all([
      subject.userId
        ? db.notification.findMany({
            where: { userId: subject.userId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true },
          })
        : Promise.resolve([]),
      db.consentRecord.findMany({
        where: {
          OR: [{ employeeId: employeeId ?? undefined }, { userId: subject.userId ?? undefined }],
        },
      }),
      db.auditLog.findMany({
        where: {
          tenantId,
          OR: [
            ...(subject.userId ? [{ actorUserId: subject.userId }] : []),
            ...(employeeId ? [{ entityId: employeeId }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { id: true, action: true, entityType: true, entityId: true, actorType: true, createdAt: true },
      }),
    ]);

    return {
      metadata: {
        generatedAt: new Date().toISOString(),
        tenantId,
        requestedById: principal.userId,
        subjectUserId: subject.userId,
        subjectEmployeeId: employeeId,
        note: 'Full subject access export generated by PeopleCore.',
      },
      user,
      employee: employee ? this.decryptSensitive(employee) : null,
      notifications,
      consents,
      auditTrail,
    };
  }

  /** Replaces encrypted-at-rest values with their plaintext for the data subject. */
  private decryptSensitive<T extends EncryptedFields>(
    employee: T,
  ): Omit<T, keyof EncryptedFields> & { nationalId: string | null; bankAccounts: { iban: string | null }[] } {
    const { nationalIdEnc, bankAccounts, ...rest } = employee;
    return {
      ...(rest as Omit<T, keyof EncryptedFields>),
      nationalId: this.tryDecrypt(nationalIdEnc),
      bankAccounts: bankAccounts.map((account) => ({
        ...account,
        iban: this.tryDecrypt(account.ibanEnc),
      })),
    };
  }

  private tryDecrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      return this.crypto.decrypt(value);
    } catch {
      return '[unreadable]';
    }
  }

  private async storeExport(
    principal: Principal,
    subject: { userId: string | null; employeeId: string | null },
    buffer: Buffer,
  ): Promise<{ documentId: string; sizeBytes: number }> {
    const tenantId = this.prisma.currentTenantIdOrThrow();
    const documentId = randomUUID();
    const fileName = `data-export-${new Date().toISOString().slice(0, 10)}.json`;
    const storageKey = `${tenantId}/${documentId}/v1/${fileName}`;
    const stored = await this.storage.put(storageKey, buffer, { contentType: 'application/json' });

    const category = await this.prisma.client.documentCategory.upsert({
      where: { tenantId_key: { tenantId, key: EXPORT_CATEGORY_KEY } },
      create: tenantScoped({
        key: EXPORT_CATEGORY_KEY,
        name: EXPORT_CATEGORY_NAME,
        description: 'Generated GDPR subject access exports (JSON)',
        isSystem: true,
      }),
      update: {},
    });

    const checksum = createHash('sha256').update(buffer).digest('hex');
    await this.prisma.transaction(async (tx: PrismaTransaction) => {
      const document = await tx.document.create({
        data: tenantScoped({
          id: documentId,
          employeeId: subject.employeeId,
          categoryId: category.id,
          name: `Data export ${new Date().toISOString().slice(0, 10)}`,
          description: 'Subject access export generated on request',
          confidentiality: 'RESTRICTED',
          uploadedById: principal.userId,
        }),
      });
      const version = await tx.documentVersion.create({
        data: tenantScoped({
          documentId: document.id,
          version: 1,
          storageKey: stored.storageKey,
          fileName,
          mimeType: 'application/json',
          sizeBytes: stored.sizeBytes,
          checksum,
          uploadedById: principal.userId,
        }),
      });
      await tx.document.update({ where: { id: document.id }, data: { currentVersionId: version.id } });
    });

    return { documentId, sizeBytes: stored.sizeBytes };
  }

  private async anonymize(employeeId: string, userId: string | null) {
    const neutralEmail = `anonymized-${employeeId.slice(0, 8)}@removed.invalid`;
    const affected: Record<string, number> = {};

    await this.prisma.transaction(async (tx) => {
      const employee = await tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: 'Anonymized',
          lastName: `Employee ${employeeId.slice(0, 8)}`,
          preferredName: null,
          photoUrl: null,
          workEmail: neutralEmail,
          personalEmail: null,
          phone: null,
          birthDate: null,
          gender: null,
          address: null,
          city: null,
          country: null,
          nationalIdEnc: null,
          terminationReason: 'GDPR erasure (anonymized)',
        },
      });

      const banks = await tx.bankAccount.updateMany({
        where: { employeeId },
        data: { accountHolder: 'Anonymized', ibanEnc: '[redacted]', bic: null, bankName: null },
      });
      const contacts = await tx.emergencyContact.updateMany({
        where: { employeeId },
        data: { name: 'Anonymized', phone: '0000000000', email: null, relationship: 'redacted' },
      });
      const notes = await tx.employeeNote.updateMany({
        where: { employeeId },
        data: { body: '[removed by GDPR erasure]' },
      });

      affected['employee'] = 1;
      affected['bankAccounts'] = banks.count;
      affected['emergencyContacts'] = contacts.count;
      affected['notes'] = notes.count;

      if (userId) {
        affected['sessions'] = await this.disableUser(tx, userId, employee.id);
      }
    });

    return affected;
  }

  private async deletePersonalData(employeeId: string, userId: string | null) {
    const affected: Record<string, number> = {};
    await this.prisma.transaction(async (tx) => {
      affected['emergencyContacts'] = (await tx.emergencyContact.deleteMany({ where: { employeeId } })).count;
      affected['bankAccounts'] = (await tx.bankAccount.deleteMany({ where: { employeeId } })).count;
      affected['education'] = (await tx.employeeEducation.deleteMany({ where: { employeeId } })).count;
      affected['languages'] = (await tx.employeeLanguage.deleteMany({ where: { employeeId } })).count;
      affected['skills'] = (await tx.employeeSkill.deleteMany({ where: { employeeId } })).count;
      affected['notes'] = (await tx.employeeNote.deleteMany({ where: { employeeId } })).count;
      affected['acknowledgments'] = (await tx.documentAcknowledgment.deleteMany({ where: { employeeId } })).count;

      await tx.employee.update({
        where: { id: employeeId },
        data: {
          status: 'TERMINATED',
          deletedAt: new Date(),
          terminationDate: new Date(),
          terminationReason: 'GDPR erasure (deleted)',
          personalEmail: null,
          phone: null,
          nationalIdEnc: null,
          address: null,
          city: null,
          country: null,
        },
      });
      affected['employee'] = 1;

      if (userId) {
        affected['sessions'] = await this.disableUser(tx, userId, employeeId);
      }
    });
    return affected;
  }

  /** Disables the linked user account and revokes every active session. */
  private async disableUser(tx: PrismaTransaction, userId: string, employeeId: string): Promise<number> {
    const sessions = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'GDPR erasure' },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        status: 'DISABLED',
        deletedAt: new Date(),
        email: `anonymized-${userId.slice(0, 8)}@removed.invalid`,
        phone: null,
        passwordHash: null,
        mfaEnabled: false,
        mfaSecretEnc: null,
      },
    });
    await tx.employee.update({ where: { id: employeeId }, data: { userId: null } });
    return sessions.count;
  }

  private retentionCutoff(days: number): Date {
    return new Date(Date.now() - days * 86_400_000);
  }

  private async countForRetention(dataType: string, retentionDays: number, tenantId: string): Promise<number> {
    const cutoff = this.retentionCutoff(retentionDays);
    switch (dataType) {
      case 'DOCUMENT':
        return this.prisma.client.document.count({ where: { createdAt: { lt: cutoff } } });
      case 'NOTIFICATION':
        return this.prisma.client.notification.count({ where: { createdAt: { lt: cutoff }, readAt: { not: null } } });
      case 'AUDIT_LOG':
        return this.prisma.client.auditLog.count({ where: { tenantId, createdAt: { lt: cutoff } } });
      case 'SESSION':
        return this.prisma.client.session.count({
          where: {
            user: { tenantId },
            OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
          },
        });
      case 'CONSENT':
        return this.prisma.client.consentRecord.count({ where: { revokedAt: { not: null, lt: cutoff } } });
      default:
        return 0;
    }
  }

  /** Applies one retention policy and returns the number of affected rows. */
  private async applyPolicy(dataType: string, action: string, retentionDays: number, tenantId: string): Promise<number> {
    const cutoff = this.retentionCutoff(retentionDays);

    switch (dataType) {
      case 'DOCUMENT': {
        const where = { createdAt: { lt: cutoff } };
        if (action === 'DELETE') return (await this.prisma.client.document.deleteMany({ where })).count;
        if (action === 'ARCHIVE') {
          return (await this.prisma.client.document.updateMany({ where, data: { status: 'ARCHIVED' } })).count;
        }
        return (await this.prisma.client.document.updateMany({ where, data: { status: 'ARCHIVED', name: 'Retention-policy document' } })).count;
      }
      case 'NOTIFICATION': {
        // Notifications carry no analytical value — every action removes them.
        return (await this.prisma.client.notification.deleteMany({ where: { createdAt: { lt: cutoff }, readAt: { not: null } } })).count;
      }
      case 'AUDIT_LOG': {
        return (await this.prisma.client.auditLog.deleteMany({ where: { tenantId, createdAt: { lt: cutoff } } })).count;
      }
      case 'SESSION': {
        return (
          await this.prisma.client.session.deleteMany({
            where: {
              user: { tenantId },
              OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { not: null, lt: cutoff } }],
            },
          })
        ).count;
      }
      case 'CONSENT': {
        const where = { revokedAt: { not: null, lt: cutoff } };
        if (action === 'ANONYMIZE') {
          return (await this.prisma.client.consentRecord.updateMany({ where, data: { ip: null, source: null } })).count;
        }
        return (await this.prisma.client.consentRecord.deleteMany({ where })).count;
      }
      default:
        throw new ValidationError(`Unsupported retention data type: ${dataType}`);
    }
  }
}
