import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { AttendanceService } from './attendance.service.js';
import {
  AttendanceQueryDto,
  BreakDto,
  ClockOutDto,
  CorrectionQueryDto,
  CreateCorrectionDto,
  DecideCorrectionDto,
  KioskPunchDto,
  MissingPunchesQueryDto,
  PunchDto,
  SummaryQueryDto,
} from './dto/attendance.dto.js';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // Punches ─────────────────────────────────────────────────────────────────

  @Post('clock-in')
  @RequirePermissions('attendance.clock')
  @Audited('AttendanceEntry')
  @ApiOperation({ summary: 'Clock in (creates or reopens today’s attendance entry)' })
  clockIn(@CurrentPrincipal() principal: Principal, @Body() dto: PunchDto) {
    return this.attendance.clockIn(principal, dto);
  }

  @Post('clock-out')
  @RequirePermissions('attendance.clock')
  @Audited('AttendanceEntry')
  @ApiOperation({ summary: 'Clock out (closes the day and computes worked/overtime minutes)' })
  clockOut(@CurrentPrincipal() principal: Principal, @Body() dto: ClockOutDto) {
    return this.attendance.clockOut(principal, dto);
  }

  @Post('breaks/start')
  @RequirePermissions('attendance.clock')
  @Audited('AttendanceBreak')
  @ApiOperation({ summary: 'Start a break' })
  startBreak(@CurrentPrincipal() principal: Principal, @Body() dto: BreakDto) {
    return this.attendance.startBreak(principal, dto);
  }

  @Post('breaks/end')
  @RequirePermissions('attendance.clock')
  @Audited('AttendanceBreak')
  @ApiOperation({ summary: 'End the running break and recompute the entry’s break minutes' })
  endBreak(@CurrentPrincipal() principal: Principal, @Body() dto: BreakDto) {
    return this.attendance.endBreak(principal, dto);
  }

  // Reading ─────────────────────────────────────────────────────────────────

  @Get('today')
  @RequirePermissions('attendance.self.view')
  @ApiOperation({ summary: 'The caller’s own attendance entry for today (null when not punched yet)' })
  today(@CurrentPrincipal() principal: Principal) {
    return this.attendance.today(principal);
  }

  @Get('missing-punches')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Open punches and absent working days within the caller’s scope' })
  missingPunches(@CurrentPrincipal() principal: Principal, @Query() query: MissingPunchesQueryDto) {
    return this.attendance.missingPunches(principal, query);
  }

  @Get('summary')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Attendance totals (worked/overtime, late, remote, missing) for a period' })
  summary(@CurrentPrincipal() principal: Principal, @Query() query: SummaryQueryDto) {
    return this.attendance.summary(principal, query);
  }

  @Get('corrections')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Correction requests within the caller’s scope' })
  listCorrections(@CurrentPrincipal() principal: Principal, @Query() query: CorrectionQueryDto) {
    return this.attendance.listCorrections(principal, query);
  }

  @Get()
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Attendance entries within the caller’s scope' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'from', required: false, example: '2026-10-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-10-31' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  list(@CurrentPrincipal() principal: Principal, @Query() query: AttendanceQueryDto) {
    return this.attendance.list(principal, query);
  }

  // Corrections ─────────────────────────────────────────────────────────────

  @Post('corrections')
  @RequirePermissions('attendance.clock')
  @Audited('AttendanceCorrection')
  @ApiOperation({ summary: 'Request a correction for a past day' })
  requestCorrection(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCorrectionDto) {
    return this.attendance.requestCorrection(principal, dto);
  }

  @Post('corrections/:id/approve')
  @RequirePermissions('attendance.approve')
  @Audited('AttendanceCorrection')
  @ApiOperation({ summary: 'Approve a correction and apply the requested values to the entry' })
  approveCorrection(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: DecideCorrectionDto,
  ) {
    return this.attendance.approveCorrection(principal, id, dto);
  }

  @Post('corrections/:id/reject')
  @RequirePermissions('attendance.approve')
  @Audited('AttendanceCorrection')
  @ApiOperation({ summary: 'Reject a correction request' })
  rejectCorrection(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: DecideCorrectionDto,
  ) {
    return this.attendance.rejectCorrection(principal, id, dto);
  }

  // Kiosk ───────────────────────────────────────────────────────────────────

  @Post('kiosk/punch')
  @RequirePermissions('attendance.manage')
  @Audited('AttendanceEntry')
  @ApiOperation({
    summary: 'Shared-kiosk punch by employee number (requires attendance.manage until device auth ships)',
    description:
      'Accepts an employee number and toggles clock-in/clock-out. Shared devices are not authenticated yet, so ' +
      'this endpoint is restricted to attendance managers; a signed device token will replace that guard. ' +
      'A kiosk PIN can be added to the payload once device authentication exists.',
  })
  kioskPunch(@CurrentPrincipal() principal: Principal, @Body() dto: KioskPunchDto) {
    return this.attendance.kioskPunch(principal, dto);
  }
}
