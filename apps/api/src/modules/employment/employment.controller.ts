import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { EmploymentService } from './employment.service.js';
import { BenefitDto, CompensationChangeDto, ContractQueryDto, CreateContractDto, UpdateContractDto } from './dto/employment.dto.js';

@ApiTags('contracts')
@ApiBearerAuth()
@Controller()
export class EmploymentController {
  constructor(private readonly employment: EmploymentService) {}

  @Get('contracts')
  @RequirePermissions('contracts.view')
  @ApiOperation({ summary: 'List employment contracts' })
  listContracts(@CurrentPrincipal() principal: Principal, @Query() query: ContractQueryDto) {
    return this.employment.listContracts(principal, query);
  }

  @Post('contracts')
  @RequirePermissions('contracts.manage')
  @Audited('Contract')
  @ApiOperation({ summary: 'Create a contract (optionally recording the salary)' })
  createContract(@CurrentPrincipal() principal: Principal, @Body() dto: CreateContractDto) {
    return this.employment.createContract(principal, dto);
  }

  @Patch('contracts/:id')
  @RequirePermissions('contracts.manage')
  @Audited('Contract')
  @ApiOperation({ summary: 'Update a contract' })
  updateContract(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.employment.updateContract(principal, id, dto);
  }

  @Get('contracts/expiring')
  @RequirePermissions('contracts.view')
  @ApiQuery({ name: 'days', required: false, example: 60 })
  @ApiOperation({ summary: 'Contracts, probations, certifications and documents expiring soon' })
  expiring(@CurrentPrincipal() principal: Principal, @Query('days') days?: string) {
    return this.employment.expiringItems(principal, days ? Number(days) : 60);
  }

  @Get('employees/:id/compensation')
  @RequirePermissions('compensation.view')
  @ApiOperation({ summary: 'Compensation history and current salary' })
  compensation(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employment.listCompensation(principal, id);
  }

  @Post('employees/:id/compensation')
  @RequirePermissions('compensation.manage')
  @Audited('CompensationChange')
  @ApiOperation({ summary: 'Record a salary/bonus change (old + new values are audited)' })
  changeCompensation(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: CompensationChangeDto,
  ) {
    return this.employment.recordCompensation(principal, id, dto);
  }

  @Get('employees/:id/benefits')
  @RequirePermissions('benefits.view')
  @ApiOperation({ summary: 'Benefits of an employee' })
  benefits(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employment.listBenefits(principal, id);
  }

  @Post('employees/:id/benefits')
  @RequirePermissions('benefits.manage')
  @Audited('Benefit')
  @ApiOperation({ summary: 'Assign a benefit' })
  addBenefit(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: BenefitDto) {
    return this.employment.addBenefit(principal, id, dto);
  }

  @Delete('benefits/:id')
  @RequirePermissions('benefits.manage')
  @Audited('Benefit')
  @ApiOperation({ summary: 'Remove a benefit' })
  removeBenefit(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.employment.removeBenefit(principal, id);
  }
}
