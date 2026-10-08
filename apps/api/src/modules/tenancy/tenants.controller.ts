import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { SuperAdminOnly } from '../../common/decorators/super-admin.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { TenantsService } from './tenants.service.js';
import {
  CreateTenantDto,
  UpdatePrivacySettingsDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
} from './dto/tenancy.dto.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('tenants/current')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Current company profile and workspace settings' })
  current(@CurrentPrincipal() principal: Principal) {
    return this.tenants.getCurrent(principal.tenantId!);
  }

  @Patch('tenants/current')
  @RequirePermissions('settings.manage')
  @Audited('Tenant')
  @ApiOperation({ summary: 'Update company profile' })
  update(@CurrentPrincipal() principal: Principal, @Body() dto: UpdateTenantDto) {
    return this.tenants.updateCurrent(principal.tenantId!, dto, principal.userId);
  }

  @Get('tenants/current/overview')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Company overview counters for the admin dashboard' })
  overview(@CurrentPrincipal() principal: Principal) {
    return this.tenants.overview(principal.tenantId!);
  }

  @Get('tenants/current/privacy')
  @RequirePermissions('gdpr.view')
  @ApiOperation({ summary: 'Company-level privacy / data-processing settings' })
  privacy(@CurrentPrincipal() principal: Principal) {
    return this.tenants.getCurrent(principal.tenantId!);
  }

  @Patch('tenants/current/privacy')
  @RequirePermissions('gdpr.manage')
  @Audited('TenantPrivacySettings')
  @ApiOperation({ summary: 'Update privacy / data-processing settings' })
  updatePrivacy(@CurrentPrincipal() principal: Principal, @Body() dto: UpdatePrivacySettingsDto) {
    return this.tenants.updatePrivacySettings(principal.tenantId!, dto, principal.userId);
  }

  @Get('platform/tenants')
  @SuperAdminOnly()
  @ApiOperation({ summary: 'List all tenants (platform operator only)' })
  listAll(@Query() query: PaginationQueryDto) {
    return this.tenants.listAll(query);
  }

  @Post('platform/tenants')
  @SuperAdminOnly()
  @Audited('Tenant')
  @ApiOperation({ summary: 'Create a tenant and provision its baseline configuration' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateTenantDto) {
    return this.tenants.createTenant(dto, principal.userId);
  }

  @Patch('platform/tenants/:id/status')
  @SuperAdminOnly()
  @Audited('Tenant')
  @ApiOperation({ summary: 'Activate, suspend or cancel a tenant' })
  setStatus(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenants.setStatus(id, dto.status, principal.userId);
  }
}
