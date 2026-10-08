import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Principal, ReportType } from '@peoplecore/shared';
import { CurrentPrincipal } from '../../common/decorators/current-principal.decorator.js';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator.js';
import { Audited } from '../audit/audited.decorator.js';
import { ReportsService } from './reports.service.js';
import {
  CreateSavedReportDto,
  ReportExportDto,
  ReportQueryDto,
  ReportRunQueryDto,
  RunSavedReportDto,
  UpdateSavedReportDto,
} from './dto/report.dto.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('catalog')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Available report types with the permissions each one needs' })
  catalog() {
    return { types: this.reports.catalog() };
  }

  // Saved reports & runs are declared before `:type` so they are never
  // swallowed by the report-type route.

  @Get('saved')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Saved reports and their schedules' })
  listSaved(@Query() query: ReportQueryDto) {
    return this.reports.listSaved(query);
  }

  @Post('saved')
  @RequirePermissions('reports.manage')
  @Audited('SavedReport')
  @ApiOperation({ summary: 'Save a report definition (optionally scheduled)' })
  createSaved(@CurrentPrincipal() principal: Principal, @Body() dto: CreateSavedReportDto) {
    return this.reports.createSaved(principal, dto);
  }

  @Patch('saved/:id')
  @RequirePermissions('reports.manage')
  @Audited('SavedReport')
  @ApiOperation({ summary: 'Update a saved report or its schedule' })
  updateSaved(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: UpdateSavedReportDto) {
    return this.reports.updateSaved(principal, id, dto);
  }

  @Delete('saved/:id')
  @RequirePermissions('reports.manage')
  @Audited('SavedReport')
  @ApiOperation({ summary: 'Delete a saved report' })
  removeSaved(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.reports.removeSaved(principal, id);
  }

  @Post('saved/:id/run')
  @RequirePermissions('reports.view')
  @Audited('ReportRun')
  @ApiOperation({ summary: 'Run a saved report and record the run' })
  runSaved(@CurrentPrincipal() principal: Principal, @Param('id') id: string, @Body() dto: RunSavedReportDto) {
    return this.reports.runSaved(principal, id, dto as ReportQueryDto);
  }

  @Get('runs')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Recent report runs for the company' })
  runs(@Query() query: ReportRunQueryDto) {
    return this.reports.listRuns(query);
  }

  @Post('export')
  @RequirePermissions('reports.view')
  @Audited('ReportRun')
  @ApiOperation({
    summary: 'Export a report (async-style: records a run and returns the payload)',
    description:
      'Runs the report synchronously, records a ReportRun with its row count and returns the data set with the requested format.',
  })
  export(@CurrentPrincipal() principal: Principal, @Body() dto: ReportExportDto) {
    return this.reports.requestExport(principal, dto);
  }

  @Get(':type')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Run a report (json payload or csv/xlsx/pdf download)' })
  @ApiQuery({ name: 'from', required: false, example: '2026-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-12-31' })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv', 'xlsx', 'pdf'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async run(
    @CurrentPrincipal() principal: Principal,
    @Param('type') type: string,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown> | StreamableFile> {
    const reportType = type.toUpperCase() as ReportType;
    if ((query.format ?? 'json') === 'json') {
      const result = await this.reports.run(principal, reportType, query);
      return { type: reportType, format: 'json', ...result };
    }

    const file = await this.reports.exportFile(principal, reportType, query);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Content-Length', String(file.buffer.byteLength));
    return new StreamableFile(file.buffer);
  }
}
