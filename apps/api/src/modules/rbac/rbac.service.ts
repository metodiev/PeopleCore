import { Injectable, Logger } from '@nestjs/common';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  ROLE_DEFINITIONS,
  TENANT_PERMISSION_KEYS,
  isPermissionKey,
  type PermissionKey,
} from '@peoplecore/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { runWithTenantContext } from '../../prisma/request-context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error.js';
import type { PrismaTransaction } from '../../prisma/prisma.service.js';

export interface RoleSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  platformLevel: boolean;
  permissions: string[];
  userCount: number;
}

/**
 * Role-based access control. The permission catalog lives in
 * `@peoplecore/shared` (single source of truth for API + clients) and is
 * mirrored into the database so tenants can build custom roles on top of the
 * eight system roles.
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Upserts all catalog permissions. Safe to run on every boot. */
  async syncPermissionCatalog(): Promise<number> {
    await this.prisma.raw.$transaction(
      PERMISSION_CATALOG.map((permission) =>
        this.prisma.raw.permission.upsert({
          where: { key: permission.key },
          create: { key: permission.key, module: permission.module, description: permission.description },
          update: { module: permission.module, description: permission.description },
        }),
      ),
    );
    return PERMISSION_CATALOG.length;
  }

  /**
   * Creates the eight system roles for a tenant (idempotent). Used on tenant
   * creation and re-run on boot to pick up permission additions.
   */
  async ensureTenantRoles(
    tenantId: string,
    client?: PrismaTransaction | PrismaService['client'],
  ): Promise<void> {
    await runWithTenantContext(tenantId, () => this.ensureTenantRolesInternal(tenantId, client));
  }

  private async ensureTenantRolesInternal(
    tenantId: string,
    client: PrismaTransaction | PrismaService['client'] = this.prisma.client,
  ): Promise<void> {
    const permissions = await this.prisma.raw.permission.findMany();
    const permissionIdByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));

    if (permissionIdByKey.size < PERMISSION_CATALOG.length) {
      await this.syncPermissionCatalog();
      const refreshed = await this.prisma.raw.permission.findMany();
      permissionIdByKey.clear();
      for (const permission of refreshed) permissionIdByKey.set(permission.key, permission.id);
    }

    for (const definition of ROLE_DEFINITIONS) {
      if (definition.platformLevel) continue; // platform roles are global, not per tenant
      const role = await client.role.upsert({
        where: { tenantId_key: { tenantId, key: definition.key } },
        create: {
          tenantId,
          key: definition.key,
          name: definition.name,
          description: definition.description,
          isSystem: true,
          platformLevel: false,
        },
        update: { name: definition.name, description: definition.description },
      });

      const desired = new Set(definition.permissions as readonly PermissionKey[]);
      const current = await client.rolePermission.findMany({ where: { roleId: role.id } });
      const currentKeys = new Set(
        current
          .map((rp) => [...permissionIdByKey.entries()].find(([, id]) => id === rp.permissionId)?.[0])
          .filter((key): key is string => Boolean(key)),
      );

      const toAdd = [...desired].filter((key) => !currentKeys.has(key) && permissionIdByKey.has(key));
      const toRemove = current.filter((rp) => {
        const key = [...permissionIdByKey.entries()].find(([, id]) => id === rp.permissionId)?.[0];
        return key !== undefined && !desired.has(key as PermissionKey);
      });

      if (toAdd.length > 0) {
        await client.rolePermission.createMany({
          data: toAdd.map((key) => ({ roleId: role.id, permissionId: permissionIdByKey.get(key)! })),
          skipDuplicates: true,
        });
      }
      if (toRemove.length > 0) {
        await client.rolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { in: toRemove.map((rp) => rp.permissionId) } },
        });
      }
    }
  }

  /** Ensures every tenant in the database has up-to-date system roles. */
  async syncAllTenants(): Promise<void> {
    const tenants = await this.prisma.raw.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const tenant of tenants) {
      await this.ensureTenantRoles(tenant.id);
    }
    this.logger.log(`Synchronized system roles for ${tenants.length} tenant(s)`);
  }

  async listRoles(tenantId: string): Promise<RoleSummary[]> {
    const roles = await runWithTenantContext(tenantId, () =>
      this.prisma.client.role.findMany({
        where: { OR: [{ tenantId }, { platformLevel: true, tenantId: null }] },
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { users: true } },
        },
        orderBy: [{ platformLevel: 'desc' }, { name: 'asc' }],
      }),
    );

    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      platformLevel: role.platformLevel,
      permissions: role.permissions.map((rp) => rp.permission.key).sort(),
      userCount: role._count.users,
    }));
  }

  async createCustomRole(
    tenantId: string,
    input: { key: string; name: string; description?: string; permissions?: string[] },
  ): Promise<RoleSummary> {
    const key = input.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (ROLE_DEFINITIONS.some((definition) => definition.key === key)) {
      throw new ConflictError(`"${key}" is a system role key`, 'ROLE_KEY_RESERVED');
    }
    const permissions = this.validatePermissions(input.permissions ?? [], tenantId);

    const role = await runWithTenantContext(tenantId, () =>
      this.prisma.client.role.create({
        data: {
          tenantId,
          key,
          name: input.name,
          description: input.description,
          isSystem: false,
          platformLevel: false,
        },
      }),
    );
    await this.setRolePermissions(tenantId, role.id, permissions);
    const [summary] = await this.listRoles(tenantId).then((roles) => roles.filter((r) => r.id === role.id));
    return summary!;
  }

  async updateRole(
    tenantId: string,
    roleId: string,
    input: { name?: string; description?: string; permissions?: string[] },
  ): Promise<RoleSummary> {
    const role = await runWithTenantContext(tenantId, () =>
      this.prisma.client.role.findFirst({ where: { id: roleId, tenantId } }),
    );
    if (!role) throw new NotFoundError('Role', 'ROLE_NOT_FOUND');

    if (input.name || input.description !== undefined) {
      await runWithTenantContext(tenantId, () =>
        this.prisma.client.role.update({
        where: { id: roleId },
          data: { name: input.name ?? undefined, description: input.description ?? undefined },
        }),
      );
    }

    if (input.permissions && !role.isSystem) {
      // Custom roles are fully editable.
      await this.setRolePermissions(tenantId, roleId, this.validatePermissions(input.permissions, tenantId));
    } else if (input.permissions && role.isSystem) {
      // System roles: only additive changes are allowed, so upgrades from the
      // product team can never be silently removed.
      if (role.key === 'COMPANY_ADMIN' || role.key === 'SUPER_ADMIN') {
        throw new ConflictError('This role always holds every permission', 'ROLE_IMMUTABLE');
      }
      const requested = this.validatePermissions(input.permissions, tenantId);
      const definition = ROLE_DEFINITIONS.find((entry) => entry.key === role.key);
      const baseline = new Set<string>(definition?.permissions ?? []);
      const removed = requested.filter((permission) => !baseline.has(permission));
      if (removed.length > 0) {
        throw new ConflictError(
          `System roles cannot drop permissions that ship with the product: ${removed.join(', ')}`,
          'ROLE_SYSTEM_RESTRICTED',
        );
      }
      await this.setRolePermissions(tenantId, roleId, requested);
    }

    const [summary] = await this.listRoles(tenantId).then((roles) => roles.filter((r) => r.id === roleId));
    return summary!;
  }

  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    const role = await runWithTenantContext(tenantId, () =>
      this.prisma.client.role.findFirst({
        where: { id: roleId, tenantId },
        include: { _count: { select: { users: true } } },
      }),
    );
    if (!role) throw new NotFoundError('Role', 'ROLE_NOT_FOUND');
    if (role.isSystem) throw new ConflictError('System roles cannot be deleted', 'ROLE_SYSTEM_IMMUTABLE');
    if (role._count.users > 0) {
      throw new ConflictError('Role is assigned to users — reassign them first', 'ROLE_IN_USE');
    }
    await runWithTenantContext(tenantId, () => this.prisma.client.role.delete({ where: { id: roleId } }));
  }

  /** Replaces the roles of a user. Unknown keys are rejected. */
  async assignRolesToUser(
    tenantId: string,
    userId: string,
    roleKeys: string[],
    grantedById?: string,
  ): Promise<void> {
    const roles = await runWithTenantContext(tenantId, () =>
      this.prisma.client.role.findMany({ where: { tenantId }, select: { id: true, key: true } }),
    );
    const roleByKey = new Map(roles.map((role) => [role.key, role.id]));
    const unknown = roleKeys.filter((key) => !roleByKey.has(key));
    if (unknown.length > 0) throw new ValidationError(`Unknown role(s): ${unknown.join(', ')}`);

    await runWithTenantContext(tenantId, () => this.prisma.transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId } });
      if (roleKeys.length > 0) {
        await tx.userRole.createMany({
          data: roleKeys.map((key) => ({ userId, roleId: roleByKey.get(key)!, grantedById })),
          skipDuplicates: true,
        });
      }
    }));
  }

  async setRolePermissions(tenantId: string, roleId: string, permissionKeys: string[]): Promise<void> {
    const permissions = await this.prisma.raw.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true, key: true },
    });
    const found = new Set(permissions.map((permission) => permission.key));
    const missing = permissionKeys.filter((key) => !found.has(key));
    if (missing.length > 0) throw new ValidationError(`Unknown permission(s): ${missing.join(', ')}`);

    await runWithTenantContext(tenantId, () =>
      this.prisma.transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
            skipDuplicates: true,
          });
        }
      }),
    );
  }

  /** All permission keys, grouped for the permission-matrix UI. */
  permissionCatalog() {
    const modules = new Map<string, { key: string; description: string }[]>();
    for (const permission of PERMISSION_CATALOG) {
      const list = modules.get(permission.module) ?? [];
      list.push({ key: permission.key, description: permission.description });
      modules.set(permission.module, list);
    }
    return [...modules.entries()].map(([module, permissions]) => ({ module, permissions }));
  }

  private validatePermissions(keys: string[], tenantId: string): string[] {
    const invalid = keys.filter((key) => !isPermissionKey(key));
    if (invalid.length > 0) throw new ValidationError(`Unknown permission(s): ${invalid.join(', ')}`);
    const platformPermissions = keys.filter(
      (key) => isPermissionKey(key) && !TENANT_PERMISSION_KEYS.includes(key),
    );
    if (platformPermissions.length > 0) {
      throw new ValidationError(`Platform permissions cannot be granted to tenant roles: ${platformPermissions.join(', ')}`);
    }
    void tenantId;
    return [...new Set(keys)];
  }

  /** Effective permissions for a user (union across roles, super admin gets all). */
  async effectivePermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user) return [];
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) permissions.add(rolePermission.permission.key);
    }
    if (user.isSuperAdmin) for (const key of ALL_PERMISSION_KEYS) permissions.add(key);
    return [...permissions];
  }
}
