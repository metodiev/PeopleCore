import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { PerformanceService } from './performance.service.js';
import {
  CreateFeedbackDto,
  CreateGoalDto,
  CreateKeyResultDto,
  CreateReviewCycleDto,
  CreateReviewDto,
  FeedbackQueryDto,
  GoalQueryDto,
  ReviewCycleQueryDto,
  ReviewQueryDto,
  SubmitReviewDto,
  UpdateGoalDto,
  UpdateGoalProgressDto,
  UpdateKeyResultDto,
  UpdateReviewCycleDto,
} from './dto/performance.dto.js';

@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  // Review cycles ───────────────────────────────────────────────────────────

  @Get('cycles')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Review cycles (active, draft and closed)' })
  listCycles(@Query() query: ReviewCycleQueryDto) {
    return this.performance.listCycles(query);
  }

  @Get('cycles/:id')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Review cycle detail with completion counts' })
  getCycle(@Param('id') id: string) {
    return this.performance.getCycle(id);
  }

  @Post('cycles')
  @RequirePermissions('performance.manage')
  @Audited('ReviewCycle')
  @ApiOperation({ summary: 'Create a review cycle' })
  createCycle(@CurrentPrincipal() principal: Principal, @Body() dto: CreateReviewCycleDto) {
    return this.performance.createCycle(principal, dto);
  }

  @Patch('cycles/:id')
  @RequirePermissions('performance.manage')
  @Audited('ReviewCycle')
  @ApiOperation({ summary: 'Update a review cycle' })
  updateCycle(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateReviewCycleDto) {
    return this.performance.updateCycle(principal, id, dto);
  }

  @Post('cycles/:id/activate')
  @RequirePermissions('performance.manage')
  @Audited('ReviewCycle')
  @ApiOperation({ summary: 'Activate a review cycle (reviews can be created)' })
  activateCycle(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.activateCycle(principal, id);
  }

  @Post('cycles/:id/close')
  @RequirePermissions('performance.manage')
  @Audited('ReviewCycle')
  @ApiOperation({ summary: 'Close a review cycle' })
  closeCycle(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.closeCycle(principal, id);
  }

  // Reviews ─────────────────────────────────────────────────────────────────

  @Get('reviews')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Reviews within the caller’s scope (mine as reviewer / subject)' })
  listReviews(@CurrentPrincipal() principal: Principal, @Query() query: ReviewQueryDto) {
    return this.performance.listReviews(principal, query);
  }

  @Get('reviews/:id')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Review detail with feedback' })
  getReview(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.getReview(principal, id);
  }

  @Post('reviews')
  @RequirePermissions('performance.review')
  @Audited('PerformanceReview')
  @ApiOperation({ summary: 'Create a review for an employee (self, manager, peer or upward)' })
  createReview(@CurrentPrincipal() principal: Principal, @Body() dto: CreateReviewDto) {
    return this.performance.createReview(principal, dto);
  }

  @Patch('reviews/:id')
  @RequirePermissions('performance.self.view')
  @Audited('PerformanceReview')
  @ApiOperation({ summary: 'Fill in / submit a review (ratings, summary, strengths, improvements)' })
  submitReview(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: SubmitReviewDto) {
    return this.performance.submitReview(principal, id, dto);
  }

  @Post('reviews/:id/acknowledge')
  @RequirePermissions('performance.self.view')
  @Audited('PerformanceReview')
  @ApiOperation({ summary: 'Acknowledge a submitted review (the reviewed employee)' })
  acknowledgeReview(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.acknowledgeReview(principal, id);
  }

  // Goals / OKRs / KPIs ─────────────────────────────────────────────────────

  @Get('goals')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Goals within the caller’s scope' })
  listGoals(@CurrentPrincipal() principal: Principal, @Query() query: GoalQueryDto) {
    return this.performance.listGoals(principal, query);
  }

  @Get('goals/:id')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Goal detail with key results' })
  getGoal(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.getGoal(principal, id);
  }

  @Post('goals')
  @RequirePermissions('performance.self.view')
  @Audited('Goal')
  @ApiOperation({ summary: 'Create a goal / OKR / KPI for yourself or (managers, HR) your team' })
  createGoal(@CurrentPrincipal() principal: Principal, @Body() dto: CreateGoalDto) {
    return this.performance.createGoal(principal, dto);
  }

  @Patch('goals/:id')
  @RequirePermissions('performance.self.view')
  @Audited('Goal')
  @ApiOperation({ summary: 'Update a goal' })
  updateGoal(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateGoalDto) {
    return this.performance.updateGoal(principal, id, dto);
  }

  @Delete('goals/:id')
  @RequirePermissions('performance.self.view')
  @Audited('Goal')
  @ApiOperation({ summary: 'Delete a goal (cascades to its key results)' })
  deleteGoal(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.performance.deleteGoal(principal, id);
  }

  @Post('goals/:id/key-results')
  @RequirePermissions('performance.self.view')
  @Audited('KeyResult')
  @ApiOperation({ summary: 'Add a key result to a goal' })
  addKeyResult(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: CreateKeyResultDto) {
    return this.performance.addKeyResult(principal, id, dto);
  }

  @Patch('key-results/:id')
  @RequirePermissions('performance.self.view')
  @Audited('KeyResult')
  @ApiOperation({ summary: 'Update a key result — the goal progress is recomputed from it' })
  updateKeyResult(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateKeyResultDto) {
    return this.performance.updateKeyResult(principal, id, dto);
  }

  @Patch('goals/:id/progress')
  @RequirePermissions('performance.self.view')
  @Audited('Goal')
  @ApiOperation({ summary: 'Set the goal progress, or roll it up from its key results' })
  updateGoalProgress(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateGoalProgressDto) {
    return this.performance.updateGoalProgress(principal, id, dto);
  }

  // Feedback & dashboard ────────────────────────────────────────────────────

  @Get('feedback')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Feedback for an employee, honouring visibility and anonymity' })
  listFeedback(@CurrentPrincipal() principal: Principal, @Query() query: FeedbackQueryDto) {
    return this.performance.listFeedback(principal, query);
  }

  @Post('feedback')
  @RequirePermissions('performance.self.view')
  @Audited('ReviewFeedback')
  @ApiOperation({ summary: 'Give feedback (optionally anonymous) about an employee' })
  createFeedback(@CurrentPrincipal() principal: Principal, @Body() dto: CreateFeedbackDto) {
    return this.performance.createFeedback(principal, dto);
  }

  @Get('dashboard')
  @RequirePermissions('performance.self.view')
  @ApiOperation({ summary: 'Performance summary for the caller’s scope' })
  dashboard(@CurrentPrincipal() principal: Principal) {
    return this.performance.dashboard(principal);
  }
}
