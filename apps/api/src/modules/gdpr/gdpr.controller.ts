import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { GdprService } from './gdpr.service.js';
import {
  ApplyRetentionDto,
  ConsentQueryDto,
  CreateConsentDto,
  CreateDataExportDto,
  CreateErasureDto,
  CreateRetentionPolicyDto,
  DataExportQueryDto,
  DecideErasureDto,
  ErasureQueryDto,
  UpdateRetentionPolicyDto,
} from './dto/gdpr.dto.js';

/**
 * GDPR endpoints. Consent and export routes intentionally carry no
 * `@RequirePermissions` decorator: employees manage their own consents and may
 * request their own export without a GDPR role, while the service enforces the
 * permission check as soon as somebody else's data is involved.
 */
@ApiTags('gdpr')
@ApiBearerAuth()
@Controller('gdpr')
export class GdprController {
  constructor(private readonly gdpr: GdprService) {}

  @Get('overview')
  @RequirePermissions('gdpr.view')
  @ApiOperation({ summary: 'Privacy settings, request counters and consent statistics' })
  overview() {
    return this.gdpr.overview();
  }

  // Consents ────────────────────────────────────────────────────────────────

  @Get('consents')
  @ApiOperation({ summary: 'Consents of an employee (defaults to the caller)' })
  listConsents(@CurrentPrincipal() principal: Principal, @Query() query: ConsentQueryDto) {
    return this.gdpr.listConsents(principal, query);
  }

  @Post('consents')
  @Audited('ConsentRecord')
  @ApiOperation({ summary: 'Record a consent (self-service or, with gdpr.manage, for an employee)' })
  createConsent(@CurrentPrincipal() principal: Principal, @Body() dto: CreateConsentDto) {
    return this.gdpr.createConsent(principal, dto);
  }

  @Post('consents/:id/revoke')
  @Audited('ConsentRecord')
  @ApiOperation({ summary: 'Revoke a consent' })
  revokeConsent(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.gdpr.revokeConsent(principal, id);
  }

  // Subject access (export) ─────────────────────────────────────────────────

  @Get('export')
  @RequirePermissions('gdpr.view')
  @ApiOperation({ summary: 'Data export requests with their status' })
  listExports(@Query() query: DataExportQueryDto) {
    return this.gdpr.listExports(query);
  }

  @Post('export')
  @Audited('DataExportRequest')
  @ApiOperation({
    summary: 'Generate a subject access export (self-service or, with gdpr.manage, for another person)',
    description:
      'Builds a JSON bundle of everything stored about the subject, stores it as a document in the EXPORT category and emits ' +
      '`gdpr.export.completed` for the notifications queue.',
  })
  requestExport(@CurrentPrincipal() principal: Principal, @Body() dto: CreateDataExportDto) {
    return this.gdpr.requestExport(principal, dto);
  }

  // Erasure ─────────────────────────────────────────────────────────────────

  @Get('erasure')
  @RequirePermissions('gdpr.view')
  @ApiOperation({ summary: 'Erasure requests with their status' })
  listErasures(@Query() query: ErasureQueryDto) {
    return this.gdpr.listErasures(query);
  }

  @Post('erasure')
  @Audited('ErasureRequest')
  @ApiOperation({ summary: 'Request erasure of an employee record (self-service or with gdpr.manage)' })
  requestErasure(@CurrentPrincipal() principal: Principal, @Body() dto: CreateErasureDto) {
    return this.gdpr.requestErasure(principal, dto);
  }

  @Post('erasure/:id/approve')
  @RequirePermissions('gdpr.manage')
  @Audited('ErasureRequest')
  @ApiOperation({
    summary: 'Execute an erasure request (ANONYMIZE keeps aggregates, DELETE removes personal data)',
  })
  approveErasure(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: DecideErasureDto) {
    return this.gdpr.approveErasure(principal, id, dto);
  }

  // Retention ───────────────────────────────────────────────────────────────

  @Get('retention')
  @RequirePermissions('gdpr.view')
  @ApiOperation({ summary: 'Retention policies of the company' })
  listRetention() {
    return this.gdpr.listRetention();
  }

  @Post('retention')
  @RequirePermissions('gdpr.manage')
  @Audited('RetentionPolicy')
  @ApiOperation({ summary: 'Create a retention policy' })
  createRetention(@CurrentPrincipal() principal: Principal, @Body() dto: CreateRetentionPolicyDto) {
    return this.gdpr.createRetentionPolicy(principal, dto);
  }

  @Patch('retention/:id')
  @RequirePermissions('gdpr.manage')
  @Audited('RetentionPolicy')
  @ApiOperation({ summary: 'Update a retention policy' })
  updateRetention(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() dto: UpdateRetentionPolicyDto,
  ) {
    return this.gdpr.updateRetentionPolicy(principal, id, dto);
  }

  @Delete('retention/:id')
  @RequirePermissions('gdpr.manage')
  @Audited('RetentionPolicy')
  @ApiOperation({ summary: 'Delete a retention policy' })
  deleteRetention(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.gdpr.deleteRetentionPolicy(principal, id);
  }

  @Post('retention/apply')
  @RequirePermissions('gdpr.manage')
  @Audited('RetentionPolicy')
  @ApiOperation({
    summary: 'Apply the retention policies now (also run daily by the scheduler)',
    description: 'Supports dryRun to report the affected row counts without changing anything.',
  })
  applyRetention(@CurrentPrincipal() principal: Principal, @Body() dto: ApplyRetentionDto) {
    return this.gdpr.applyRetention(principal, dto);
  }
}
