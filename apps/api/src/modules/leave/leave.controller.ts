import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { LeaveService } from './leave.service.js';
import {
  AdjustBalanceDto,
  CancelLeaveRequestDto,
  CreateBlackoutDto,
  CreateHolidayDto,
  CreateLeavePolicyDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  LeaveRequestQueryDto,
  TeamCalendarQueryDto,
  UpdateLeavePolicyDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto.js';

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // Types & policies ────────────────────────────────────────────────────────

  @Get('types')
  @RequirePermissions('leave.view')
  @ApiQuery({ name: 'includeInactive', required: false })
  @ApiOperation({ summary: 'Leave types configured for the company' })
  types(@Query('includeInactive') includeInactive?: string) {
    return this.leave.listLeaveTypes(includeInactive === 'true');
  }

  @Post('types')
  @RequirePermissions('leave.manage')
  @Audited('LeaveType')
  @ApiOperation({ summary: 'Create a custom leave type' })
  createType(@CurrentPrincipal() principal: Principal, @Body() dto: CreateLeaveTypeDto) {
    return this.leave.createLeaveType(principal, dto);
  }

  @Patch('types/:id')
  @RequirePermissions('leave.manage')
  @Audited('LeaveType')
  @ApiOperation({ summary: 'Update a leave type' })
  updateType(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.leave.updateLeaveType(principal, id, dto);
  }

  @Get('policies')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Leave policies (approval chains, notice periods, blackouts)' })
  policies() {
    return this.leave.listPolicies();
  }

  @Post('policies')
  @RequirePermissions('leave.manage')
  @Audited('LeavePolicy')
  @ApiOperation({ summary: 'Create a leave policy' })
  createPolicy(@CurrentPrincipal() principal: Principal, @Body() dto: CreateLeavePolicyDto) {
    return this.leave.upsertPolicy(principal, dto);
  }

  @Patch('policies/:id')
  @RequirePermissions('leave.manage')
  @Audited('LeavePolicy')
  @ApiOperation({ summary: 'Update a leave policy' })
  updatePolicy(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateLeavePolicyDto) {
    return this.leave.upsertPolicy(principal, { ...dto, approvalChain: dto.approvalChain ?? [] } as CreateLeavePolicyDto, id);
  }

  @Delete('policies/:id')
  @RequirePermissions('leave.manage')
  @Audited('LeavePolicy')
  @ApiOperation({ summary: 'Delete a leave policy' })
  deletePolicy(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.leave.deletePolicy(principal, id);
  }

  // Holidays & blackouts ────────────────────────────────────────────────────

  @Get('holidays')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Company holidays for a year' })
  @ApiQuery({ name: 'year', required: false, example: 2026 })
  holidays(@Query('year') year?: string) {
    return this.leave.listHolidays(year ? Number(year) : undefined);
  }

  @Post('holidays')
  @RequirePermissions('leave.manage')
  @Audited('Holiday')
  @ApiOperation({ summary: 'Add a company holiday' })
  createHoliday(@CurrentPrincipal() principal: Principal, @Body() dto: CreateHolidayDto) {
    return this.leave.createHoliday(principal, dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions('leave.manage')
  @Audited('Holiday')
  @ApiOperation({ summary: 'Remove a company holiday' })
  deleteHoliday(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.leave.deleteHoliday(principal, id);
  }

  @Get('blackouts')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Blackout periods in which leave cannot be requested' })
  blackouts() {
    return this.leave.listBlackouts();
  }

  @Post('blackouts')
  @RequirePermissions('leave.manage')
  @Audited('LeaveBlackoutDate')
  @ApiOperation({ summary: 'Create a blackout period' })
  createBlackout(@CurrentPrincipal() principal: Principal, @Body() dto: CreateBlackoutDto) {
    return this.leave.createBlackout(principal, dto);
  }

  @Delete('blackouts/:id')
  @RequirePermissions('leave.manage')
  @Audited('LeaveBlackoutDate')
  @ApiOperation({ summary: 'Remove a blackout period' })
  deleteBlackout(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.leave.deleteBlackout(principal, id);
  }

  // Balances ────────────────────────────────────────────────────────────────

  @Get('balances/me')
  @RequirePermissions('leave.self.view')
  @ApiOperation({ summary: 'My leave balances (available / used / pending / remaining)' })
  @ApiQuery({ name: 'year', required: false })
  myBalances(@CurrentPrincipal() principal: Principal, @Query('year') year?: string) {
    return this.leave.myBalances(principal, year ? Number(year) : undefined);
  }

  @Get('balances/:employeeId')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Leave balances of an employee' })
  @ApiQuery({ name: 'year', required: false })
  balances(
    @CurrentPrincipal() principal: Principal,
    @Param('employeeId') employeeId: string,
    @Query('year') year?: string,
  ) {
    return this.leave.balancesFor(principal, employeeId, year ? Number(year) : undefined);
  }

  @Post('balances/adjust')
  @RequirePermissions('leave.manage')
  @Audited('LeaveBalance')
  @ApiOperation({ summary: 'Adjust entitlement, carry-over or add a manual adjustment' })
  adjustBalance(@CurrentPrincipal() principal: Principal, @Body() dto: AdjustBalanceDto) {
    return this.leave.adjustBalance(principal, dto);
  }

  // Requests ────────────────────────────────────────────────────────────────

  @Get('requests')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'List leave requests within the caller’s scope' })
  listRequests(@CurrentPrincipal() principal: Principal, @Query() query: LeaveRequestQueryDto) {
    return this.leave.listRequests(principal, query);
  }

  @Get('requests/pending-approval')
  @RequirePermissions('leave.approve')
  @ApiOperation({ summary: 'Requests waiting for the caller’s approval' })
  pendingApproval(@CurrentPrincipal() principal: Principal, @Query() query: LeaveRequestQueryDto) {
    return this.leave.listRequests(principal, { ...query, pendingMyApproval: true });
  }

  @Get('requests/:id')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Leave request detail with approval steps' })
  getRequest(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.leave.getRequest(principal, id);
  }

  @Post('requests')
  @RequirePermissions('leave.request')
  @Audited('LeaveRequest')
  @ApiOperation({ summary: 'Submit a leave request (validates policy, balance and blackout dates)' })
  createRequest(@CurrentPrincipal() principal: Principal, @Body() dto: CreateLeaveRequestDto) {
    return this.leave.createRequest(principal, dto);
  }

  @Post('requests/:id/approve')
  @RequirePermissions('leave.approve')
  @Audited('LeaveRequest')
  @ApiOperation({ summary: 'Approve the current step (final approval moves pending → used)' })
  approve(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return this.leave.approve(principal, id, dto);
  }

  @Post('requests/:id/reject')
  @RequirePermissions('leave.approve')
  @Audited('LeaveRequest')
  @ApiOperation({ summary: 'Reject a request with a reason' })
  reject(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: DecideLeaveRequestDto) {
    return this.leave.reject(principal, id, dto);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('leave.request')
  @Audited('LeaveRequest')
  @ApiOperation({ summary: 'Cancel a request (refunds the balance)' })
  cancel(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: CancelLeaveRequestDto) {
    return this.leave.cancel(principal, id, dto.reason);
  }

  @Get('calendar')
  @RequirePermissions('calendar.view')
  @ApiOperation({ summary: 'Team leave calendar (who is away, when)' })
  calendar(@CurrentPrincipal() principal: Principal, @Query() query: TeamCalendarQueryDto) {
    return this.leave.teamCalendar(principal, query.from, query.to);
  }
}
