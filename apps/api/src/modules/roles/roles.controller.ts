import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto.js';

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('permissions')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'Permission catalog grouped by module' })
  permissions() {
    return this.rbac.permissionCatalog();
  }

  @Get('roles')
  @RequirePermissions('roles.view')
  @ApiOperation({ summary: 'List system and custom roles of the company' })
  list(@CurrentPrincipal() principal: Principal) {
    return this.rbac.listRoles(principal.tenantId!);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  @Audited('Role')
  @ApiOperation({ summary: 'Create a custom role' })
  async create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateRoleDto) {
    const role = await this.rbac.createCustomRole(principal.tenantId!, dto);
    await this.audit.record({
      action: 'role.create',
      entityType: 'Role',
      entityId: role.id,
      actorUserId: principal.userId,
      tenantId: principal.tenantId,
      after: { key: role.key, permissions: role.permissions },
    });
    return role;
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.manage')
  @Audited('Role')
  @ApiOperation({ summary: 'Update a role (custom roles can change permissions; system roles only extend)' })
  async update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const before = (await this.rbac.listRoles(principal.tenantId!)).find((role) => role.id === id);
    const role = await this.rbac.updateRole(principal.tenantId!, id, dto);
    await this.audit.record({
      action: 'role.update',
      entityType: 'Role',
      entityId: id,
      actorUserId: principal.userId,
      tenantId: principal.tenantId,
      before: before ? { permissions: before.permissions, name: before.name } : undefined,
      after: { permissions: role.permissions, name: role.name },
    });
    return role;
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.manage')
  @Audited('Role')
  @ApiOperation({ summary: 'Delete a custom role' })
  async remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    await this.rbac.deleteRole(principal.tenantId!, id);
    await this.audit.record({
      action: 'role.delete',
      entityType: 'Role',
      entityId: id,
      actorUserId: principal.userId,
      tenantId: principal.tenantId,
    });
    return { deleted: true };
  }
}
