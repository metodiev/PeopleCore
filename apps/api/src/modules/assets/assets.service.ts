import { Injectable } from '@nestjs/common';
import type { Paginated, Principal } from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import { buildQueryOptions, paginate } from '../../common/utils/pagination.util.js';
import { tenantScoped } from '../../prisma/tenant-context.util.js';
import { AuditService } from '../audit/audit.service.js';
import { ScopeService } from '../employees/scope.service.js';
import type {
  AssetQueryDto,
  AssetServiceActionDto,
  AssignAssetDto,
  CreateAssetDto,
  ReturnAssetDto,
  UpdateAssetDto,
} from './dto/assets.dto.js';

const SORTABLE = ['createdAt', 'name', 'category', 'status', 'purchaseDate', 'warrantyEndDate'] as const;

/** Assets whose warranty ends inside this window are flagged for renewal. */
export const WARRANTY_WARNING_DAYS = 60;

/**
 * Company assets (laptops, phones, cars, licences…): the inventory, the
 * assign → return lifecycle with a full assignment history, repair and
 * retirement, plus warranty monitoring.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Inventory ─────────────────────────────────────────────────────────────

  async list(query: AssetQueryDto): Promise<Paginated<unknown>> {
    const { skip, take, orderBy } = buildQueryOptions(query, SORTABLE, { createdAt: 'desc' });
    const where: Record<string, unknown> = {};
    if (query.assignedToId) where['assignedToId'] = query.assignedToId;
    if (query.status) where['status'] = query.status;
    if (query.category) where['category'] = query.category;
    if (query.locationId) where['locationId'] = query.locationId;
    if (query.warrantyEndingWithinDays) {
      where['warrantyEndDate'] = { not: null, lte: new Date(Date.now() + query.warrantyEndingWithinDays * 86_400_000) };
    }
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { serialNumber: { contains: query.search, mode: 'insensitive' } },
        { vendor: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.asset.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          assignedTo: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
          location: { select: { id: true, name: true } },
        },
      }),
      this.prisma.client.asset.count({ where }),
    ]);
    return paginate(rows.map((row) => this.serializeAsset(row)), total, query);
  }

  async get(principal: Principal, id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
        location: { select: { id: true, name: true } },
        assignments: {
          orderBy: { assignedAt: 'desc' },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
          },
        },
      },
    });
    if (!asset) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    await this.assertAssetRead(principal, asset);
    return this.serializeAsset(asset);
  }

  async create(principal: Principal, dto: CreateAssetDto) {
    await this.assertSerialAvailable(dto.serialNumber);
    if (dto.status === 'ASSIGNED') throw new ValidationError('Use the assign endpoint to hand an asset to an employee');

    const asset = await this.prisma.client.asset.create({
      data: tenantScoped({
        category: dto.category,
        name: dto.name,
        description: dto.description,
        serialNumber: dto.serialNumber,
        vendor: dto.vendor,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
        purchaseCost: dto.purchaseCost,
        currency: dto.currency?.toUpperCase(),
        warrantyEndDate: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : null,
        condition: dto.condition ?? 'NEW',
        status: dto.status ?? 'AVAILABLE',
        locationId: dto.locationId,
        notes: dto.notes,
      }),
    });
    await this.audit.record({
      action: 'asset.create',
      entityType: 'Asset',
      entityId: asset.id,
      actorUserId: principal.userId,
      after: { name: asset.name, category: asset.category, serialNumber: asset.serialNumber },
    });
    return this.serializeAsset(asset);
  }

  async update(principal: Principal, id: string, dto: UpdateAssetDto) {
    const before = await this.prisma.client.asset.findFirst({ where: { id } });
    if (!before) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    if (dto.serialNumber && dto.serialNumber !== before.serialNumber) await this.assertSerialAvailable(dto.serialNumber);
    if (dto.status === 'ASSIGNED' || dto.status === 'AVAILABLE') {
      throw new ValidationError('Assignment status is managed by assign / return', { code: 'ASSET_STATUS_MANAGED' });
    }

    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: {
        category: dto.category,
        name: dto.name,
        description: dto.description,
        serialNumber: dto.serialNumber,
        vendor: dto.vendor,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        purchaseCost: dto.purchaseCost,
        currency: dto.currency ? dto.currency.toUpperCase() : undefined,
        warrantyEndDate: dto.warrantyEndDate ? new Date(dto.warrantyEndDate) : undefined,
        condition: dto.condition,
        status: dto.status,
        locationId: dto.locationId,
        notes: dto.notes,
      },
    });
    await this.audit.record({
      action: 'asset.update',
      entityType: 'Asset',
      entityId: id,
      actorUserId: principal.userId,
      before: { name: before.name, status: before.status, condition: before.condition },
      after: { name: updated.name, status: updated.status, condition: updated.condition },
    });
    return this.serializeAsset(updated);
  }

  /** Soft delete — assignment history is kept for audits. */
  async remove(principal: Principal, id: string) {
    const asset = await this.prisma.client.asset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    if (asset.status === 'ASSIGNED') throw new ConflictError('Return the asset before deleting it', 'ASSET_ASSIGNED');

    await this.prisma.client.asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'asset.delete',
      entityType: 'Asset',
      entityId: id,
      actorUserId: principal.userId,
      before: { name: asset.name, serialNumber: asset.serialNumber },
    });
    return { deleted: true };
  }

  // ── Assignment lifecycle ──────────────────────────────────────────────────

  async assign(principal: Principal, id: string, dto: AssignAssetDto) {
    const asset = await this.prisma.client.asset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    if (asset.status === 'RETIRED' || asset.status === 'LOST') {
      throw new ConflictError(`A ${asset.status.toLowerCase()} asset cannot be assigned`, 'ASSET_NOT_ASSIGNABLE');
    }
    if (asset.status === 'ASSIGNED') {
      throw new ConflictError('This asset is already assigned — return it first', 'ASSET_ALREADY_ASSIGNED');
    }
    if (asset.status === 'IN_REPAIR') throw new ConflictError('This asset is in repair', 'ASSET_IN_REPAIR');

    const employee = await this.prisma.client.employee.findFirst({
      where: { id: dto.employeeId },
      select: { id: true, firstName: true, lastName: true, status: true },
    });
    if (!employee) throw new NotFoundError('Employee', 'EMPLOYEE_NOT_FOUND');
    if (employee.status === 'TERMINATED') throw new ValidationError('Assets cannot be assigned to terminated employees');
    await this.scope.assertEmployeeAccess(principal, employee.id);

    const assignedAt = new Date();
    const assetUpdated = await this.prisma.transaction(async (tx) => {
      await tx.assetAssignment.create({
        data: tenantScoped({
          assetId: id,
          employeeId: dto.employeeId,
          assignedAt,
          conditionAtAssign: dto.condition ?? asset.condition,
          notes: dto.notes,
          assignedById: principal.userId,
        }),
      });
      return tx.asset.update({
        where: { id },
        data: {
          status: 'ASSIGNED',
          assignedToId: dto.employeeId,
          assignedAt,
          returnedAt: null,
          condition: dto.condition ?? asset.condition,
        },
        include: { assignedTo: { select: { id: true, firstName: true, lastName: true } } },
      });
    });

    await this.audit.record({
      action: 'asset.assign',
      entityType: 'Asset',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: asset.status, assignedToId: asset.assignedToId },
      after: { status: assetUpdated.status, assignedToId: assetUpdated.assignedToId, condition: assetUpdated.condition },
    });
    return this.serializeAsset(assetUpdated);
  }

  async returnAsset(principal: Principal, id: string, dto: ReturnAssetDto) {
    const asset = await this.prisma.client.asset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    if (asset.status !== 'ASSIGNED' || !asset.assignedToId) {
      throw new ConflictError('This asset is not currently assigned', 'ASSET_NOT_ASSIGNED');
    }

    const openAssignment = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId: id, employeeId: asset.assignedToId, returnedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    if (!openAssignment) throw new NotFoundError('Open asset assignment', 'ASSET_ASSIGNMENT_NOT_FOUND');

    const returnedAt = new Date();
    const assetUpdated = await this.prisma.transaction(async (tx) => {
      await tx.assetAssignment.update({
        where: { id: openAssignment.id },
        data: { returnedAt, conditionAtReturn: dto.condition ?? undefined, notes: dto.notes ?? openAssignment.notes },
      });
      return tx.asset.update({
        where: { id },
        data: {
          status: 'AVAILABLE',
          assignedToId: null,
          returnedAt,
          condition: dto.condition ?? asset.condition,
        },
      });
    });

    await this.audit.record({
      action: 'asset.return',
      entityType: 'Asset',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: asset.status, assignedToId: asset.assignedToId, condition: asset.condition },
      after: { status: assetUpdated.status, assignedToId: assetUpdated.assignedToId, condition: assetUpdated.condition },
    });
    return this.serializeAsset(assetUpdated);
  }

  async repair(principal: Principal, id: string, dto: AssetServiceActionDto) {
    return this.changeServiceStatus(principal, id, 'IN_REPAIR', 'asset.repair', dto);
  }

  async retire(principal: Principal, id: string, dto: AssetServiceActionDto) {
    return this.changeServiceStatus(principal, id, 'RETIRED', 'asset.retire', dto);
  }

  // ── Self-service & dashboard ──────────────────────────────────────────────

  /** Assets held by an employee: their own under `assets.self.view`, others under `assets.view`. */
  async listEmployeeAssets(principal: Principal, employeeId: string) {
    if (employeeId !== principal.employeeId) {
      if (!principal.isSuperAdmin && !principal.permissions.includes('assets.view')) {
        throw new ForbiddenError('You can only view your own assets', 'ASSET_SCOPE_DENIED');
      }
      await this.scope.assertEmployeeAccess(principal, employeeId);
    }

    const [current, history] = await Promise.all([
      this.prisma.client.asset.findMany({
        where: { assignedToId: employeeId },
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.client.assetAssignment.findMany({
        where: { employeeId },
        orderBy: { assignedAt: 'desc' },
        include: { asset: { select: { id: true, name: true, category: true, serialNumber: true } } },
      }),
    ]);

    return {
      employeeId,
      current: current.map((asset) => this.serializeAsset(asset)),
      history,
    };
  }

  async dashboard(principal: Principal) {
    const today = new Date();
    const employeeScope = await this.scope.employeeWhere(principal);
    const scoped = this.canSeeEverything(principal) ? {} : { assignedTo: employeeScope };

    const [byStatus, byCategory, warrantyExpiring, assigned, total] = await Promise.all([
      this.prisma.client.asset.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.asset.groupBy({ by: ['category'], _count: { _all: true } }),
      this.prisma.client.asset.findMany({
        where: {
          warrantyEndDate: { not: null, lte: new Date(today.getTime() + WARRANTY_WARNING_DAYS * 86_400_000) },
        },
        orderBy: { warrantyEndDate: 'asc' },
        take: 50,
        select: {
          id: true,
          name: true,
          category: true,
          serialNumber: true,
          warrantyEndDate: true,
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.client.asset.count({ where: { ...scoped, status: 'ASSIGNED' } }),
      this.prisma.client.asset.count({ where: scoped }),
    ]);

    const status: Record<string, number> = {};
    for (const group of byStatus) status[group.status] = group._count._all;
    const category: Record<string, number> = {};
    for (const group of byCategory) category[group.category] = group._count._all;

    return {
      total,
      assigned,
      available: status['AVAILABLE'] ?? 0,
      byStatus: status,
      byCategory: category,
      warrantyExpiringWithinDays: WARRANTY_WARNING_DAYS,
      warrantyExpiring: warrantyExpiring.map((asset) => ({
        ...asset,
        warrantyEndDate: asset.warrantyEndDate?.toISOString().slice(0, 10) ?? null,
        isOutOfWarranty: asset.warrantyEndDate !== null && asset.warrantyEndDate < today,
      })),
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async changeServiceStatus(
    principal: Principal,
    id: string,
    status: 'IN_REPAIR' | 'RETIRED',
    action: string,
    dto: AssetServiceActionDto,
  ) {
    const asset = await this.prisma.client.asset.findFirst({ where: { id } });
    if (!asset) throw new NotFoundError('Asset', 'ASSET_NOT_FOUND');
    if (asset.status === status) return this.serializeAsset(asset);

    const closeAssignment = dto.unassign && asset.status === 'ASSIGNED' && asset.assignedToId;
    const openAssignment = closeAssignment
      ? await this.prisma.client.assetAssignment.findFirst({
          where: { assetId: id, employeeId: asset.assignedToId!, returnedAt: null },
          orderBy: { assignedAt: 'desc' },
        })
      : null;

    const updated = await this.prisma.transaction(async (tx) => {
      if (openAssignment) {
        await tx.assetAssignment.update({
          where: { id: openAssignment.id },
          data: { returnedAt: new Date(), conditionAtReturn: dto.condition ?? asset.condition, notes: dto.notes ?? openAssignment.notes },
        });
      }
      return tx.asset.update({
        where: { id },
        data: {
          status,
          condition: dto.condition ?? asset.condition,
          notes: dto.notes ?? asset.notes,
          ...(closeAssignment ? { assignedToId: null, returnedAt: new Date() } : {}),
        },
      });
    });

    await this.audit.record({
      action,
      entityType: 'Asset',
      entityId: id,
      actorUserId: principal.userId,
      before: { status: asset.status, assignedToId: asset.assignedToId },
      after: { status: updated.status, assignedToId: updated.assignedToId, reason: dto.reason },
    });
    return this.serializeAsset(updated);
  }

  private async assertSerialAvailable(serialNumber?: string | null): Promise<void> {
    if (!serialNumber) return;
    const existing = await this.prisma.client.asset.findFirst({ where: { serialNumber } });
    if (existing) throw new ConflictError(`An asset with serial number "${serialNumber}" already exists`, 'ASSET_SERIAL_TAKEN');
  }

  private async assertAssetRead(
    principal: Principal,
    asset: { assignedToId: string | null },
  ): Promise<void> {
    if (this.canSeeEverything(principal) || principal.permissions.includes('assets.view')) return;
    if (asset.assignedToId && asset.assignedToId === principal.employeeId) return;
    throw new ForbiddenError('You do not have access to this asset', 'ASSET_SCOPE_DENIED');
  }

  private canSeeEverything(principal: Principal): boolean {
    return (
      principal.isSuperAdmin ||
      principal.permissions.includes('assets.manage') ||
      principal.permissions.includes('employees.sensitive.view')
    );
  }

  private serializeAsset<T extends { purchaseCost?: unknown; purchaseDate?: Date | null; warrantyEndDate?: Date | null }>(
    asset: T,
  ) {
    const today = new Date();
    return {
      ...asset,
      purchaseCost: asset.purchaseCost === null || asset.purchaseCost === undefined ? null : Number(asset.purchaseCost),
      purchaseDate: asset.purchaseDate,
      warrantyEndDate: asset.warrantyEndDate,
      isOutOfWarranty: asset.warrantyEndDate != null && asset.warrantyEndDate < today,
    };
  }
}
