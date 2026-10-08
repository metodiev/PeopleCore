import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { Employee360Service } from './employee-360.service.js';
import { EmployeeProfileService, PROFILE_RESOURCES, type ProfileResource } from './employee-profile.service.js';
import { EmployeesService } from './employees.service.js';
import { ProfileResourcePipe, validateProfileBody } from './pipes/profile-resource.pipe.js';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
} from './dto/employee.dto.js';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly profile: EmployeeProfileService,
    private readonly employee360: Employee360Service,
  ) {}

  @Get()
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'List employees within the caller’s data scope' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: EmployeeQueryDto) {
    return this.employees.list(principal, query);
  }

  @Get('me')
  @RequirePermissions('employees.self.view')
  @ApiOperation({ summary: 'The caller’s own employee record (when linked)' })
  me(@CurrentPrincipal() principal: Principal) {
    return this.employees.me(principal);
  }

  @Get(':id')
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'Get an employee profile (sensitive fields masked by permission)' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employees.get(principal, id);
  }

  @Get(':id/360')
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'Employee 360 aggregate view' })
  view360(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employee360.build(principal, id);
  }

  @Get(':id/history')
  @RequirePermissions('employees.view')
  @ApiOperation({ summary: 'Employment history (organisational changes)' })
  history(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employees.history(principal, id);
  }

  @Post()
  @RequirePermissions('employees.create')
  @Audited('Employee')
  @ApiOperation({ summary: 'Create an employee (optionally with a login account)' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(principal, dto);
  }

  @Patch(':id')
  @RequirePermissions('employees.edit')
  @Audited('Employee')
  @ApiOperation({ summary: 'Update an employee profile' })
  update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(principal, id, dto);
  }

  @Post(':id/terminate')
  @RequirePermissions('employees.terminate')
  @Audited('Employee')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terminate employment (revokes access, closes contracts and pending leave)' })
  terminate(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: TerminateEmployeeDto) {
    return this.employees.terminate(principal, id, dto);
  }

  // ── Profile sub-resources ─────────────────────────────────────────────────

  @Get(':id/profile/:resource')
  @RequirePermissions('employees.view')
  @ApiParam({ name: 'resource', enum: PROFILE_RESOURCES as unknown as string[] })
  @ApiOperation({ summary: 'List a profile sub-resource (emergency contacts, education, skills, …)' })
  listProfile(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('resource', ProfileResourcePipe) resource: ProfileResource,
  ) {
    return this.profile.list(principal, id, resource);
  }

  @Post(':id/profile/:resource')
  @RequirePermissions('employees.edit')
  @Audited('EmployeeProfile')
  @ApiOperation({ summary: 'Add an item to a profile sub-resource' })
  createProfileItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('resource', ProfileResourcePipe) resource: ProfileResource,
    @Body() body: unknown,
  ) {
    return this.profile.create(principal, id, resource, validateProfileBody(resource, body));
  }

  @Patch(':id/profile/:resource/:itemId')
  @RequirePermissions('employees.edit')
  @Audited('EmployeeProfile')
  @ApiOperation({ summary: 'Update a profile sub-resource item' })
  updateProfileItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('resource', ProfileResourcePipe) resource: ProfileResource,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.profile.update(principal, id, resource, itemId, validateProfileBody(resource, body, { partial: true }));
  }

  @Delete(':id/profile/:resource/:itemId')
  @RequirePermissions('employees.edit')
  @Audited('EmployeeProfile')
  @ApiOperation({ summary: 'Remove a profile sub-resource item' })
  removeProfileItem(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Param('resource', ProfileResourcePipe) resource: ProfileResource,
    @Param('itemId') itemId: string,
  ) {
    return this.profile.remove(principal, id, resource, itemId);
  }
}
