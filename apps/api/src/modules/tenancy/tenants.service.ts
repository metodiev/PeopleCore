import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConflictError, NotFoundError } from '../../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import type { CreateTenantDto, UpdatePrivacySettingsDto, UpdateTenantDto } from './dto/tenancy.dto.js';
import { paginate, type PaginationInput } from '../../common/utils/pagination.util.js';
import type { TenantStatus } from '@peoplecore/shared';

/**
 * Company (tenant) management: workspace settings, privacy/GDPR configuration
 * and platform-level tenant administration.
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioningService,
  ) {}

  async getCurrent(tenantId: string) {
    const tenant = await this.prisma.client.tenant.findFirst({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Company', 'TENANT_NOT_FOUND');
    const privacy = await this.prisma.client.tenantPrivacySettings.findUnique({ where: { tenantId } });
    return { ...tenant, privacy };
  }

  async updateCurrent(tenantId: string, dto: UpdateTenantDto, actorUserId: string) {
    const before = await this.prisma.client.tenant.findFirst({ where: { id: tenantId } });
    if (!before) throw new NotFoundError('Company', 'TENANT_NOT_FOUND');

    const updated = await this.prisma.client.tenant.update({ where: { id: tenantId }, data: { ...dto } });
    await this.audit.record({
      action: 'tenant.update',
      entityType: 'Tenant',
      entityId: tenantId,
      actorUserId,
      before,
      after: updated,
      tenantId,
    });
    return updated;
  }

  async updatePrivacySettings(tenantId: string, dto: UpdatePrivacySettingsDto, actorUserId: string) {
    const before = await this.prisma.client.tenantPrivacySettings.findUnique({ where: { tenantId } });
    const updated = await this.prisma.client.tenantPrivacySettings.upsert({
      where: { tenantId },
      create: { tenantId, ...dto, updatedById: actorUserId },
      update: { ...dto, updatedById: actorUserId },
    });
    await this.audit.record({
      action: 'tenant.privacy.update',
      entityType: 'TenantPrivacySettings',
      entityId: updated.id,
      actorUserId,
      before,
      after: updated,
      tenantId,
    });
    return updated;
  }

  /** Headline numbers for the Company Admin dashboard. */
  async overview(tenantId: string) {
    const [users, employees, activeEmployees, departments, locations, teams, pendingInvites] = await Promise.all([
      this.prisma.client.user.count(),
      this.prisma.client.employee.count(),
      this.prisma.client.employee.count({ where: { status: { in: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] } } }),
      this.prisma.client.department.count(),
      this.prisma.client.location.count(),
      this.prisma.client.team.count(),
      this.prisma.client.userInvitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);

    const usersByRole = await this.prisma.client.userRole.groupBy({ by: ['roleId'], _count: { userId: true } });
    const roles = await this.prisma.client.role.findMany({ where: { tenantId }, select: { id: true, key: true, name: true } });
    const roleNameById = new Map(roles.map((role) => [role.id, role]));

    return {
      users,
      employees,
      activeEmployees,
      departments,
      locations,
      teams,
      pendingInvites,
      usersByRole: usersByRole.map((entry) => ({
        role: roleNameById.get(entry.roleId)?.name ?? 'Unknown',
        roleKey: roleNameById.get(entry.roleId)?.key ?? 'UNKNOWN',
        count: entry._count.userId,
      })),
    };
  }

  // ── Platform administration (super admin) ─────────────────────────────────

  async listAll(query: PaginationInput & { status?: TenantStatus; search?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status) where['status'] = query.status;
    if (query.search) {
      where['OR'] = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    const [rows, total] = await Promise.all([
      this.prisma.raw.tenant.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { employees: true, users: true } } },
      }),
      this.prisma.raw.tenant.count({ where: { ...where, deletedAt: null } }),
    ]);

    return paginate(
      rows.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        plan: tenant.plan,
        locale: tenant.locale,
        timezone: tenant.timezone,
        createdAt: tenant.createdAt.toISOString(),
        employees: tenant._count.employees,
        users: tenant._count.users,
      })),
      total,
      { page, pageSize },
    );
  }

  async createTenant(dto: CreateTenantDto, actorUserId: string) {
    const existing = await this.prisma.raw.tenant.findFirst({ where: { slug: dto.slug } });
    if (existing) throw new ConflictError(`Company slug "${dto.slug}" is already taken`, 'TENANT_SLUG_TAKEN');

    const tenant = await this.prisma.raw.tenant.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        plan: dto.plan ?? 'STARTER',
        status: dto.status ?? 'TRIAL',
        locale: dto.locale ?? 'bg',
        timezone: dto.timezone ?? 'Europe/Sofia',
        currency: dto.currency ?? 'EUR',
      },
    });
    await this.provisioning.provision(tenant.id, tenant.locale);
    await this.audit.record({
      action: 'platform.tenant.create',
      entityType: 'Tenant',
      entityId: tenant.id,
      actorUserId,
      after: tenant,
      tenantId: tenant.id,
      actorType: 'USER',
    });
    return tenant;
  }

  async setStatus(tenantId: string, status: TenantStatus, actorUserId: string) {
    const tenant = await this.prisma.raw.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundError('Company', 'TENANT_NOT_FOUND');
    const updated = await this.prisma.raw.tenant.update({ where: { id: tenantId }, data: { status } });
    await this.audit.record({
      action: 'platform.tenant.status',
      entityType: 'Tenant',
      entityId: tenantId,
      actorUserId,
      before: { status: tenant.status },
      after: { status: updated.status },
      tenantId,
    });
    return updated;
  }
}
