import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { OrgService } from './org.service.js';
import {
  AssignScheduleDto,
  CreateDepartmentDto,
  CreateLocationDto,
  CreatePositionDto,
  CreateTeamDto,
  CreateWorkScheduleDto,
  DepartmentQueryDto,
  LocationQueryDto,
  PositionQueryDto,
  TeamQueryDto,
  UpdateDepartmentDto,
  UpdateLocationDto,
  UpdatePositionDto,
  UpdateTeamDto,
  UpdateWorkScheduleDto,
} from './dto/org.dto.js';

@ApiTags('organization')
@ApiBearerAuth()
@Controller()
export class OrgController {
  constructor(private readonly org: OrgService) {}

  // Departments ─────────────────────────────────────────────────────────────

  @Get('departments')
  @RequirePermissions('departments.view')
  @ApiOperation({ summary: 'List departments with headcount' })
  listDepartments(@Query() query: DepartmentQueryDto) {
    return this.org.listDepartments(query);
  }

  @Get('departments/:id')
  @RequirePermissions('departments.view')
  @ApiOperation({ summary: 'Get a department' })
  getDepartment(@Param('id') id: string) {
    return this.org.getDepartment(id);
  }

  @Post('departments')
  @RequirePermissions('departments.manage')
  @Audited('Department')
  @ApiOperation({ summary: 'Create a department' })
  createDepartment(@CurrentPrincipal() principal: Principal, @Body() dto: CreateDepartmentDto) {
    return this.org.createDepartment(dto, principal.userId);
  }

  @Patch('departments/:id')
  @RequirePermissions('departments.manage')
  @Audited('Department')
  @ApiOperation({ summary: 'Update a department' })
  updateDepartment(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.org.updateDepartment(id, dto, principal.userId);
  }

  @Delete('departments/:id')
  @RequirePermissions('departments.manage')
  @Audited('Department')
  @ApiOperation({ summary: 'Archive a department' })
  deleteDepartment(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.org.deleteDepartment(id, principal.userId);
  }

  // Locations ───────────────────────────────────────────────────────────────

  @Get('locations')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'List office locations (with geofence settings)' })
  listLocations(@Query() query: LocationQueryDto) {
    return this.org.listLocations(query);
  }

  @Post('locations')
  @RequirePermissions('locations.manage')
  @Audited('Location')
  @ApiOperation({ summary: 'Create a location' })
  createLocation(@CurrentPrincipal() principal: Principal, @Body() dto: CreateLocationDto) {
    return this.org.createLocation(dto, principal.userId);
  }

  @Patch('locations/:id')
  @RequirePermissions('locations.manage')
  @Audited('Location')
  @ApiOperation({ summary: 'Update a location' })
  updateLocation(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.org.updateLocation(id, dto, principal.userId);
  }

  @Delete('locations/:id')
  @RequirePermissions('locations.manage')
  @Audited('Location')
  @ApiOperation({ summary: 'Archive a location' })
  deleteLocation(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.org.deleteLocation(id, principal.userId);
  }

  // Teams ───────────────────────────────────────────────────────────────────

  @Get('teams')
  @RequirePermissions('teams.view')
  @ApiOperation({ summary: 'List teams' })
  listTeams(@Query() query: TeamQueryDto) {
    return this.org.listTeams(query);
  }

  @Post('teams')
  @RequirePermissions('teams.manage')
  @Audited('Team')
  @ApiOperation({ summary: 'Create a team' })
  createTeam(@CurrentPrincipal() principal: Principal, @Body() dto: CreateTeamDto) {
    return this.org.createTeam(dto, principal.userId);
  }

  @Patch('teams/:id')
  @RequirePermissions('teams.manage')
  @Audited('Team')
  @ApiOperation({ summary: 'Update a team' })
  updateTeam(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.org.updateTeam(id, dto, principal.userId);
  }

  @Delete('teams/:id')
  @RequirePermissions('teams.manage')
  @Audited('Team')
  @ApiOperation({ summary: 'Archive a team' })
  deleteTeam(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.org.deleteTeam(id, principal.userId);
  }

  // Positions ───────────────────────────────────────────────────────────────

  @Get('positions')
  @RequirePermissions('positions.view')
  @ApiOperation({ summary: 'List positions' })
  listPositions(@Query() query: PositionQueryDto) {
    return this.org.listPositions(query);
  }

  @Post('positions')
  @RequirePermissions('positions.manage')
  @Audited('Position')
  @ApiOperation({ summary: 'Create a position' })
  createPosition(@CurrentPrincipal() principal: Principal, @Body() dto: CreatePositionDto) {
    return this.org.createPosition(dto, principal.userId);
  }

  @Patch('positions/:id')
  @RequirePermissions('positions.manage')
  @Audited('Position')
  @ApiOperation({ summary: 'Update a position' })
  updatePosition(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.org.updatePosition(id, dto, principal.userId);
  }

  @Delete('positions/:id')
  @RequirePermissions('positions.manage')
  @Audited('Position')
  @ApiOperation({ summary: 'Archive a position' })
  deletePosition(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.org.deletePosition(id, principal.userId);
  }

  // Work schedules ──────────────────────────────────────────────────────────

  @Get('schedules')
  @RequirePermissions('schedules.view')
  @ApiOperation({ summary: 'List work schedules and templates' })
  listSchedules() {
    return this.org.listSchedules();
  }

  @Post('schedules')
  @RequirePermissions('schedules.manage')
  @Audited('WorkSchedule')
  @ApiOperation({ summary: 'Create a work schedule' })
  createSchedule(@CurrentPrincipal() principal: Principal, @Body() dto: CreateWorkScheduleDto) {
    return this.org.createSchedule(dto, principal.userId);
  }

  @Patch('schedules/:id')
  @RequirePermissions('schedules.manage')
  @Audited('WorkSchedule')
  @ApiOperation({ summary: 'Update a work schedule' })
  updateSchedule(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
    return this.org.updateSchedule(id, dto, principal.userId);
  }

  @Post('schedules/assign')
  @RequirePermissions('schedules.manage')
  @Audited('ScheduleAssignment')
  @ApiOperation({ summary: 'Assign a schedule to an employee from a date' })
  assignSchedule(@CurrentPrincipal() principal: Principal, @Body() dto: AssignScheduleDto) {
    return this.org.assignSchedule(dto, principal.userId);
  }
}
