import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('me')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Employee dashboard: today, leave, calendar, requests, documents' })
  me(@CurrentPrincipal() principal: Principal) {
    return this.dashboard.me(principal);
  }

  @Get('manager')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'Manager dashboard: team attendance, leave, approvals, birthdays, expiring contracts' })
  manager(@CurrentPrincipal() principal: Principal) {
    return this.dashboard.manager(principal);
  }

  @Get('hr')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'HR dashboard: headcount, movement, leave and attendance statistics, turnover' })
  hr(@CurrentPrincipal() principal: Principal) {
    return this.dashboard.hr(principal);
  }

  @Get('admin')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Company admin dashboard: users, seats, integrations, audit, storage, settings' })
  admin(@CurrentPrincipal() principal: Principal) {
    return this.dashboard.admin(principal);
  }
}
