import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { TrainingService } from './training.service.js';
import {
  AssignmentQueryDto,
  CertificationQueryDto,
  CourseQueryDto,
  CreateAssignmentsDto,
  CreateCertificationDto,
  CreateCourseDto,
  CreateLearningPlanDto,
  CreateLearningPlanItemDto,
  CreateSkillDto,
  LearningPlanQueryDto,
  SkillMatrixQueryDto,
  SkillQueryDto,
  UpdateAssignmentDto,
  UpdateCertificationDto,
  UpdateCourseDto,
  UpdateLearningPlanItemDto,
} from './dto/training.dto.js';

@ApiTags('training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  // Courses ─────────────────────────────────────────────────────────────────

  @Get('courses')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Course catalog (active courses with skills and validity)' })
  listCourses(@Query() query: CourseQueryDto) {
    return this.training.listCourses(query);
  }

  @Get('courses/:id')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Course detail' })
  getCourse(@Param('id') id: string) {
    return this.training.getCourse(id);
  }

  @Post('courses')
  @RequirePermissions('training.manage')
  @Audited('Course')
  @ApiOperation({ summary: 'Create a course (optionally linked to skills)' })
  createCourse(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCourseDto) {
    return this.training.createCourse(principal, dto);
  }

  @Patch('courses/:id')
  @RequirePermissions('training.manage')
  @Audited('Course')
  @ApiOperation({ summary: 'Update a course (replaces the skill links when provided)' })
  updateCourse(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.training.updateCourse(principal, id, dto);
  }

  @Delete('courses/:id')
  @RequirePermissions('training.manage')
  @Audited('Course')
  @ApiOperation({ summary: 'Soft-delete a course and cancel its open assignments' })
  deleteCourse(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.training.deleteCourse(principal, id);
  }

  // Assignments ─────────────────────────────────────────────────────────────

  @Get('assignments')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Training assignments within the caller’s scope (overdue derived from the due date)' })
  listAssignments(@CurrentPrincipal() principal: Principal, @Query() query: AssignmentQueryDto) {
    return this.training.listAssignments(principal, query);
  }

  @Get('assignments/:id')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Training assignment detail' })
  getAssignment(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.training.getAssignment(principal, id);
  }

  @Post('assignments')
  @RequirePermissions('training.manage')
  @Audited('TrainingAssignment')
  @ApiOperation({ summary: 'Assign a course to one or more employees (emits training.assigned)' })
  assign(@CurrentPrincipal() principal: Principal, @Body() dto: CreateAssignmentsDto) {
    return this.training.assign(principal, dto);
  }

  @Patch('assignments/:id')
  @RequirePermissions('training.view')
  @Audited('TrainingAssignment')
  @ApiOperation({ summary: 'Start / complete an assignment with score and certificate document' })
  updateAssignment(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    return this.training.updateAssignment(principal, id, dto);
  }

  // Certifications ──────────────────────────────────────────────────────────

  @Get('certifications')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Certifications within the caller’s scope (status derived from the expiry date)' })
  listCertifications(@CurrentPrincipal() principal: Principal, @Query() query: CertificationQueryDto) {
    return this.training.listCertifications(principal, query);
  }

  @Get('certifications/expiring')
  @RequirePermissions('training.view')
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOperation({ summary: 'Certifications expiring within N days (default 30)' })
  expiring(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.training.expiringCertifications(principal, days ? Number(days) : undefined);
  }

  @Post('certifications')
  @RequirePermissions('training.view')
  @Audited('Certification')
  @ApiOperation({ summary: 'Record a certification for an employee' })
  createCertification(@CurrentPrincipal() principal: Principal, @Body() dto: CreateCertificationDto) {
    return this.training.createCertification(principal, dto);
  }

  @Patch('certifications/:id')
  @RequirePermissions('training.view')
  @Audited('Certification')
  @ApiOperation({ summary: 'Update a certification' })
  updateCertification(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateCertificationDto) {
    return this.training.updateCertification(principal, id, dto);
  }

  @Delete('certifications/:id')
  @RequirePermissions('training.view')
  @Audited('Certification')
  @ApiOperation({ summary: 'Delete a certification' })
  deleteCertification(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.training.deleteCertification(principal, id);
  }

  // Skills ──────────────────────────────────────────────────────────────────

  @Get('skills')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Skill catalog' })
  listSkills(@Query() query: SkillQueryDto) {
    return this.training.listSkills(query);
  }

  @Get('skills/matrix')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Per-employee skill levels for the caller’s scope' })
  skillMatrix(@CurrentPrincipal() principal: Principal, @Query() query: SkillMatrixQueryDto) {
    return this.training.skillMatrix(principal, query);
  }

  @Post('skills')
  @RequirePermissions('training.manage')
  @Audited('Skill')
  @ApiOperation({ summary: 'Add a skill to the catalog' })
  createSkill(@CurrentPrincipal() principal: Principal, @Body() dto: CreateSkillDto) {
    return this.training.createSkill(principal, dto);
  }

  // Learning plans ──────────────────────────────────────────────────────────

  @Get('plans')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Learning plans within the caller’s scope' })
  listPlans(@CurrentPrincipal() principal: Principal, @Query() query: LearningPlanQueryDto) {
    return this.training.listPlans(principal, query);
  }

  @Post('plans')
  @RequirePermissions('training.manage')
  @Audited('LearningPlan')
  @ApiOperation({ summary: 'Create a learning plan for an employee' })
  createPlan(@CurrentPrincipal() principal: Principal, @Body() dto: CreateLearningPlanDto) {
    return this.training.createPlan(principal, dto);
  }

  @Post('plans/:id/items')
  @RequirePermissions('training.manage')
  @Audited('LearningPlanItem')
  @ApiOperation({ summary: 'Add a course to a learning plan' })
  addPlanItem(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: CreateLearningPlanItemDto) {
    return this.training.addPlanItem(principal, id, dto);
  }

  @Patch('plans/items/:id')
  @RequirePermissions('training.view')
  @Audited('LearningPlanItem')
  @ApiOperation({ summary: 'Update a learning plan item (the assignee may tick their own items)' })
  updatePlanItem(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateLearningPlanItemDto) {
    return this.training.updatePlanItem(principal, id, dto);
  }

  @Post('plans/:id/complete')
  @RequirePermissions('training.manage')
  @Audited('LearningPlan')
  @ApiOperation({ summary: 'Complete a learning plan (all items must be finished)' })
  completePlan(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.training.completePlan(principal, id);
  }

  // Dashboard ───────────────────────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermissions('training.view')
  @ApiOperation({ summary: 'Training summary: completed / upcoming / expired counts for the caller’s scope' })
  dashboard(@CurrentPrincipal() principal: Principal) {
    return this.training.dashboard(principal);
  }
}
