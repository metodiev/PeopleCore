import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Paginated, Principal, UploadedFileLike } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, StorageError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import { STORAGE } from '../../storage/storage.module.js';
import type { StoragePort } from '../../storage/storage.port.js';
import type { CreateCategoryDto, DocumentQueryDto, UpdateDocumentDto, UploadDocumentDto } from './dto/document.dto.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
]);

const SORTABLE = ['createdAt', 'name', 'expiresAt', 'status'] as const;

/**
 * Secure document storage per employee: versioned uploads, expiry tracking,
 * confidentiality levels, digital acknowledgement and reminder events.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  async list(principal: Principal, query: DocumentQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE);
    const where: Record<string, unknown> = {};
    if (query.categoryId) where['categoryId'] = query.categoryId;
    if (query.status) where['status'] = query.status;
    if (query.employeeId) {
      await this.scope.assertEmployeeAccess(principal, query.employeeId);
      where['employeeId'] = query.employeeId;
    }
    if (query.expiringWithinDays) {
      where['expiresAt'] = { not: null, lte: new Date(Date.now() + query.expiringWithinDays * 86_400_000) };
    }
    if (query.search) where['name'] = { contains: query.search, mode: 'insensitive' };

    const employeeScope = await this.scope.employeeWhere(principal);
    const finalWhere = { AND: [where, { OR: [{ employee: employeeScope }, { employeeId: null }] }] };

    const [rows, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where: finalWhere,
        skip,
        take,
        orderBy,
        include: {
          category: { select: { id: true, key: true, name: true } },
          currentVersion: true,
          employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
          _count: { select: { versions: true, acknowledgments: true } },
        },
      }),
      this.prisma.client.document.count({ where: finalWhere }),
    ]);

    return paginate(
      rows.map((document) => ({
        id: document.id,
        name: document.name,
        description: document.description,
        status: document.status,
        confidentiality: document.confidentiality,
        issuedAt: document.issuedAt?.toISOString().slice(0, 10) ?? null,
        expiresAt: document.expiresAt?.toISOString().slice(0, 10) ?? null,
        category: document.category,
        employee: document.employee,
        currentVersion: document.currentVersion
          ? {
              version: document.currentVersion.version,
              fileName: document.currentVersion.fileName,
              mimeType: document.currentVersion.mimeType,
              sizeBytes: document.currentVersion.sizeBytes,
              uploadedAt: document.currentVersion.createdAt.toISOString(),
            }
          : null,
        versions: document._count.versions,
        acknowledgments: document._count.acknowledgments,
        createdAt: document.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }

  async get(principal: Principal, id: string) {
    const document = await this.prisma.client.document.findFirst({
      where: { id },
      include: {
        category: true,
        versions: { orderBy: { version: 'desc' } },
        acknowledgments: {
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!document) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (document.employeeId) await this.scope.assertEmployeeAccess(principal, document.employeeId);
    return document;
  }

  async upload(principal: Principal, dto: UploadDocumentDto, file: UploadedFileLike) {
    this.assertFileAllowed(file);

    if (dto.employeeId) {
      const employee = await this.prisma.client.employee.findFirst({ where: { id: dto.employeeId } });
      if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    }
    if (dto.categoryId) {
      const category = await this.prisma.client.documentCategory.findFirst({ where: { id: dto.categoryId } });
      if (!category) throw new NotFoundError('Document category', 'CATEGORY_NOT_FOUND');
    }

    const documentId = randomUUID();
    const tenantId = this.prisma.currentTenantIdOrThrow();
    const storageKey = `${tenantId}/${documentId}/v1/${sanitizeFileName(file.originalname)}`;
    const stored = await this.storage.put(storageKey, file.buffer, { contentType: file.mimetype });

    const document = await this.prisma.transaction(async (tx) => {
      const created = await tx.document.create({
        data: tenantScoped({
          id: documentId,
          name: dto.name,
          description: dto.description,
          employeeId: dto.employeeId,
          categoryId: dto.categoryId,
          confidentiality: dto.confidentiality ?? 'INTERNAL',
          issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          uploadedById: principal.userId,
        }),
      });

      const version = await tx.documentVersion.create({
        data: tenantScoped({
          documentId: created.id,
          version: 1,
          storageKey: stored.storageKey,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          uploadedById: principal.userId,
        }),
      });

      return tx.document.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    const category = dto.categoryId
      ? await this.prisma.client.documentCategory.findFirst({ where: { id: dto.categoryId } })
      : null;

    if (dto.employeeId && category?.requiresAcknowledgement) {
      this.events.emit('document.acknowledgement.required', {
        tenantId,
        documentId: document.id,
        employeeId: dto.employeeId,
        documentName: document.name,
      });
    }

    await this.audit.record({
      action: 'document.upload',
      entityType: 'Document',
      entityId: document.id,
      actorUserId: principal.userId,
      after: { name: document.name, fileName: file.originalname, sizeBytes: stored.sizeBytes },
    });
    return { id: document.id, name: document.name };
  }

  async addVersion(principal: Principal, documentId: string, file: UploadedFileLike) {
    this.assertFileAllowed(file);
    const document = await this.prisma.client.document.findFirst({
      where: { id: documentId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!document) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (document.employeeId) await this.scope.assertEmployeeAccess(principal, document.employeeId);

    const nextVersion = (document.versions[0]?.version ?? 0) + 1;
    const tenantId = this.prisma.currentTenantIdOrThrow();
    const storageKey = `${tenantId}/${documentId}/v${nextVersion}/${sanitizeFileName(file.originalname)}`;
    const stored = await this.storage.put(storageKey, file.buffer, { contentType: file.mimetype });

    const version = await this.prisma.transaction(async (tx) => {
      const created = await tx.documentVersion.create({
        data: tenantScoped({
          documentId,
          version: nextVersion,
          storageKey: stored.storageKey,
          fileName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          uploadedById: principal.userId,
        }),
      });
      await tx.document.update({ where: { id: documentId }, data: { currentVersionId: created.id } });
      return created;
    });

    await this.audit.record({
      action: 'document.version.add',
      entityType: 'DocumentVersion',
      entityId: version.id,
      actorUserId: principal.userId,
      after: { documentId, version: nextVersion, fileName: file.originalname },
    });
    return { id: version.id, version: nextVersion };
  }

  async update(principal: Principal, id: string, dto: UpdateDocumentDto) {
    const before = await this.prisma.client.document.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (before.employeeId) await this.scope.assertEmployeeAccess(principal, before.employeeId);

    const updated = await this.prisma.client.document.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        categoryId: dto.categoryId,
        confidentiality: dto.confidentiality,
        status: dto.status,
        issuedAt: dto.issuedAt === undefined ? undefined : dto.issuedAt ? new Date(dto.issuedAt) : null,
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    await this.audit.record({
      action: 'document.update',
      entityType: 'Document',
      entityId: id,
      actorUserId: principal.userId,
      before,
      after: updated,
    });
    return updated;
  }

  /** Download link: presigned URL for S3, API route (authorized) for local storage. */
  async download(principal: Principal, id: string, version?: number) {
    const document = await this.prisma.client.document.findFirst({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!document) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (document.employeeId) await this.scope.assertEmployeeAccess(principal, document.employeeId);

    const target =
      version !== undefined
        ? document.versions.find((entry) => entry.version === version)
        : (document.versions.find((entry) => entry.id === document.currentVersionId) ?? document.versions[0]);
    if (!target) throw new NotFoundError('Document version', 'VERSION_NOT_FOUND');

    await this.audit.record({
      action: 'document.download',
      entityType: 'Document',
      entityId: id,
      actorUserId: principal.userId,
      metadata: { version: target.version, driver: this.storage.driver },
    });

    return {
      url: await this.storage.signedUrl(target.storageKey),
      fileName: target.fileName,
      mimeType: target.mimeType,
      sizeBytes: target.sizeBytes,
      version: target.version,
      driver: this.storage.driver,
      checksum: target.checksum,
      etag: createHash('sha1').update(`${target.storageKey}:${target.version}`).digest('hex'),
    };
  }

  /** Streams bytes for the local storage driver (S3 uses presigned URLs). */
  async readBytes(storageKey: string): Promise<{ data: Buffer; fileName: string }> {
    const file = await this.storage.get(storageKey);
    return { data: file.data, fileName: basename(storageKey) };
  }

  async acknowledge(principal: Principal, id: string, ip?: string, signature?: string) {
    const employeeId = principal.employeeId;
    if (!employeeId) throw new ValidationError('Your user is not linked to an employee record');

    const document = await this.prisma.client.document.findFirst({ where: { id } });
    if (!document) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (document.employeeId && document.employeeId !== employeeId) {
      throw new ForbiddenError('This document is not assigned to you', 'NOT_DOCUMENT_OWNER');
    }
    if (!document.currentVersionId) throw new ConflictError('Document has no content to acknowledge', 'DOCUMENT_EMPTY');

    const existing = await this.prisma.client.documentAcknowledgment.findFirst({
      where: { documentId: id, employeeId },
    });
    if (existing) throw new ConflictError('Document already acknowledged', 'ALREADY_ACKNOWLEDGED');

    const acknowledgment = await this.prisma.client.documentAcknowledgment.create({
      data: tenantScoped({
        documentId: id,
        versionId: document.currentVersionId,
        employeeId,
        ip,
        signature,
      }),
    });

    await this.audit.record({
      action: 'document.acknowledge',
      entityType: 'DocumentAcknowledgment',
      entityId: acknowledgment.id,
      actorUserId: principal.userId,
      metadata: { documentId: id, ip },
    });
    return { acknowledged: true, acknowledgedAt: acknowledgment.acknowledgedAt.toISOString() };
  }

  async remove(principal: Principal, id: string) {
    const document = await this.prisma.client.document.findFirst({ where: { id } });
    if (!document) throw new NotFoundError('Document', 'DOCUMENT_NOT_FOUND');
    if (document.employeeId) await this.scope.assertEmployeeAccess(principal, document.employeeId);

    await this.prisma.client.document.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
    await this.audit.record({
      action: 'document.delete',
      entityType: 'Document',
      entityId: id,
      actorUserId: principal.userId,
      before: document,
    });
    return { deleted: true };
  }

  /** Used by the reminder scheduler. */
  async expiring(tenantId: string, days = 30) {
    return this.prisma.forTenant(tenantId, (db) =>
      db.document.findMany({
        where: { status: 'ACTIVE', expiresAt: { not: null, lte: new Date(Date.now() + days * 86_400_000) } },
        include: { employee: { select: { id: true, firstName: true, lastName: true, userId: true } }, category: true },
        orderBy: { expiresAt: 'asc' },
      }),
    );
  }

  async listCategories() {
    return this.prisma.client.documentCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(principal: Principal, dto: CreateCategoryDto) {
    const category = await this.prisma.client.documentCategory.create({
      data: tenantScoped({
        key: dto.key.toUpperCase(),
        name: dto.name,
        description: dto.description,
        requiresAcknowledgement: dto.requiresAcknowledgement ?? false,
        requiresExpiry: dto.requiresExpiry ?? false,
        defaultRetentionDays: dto.defaultRetentionDays,
      }),
    });
    await this.audit.record({
      action: 'documentCategory.create',
      entityType: 'DocumentCategory',
      entityId: category.id,
      actorUserId: principal.userId,
      after: category,
    });
    return category;
  }

  private assertFileAllowed(file: UploadedFileLike): void {
    if (!file?.buffer?.length) throw new ValidationError('A file is required');
    if (file.size > MAX_FILE_BYTES || file.buffer.byteLength > MAX_FILE_BYTES) {
      throw new ValidationError('File exceeds the 25 MB limit');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new StorageError(`Unsupported file type "${file.mimetype}"`, 'UNSUPPORTED_MEDIA_TYPE');
    }
  }
}

function sanitizeFileName(name: string): string {
  const extension = extname(name).slice(0, 12);
  const base = basename(name, extname(name))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 80);
  return `${base || 'file'}${extension.toLowerCase()}`;
}
