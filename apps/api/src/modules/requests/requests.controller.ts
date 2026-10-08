import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { RequestsService } from './requests.service.js';
import {
  AssignHRRequestDto,
  CreateHRRequestDto,
  HRRequestCommentDto,
  HRRequestQueryDto,
  HRRequestStatsQueryDto,
  UpdateHRRequestStatusDto,
} from './dto/requests.dto.js';

@ApiTags('requests')
@ApiBearerAuth()
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  // Employee self-service ───────────────────────────────────────────────────

  @Get()
  @RequirePermissions('requests.self.view')
  @ApiOperation({ summary: 'HR tickets — the caller’s own, or every ticket within their scope' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: HRRequestQueryDto) {
    return this.requests.list(principal, query);
  }

  @Post()
  @RequirePermissions('requests.create')
  @Audited('HRRequest')
  @ApiOperation({ summary: 'Raise an HR ticket (emits request.created)' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateHRRequestDto) {
    return this.requests.create(principal, dto);
  }

  // HR inbox ────────────────────────────────────────────────────────────────

  @Get('inbox')
  @RequirePermissions('requests.manage')
  @ApiOperation({ summary: 'HR inbox (filters: status, type, priority, assigneeId, unassigned)' })
  inbox(@CurrentPrincipal() principal: Principal, @Query() query: HRRequestQueryDto) {
    return this.requests.inbox(principal, query);
  }

  @Get('stats')
  @RequirePermissions('requests.view')
  @ApiOperation({ summary: 'SLA statistics: open by type/priority, average resolution time, oldest open ticket' })
  stats(@CurrentPrincipal() principal: Principal, @Query() query: HRRequestStatsQueryDto) {
    return this.requests.stats(principal, query);
  }

  @Get(':id')
  @RequirePermissions('requests.self.view')
  @ApiOperation({ summary: 'Ticket detail with its comment thread (internal notes only for HR)' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.requests.get(principal, id);
  }

  @Post(':id/comments')
  @RequirePermissions('requests.self.view')
  @Audited('HRRequestComment')
  @ApiOperation({ summary: 'Add a comment to a ticket (isInternal visible to HR only, emits request.comment)' })
  addComment(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: HRRequestCommentDto) {
    return this.requests.addComment(principal, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('requests.self.view')
  @Audited('HRRequest')
  @ApiOperation({ summary: 'Cancel an open ticket' })
  cancel(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.requests.cancel(principal, id);
  }

  @Post(':id/assign')
  @RequirePermissions('requests.manage')
  @Audited('HRRequest')
  @ApiOperation({ summary: 'Assign a ticket to an HR agent (→ IN_PROGRESS, emits request.assigned)' })
  assign(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: AssignHRRequestDto) {
    return this.requests.assign(principal, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('requests.manage')
  @Audited('HRRequest')
  @ApiOperation({ summary: 'Move a ticket to WAITING_EMPLOYEE / RESOLVED / CLOSED / CANCELLED (emits request.resolved)' })
  updateStatus(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateHRRequestStatusDto) {
    return this.requests.updateStatus(principal, id, dto);
  }
}
