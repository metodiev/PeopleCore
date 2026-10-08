import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { AnyPermissionGuard, RequireAnyPermission } from './any-permission.guard.js';
import { ExpensesService } from './expenses.service.js';
import {
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ExpenseCategoryQueryDto,
  ExpenseQueryDto,
  ExpenseSummaryQueryDto,
  ExportExpensesDto,
  ReviewExpenseDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/expenses.dto.js';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // Categories ──────────────────────────────────────────────────────────────

  @Get('categories')
  @UseGuards(AnyPermissionGuard)
  @RequireAnyPermission('expenses.self.view', 'expenses.view', 'expenses.manage')
  @ApiOperation({ summary: 'Expense categories with their receipt and amount rules' })
  listCategories(@Query() query: ExpenseCategoryQueryDto) {
    return this.expenses.listCategories(query);
  }

  @Post('categories')
  @RequirePermissions('expenses.manage')
  @Audited('ExpenseCategory')
  @ApiOperation({ summary: 'Create an expense category' })
  createCategory(@CurrentPrincipal() principal: Principal, @Body() dto: CreateExpenseCategoryDto) {
    return this.expenses.createCategory(principal, dto);
  }

  @Patch('categories/:id')
  @RequirePermissions('expenses.manage')
  @Audited('ExpenseCategory')
  @ApiOperation({ summary: 'Update an expense category' })
  updateCategory(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.expenses.updateCategory(principal, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('expenses.manage')
  @Audited('ExpenseCategory')
  @ApiOperation({ summary: 'Delete an unused expense category' })
  deleteCategory(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.expenses.deleteCategory(principal, id);
  }

  // Reporting & export ──────────────────────────────────────────────────────

  @Get('summary')
  @RequirePermissions('expenses.view')
  @ApiOperation({ summary: 'Expense totals by status and category (accounting view)' })
  summary(@CurrentPrincipal() principal: Principal, @Query() query: ExpenseSummaryQueryDto) {
    return this.expenses.summary(principal, query);
  }

  @Post('export')
  @RequirePermissions('expenses.manage')
  @Audited('Expense')
  @ApiOperation({ summary: 'Export approved/reimbursed expenses for the accounting system (CSV)' })
  export(@CurrentPrincipal() principal: Principal, @Body() dto: ExportExpensesDto) {
    return this.expenses.export(principal, dto);
  }

  // Employee flow ───────────────────────────────────────────────────────────

  @Get()
  @UseGuards(AnyPermissionGuard)
  @RequireAnyPermission('expenses.self.view', 'expenses.view', 'expenses.manage')
  @ApiOperation({ summary: 'Expenses within the caller’s scope' })
  list(@CurrentPrincipal() principal: Principal, @Query() query: ExpenseQueryDto) {
    return this.expenses.list(principal, query);
  }

  @Post()
  @RequirePermissions('expenses.create')
  @Audited('Expense')
  @ApiOperation({ summary: 'File an expense claim (draft) — amount limit and receipt are validated' })
  create(@CurrentPrincipal() principal: Principal, @Body() dto: CreateExpenseDto) {
    return this.expenses.create(principal, dto);
  }

  @Get(':id')
  @UseGuards(AnyPermissionGuard)
  @RequireAnyPermission('expenses.self.view', 'expenses.view', 'expenses.manage')
  @ApiOperation({ summary: 'Expense detail' })
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.expenses.get(principal, id);
  }

  @Patch(':id')
  @RequirePermissions('expenses.create')
  @Audited('Expense')
  @ApiOperation({ summary: 'Edit a draft / changes-requested expense' })
  update(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(principal, id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions('expenses.create')
  @Audited('Expense')
  @ApiOperation({ summary: 'Submit an expense for approval (emits expense.submitted)' })
  submit(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.expenses.submit(principal, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('expenses.create')
  @Audited('Expense')
  @ApiOperation({ summary: 'Cancel an expense claim' })
  cancel(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.expenses.cancel(principal, id);
  }

  // Approver flow ───────────────────────────────────────────────────────────

  @Post(':id/approve')
  @RequirePermissions('expenses.approve')
  @Audited('Expense')
  @ApiOperation({ summary: 'Approve a submitted expense (emits expense.approved)' })
  approve(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: ReviewExpenseDto) {
    return this.expenses.approve(principal, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions('expenses.approve')
  @Audited('Expense')
  @ApiOperation({ summary: 'Reject a submitted expense with a reason (emits expense.rejected)' })
  reject(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: ReviewExpenseDto) {
    return this.expenses.reject(principal, id, dto);
  }

  @Post(':id/request-changes')
  @RequirePermissions('expenses.approve')
  @Audited('Expense')
  @ApiOperation({ summary: 'Send an expense back to the employee for corrections' })
  requestChanges(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: ReviewExpenseDto) {
    return this.expenses.requestChanges(principal, id, dto);
  }

  @Post(':id/reimburse')
  @RequirePermissions('expenses.manage')
  @Audited('Expense')
  @ApiOperation({ summary: 'Mark an approved expense as reimbursed (finance)' })
  reimburse(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: ReviewExpenseDto) {
    return this.expenses.reimburse(principal, id, dto);
  }
}
