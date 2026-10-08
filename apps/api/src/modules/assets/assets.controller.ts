import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { AssetsService } from './assets.service.js';
import {
  AssetQueryDto,
  AssetServiceActionDto,
  AssignAssetDto,
  CreateAssetDto,
  ReturnAssetDto,
  UpdateAssetDto,
} from './dto/assets.dto.js';

@ApiTags('assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @RequirePermissions('assets.view')
  @ApiOperation({ summary: 'Asset inventory (filters: assignedToId, status, category, location, search)' })
  list(@Query() query: AssetQueryDto) {
    return this.assets.list(query);
  }

  @Get('dashboard')
  @RequirePermissions('assets.view')
  @ApiOperation({ summary: 'Assets by status/category plus warranty expiries in the next 60 days' })
  dashboard(@CurrentPrincipal() principal: Principal) {
    return this.assets.dashboard(principal);
  }

  @Get('employee/:employeeId')
  @RequirePermissions('assets.self.view')
  @ApiOperation({ summary: 'Assets currently held by an employee, plus their assignment history' })
  listEmployeeAssets(@CurrentPrincipal() principal: Principal, @Param('employeeId') employeeId: string) {
    return this.assets.listEmployeeAssets(principal, employeeId);
  }

  @Get(':id')
  @RequirePermissions('assets.self.view')
  @ApiOperation({ summary: 'Asset detail with its full assignment history' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.assets.get(principal, id);
  }

  @Post()
  @RequirePermissions('assets.manage')
  @Audited('Asset')
  @ApiOperation({ summary: 'Add an asset to the inventory' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateAssetDto) {
    return this.assets.create(principal, dto);
  }

  @Patch(':id')
  @RequirePermissions('assets.manage')
  @Audited('Asset')
  @ApiOperation({ summary: 'Update an asset' })
  update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(principal, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('assets.manage')
  @Audited('Asset')
  @ApiOperation({ summary: 'Soft-delete an asset (history is preserved)' })
  remove(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.assets.remove(principal, id);
  }

  // Assignment lifecycle ────────────────────────────────────────────────────

  @Post(':id/assign')
  @RequirePermissions('assets.manage')
  @Audited('AssetAssignment')
  @ApiOperation({ summary: 'Hand the asset to an employee (records an AssetAssignment)' })
  assign(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: AssignAssetDto) {
    return this.assets.assign(principal, id, dto);
  }

  @Post(':id/return')
  @RequirePermissions('assets.manage')
  @Audited('AssetAssignment')
  @ApiOperation({ summary: 'Take the asset back (closes the open assignment, records the return condition)' })
  returnAsset(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: ReturnAssetDto) {
    return this.assets.returnAsset(principal, id, dto);
  }

  @Post(':id/repair')
  @RequirePermissions('assets.manage')
  @Audited('Asset')
  @ApiOperation({ summary: 'Send an asset to repair' })
  repair(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: AssetServiceActionDto) {
    return this.assets.repair(principal, id, dto);
  }

  @Post(':id/retire')
  @RequirePermissions('assets.manage')
  @Audited('Asset')
  @ApiOperation({ summary: 'Retire an asset from service' })
  retire(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: AssetServiceActionDto) {
    return this.assets.retire(principal, id, dto);
  }
}
