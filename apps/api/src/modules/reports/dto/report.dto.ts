import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportFormat, ReportType, ScheduledFrequency } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { REPORT_FILE_FORMATS, type ReportFileFormat } from '../report.types.js';

const toUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toUpperCase() : value;

const toLowerFormat = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class ReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01', description: 'Period start (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Period end (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ description: 'Filters rows by status where the report supports it' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ description: 'Include terminated employees (EMPLOYEES report)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeTerminated?: boolean;

  @ApiPropertyOptional({ enum: REPORT_FILE_FORMATS, default: 'json' })
  @IsOptional()
  @Transform(toLowerFormat)
  @IsIn(REPORT_FILE_FORMATS)
  format?: ReportFileFormat;
}

export class ReportExportDto {
  @ApiProperty({ enum: ReportType })
  @Transform(toUpper)
  @IsIn(ReportType)
  type!: ReportType;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Period start (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Period end (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;

  @ApiPropertyOptional({ description: 'Include terminated employees (EMPLOYEES report)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeTerminated?: boolean;

  @ApiPropertyOptional({ enum: REPORT_FILE_FORMATS, default: 'json' })
  @IsOptional()
  @Transform(toLowerFormat)
  @IsIn(REPORT_FILE_FORMATS)
  format?: ReportFileFormat;

  @ApiPropertyOptional({ description: 'Rows per page when the caller does not want the full dataset', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class CreateSavedReportDto {
  @ApiProperty({ example: 'Monthly headcount' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ReportType })
  @Transform(toUpper)
  @IsIn(ReportType)
  type!: ReportType;

  @ApiPropertyOptional({ enum: ReportFormat, default: 'CSV' })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ReportFormat)
  format?: ReportFormat;

  @ApiPropertyOptional({ description: 'Frozen filter set (from/to/departmentId/locationId/status)' })
  @IsOptional()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ScheduledFrequency, description: 'Enables scheduled delivery through the notifications queue' })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ScheduledFrequency)
  scheduleFrequency?: ScheduledFrequency;

  @ApiPropertyOptional({ type: [String], description: 'E-mail recipients for scheduled delivery' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  recipients?: string[];
}

export class UpdateSavedReportDto extends PartialType(CreateSavedReportDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RunSavedReportDto {
  @ApiPropertyOptional({ description: 'Overrides the report period start' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Overrides the report period end' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Rows per page for the returned JSON payload', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class ReportRunQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportType })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ReportType)
  type?: ReportType;
}
