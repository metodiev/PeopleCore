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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ConsentType, DataRequestStatus } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** Erasure strategies accepted by the erasure workflow. */
export const ERASURE_METHODS = ['ANONYMIZE', 'DELETE'] as const;
export type ErasureMethod = (typeof ERASURE_METHODS)[number];

/** Actions a retention policy can apply once the retention window elapsed. */
export const RETENTION_ACTIONS = ['DELETE', 'ANONYMIZE', 'ARCHIVE'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

/** Data types the retention engine knows how to purge. */
export const RETENTION_DATA_TYPES = ['DOCUMENT', 'NOTIFICATION', 'AUDIT_LOG', 'SESSION', 'CONSENT'] as const;
export type RetentionDataType = (typeof RETENTION_DATA_TYPES)[number];

const toUpper = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toUpperCase() : value);

export class ConsentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Employee whose consents are returned (defaults to the caller)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ConsentType })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ConsentType)
  type?: ConsentType;

  @ApiPropertyOptional({ description: 'Include revoked consents (default false)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeRevoked?: boolean;
}

export class CreateConsentDto {
  @ApiPropertyOptional({ description: 'Employee the consent belongs to (defaults to the caller)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ enum: ConsentType })
  @Transform(toUpper)
  @IsIn(ConsentType)
  type!: ConsentType;

  @ApiProperty({ description: 'True when consent is granted, false when explicitly refused' })
  @IsBoolean()
  granted!: boolean;

  @ApiProperty({ example: '2026-01', description: 'Policy version the subject agreed to' })
  @IsString()
  @MaxLength(40)
  version!: string;

  @ApiPropertyOptional({ example: 'web-onboarding', description: 'Where the consent was captured' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;
}

export class CreateDataExportDto {
  @ApiPropertyOptional({ description: 'User account the export is about' })
  @IsOptional()
  @IsUUID()
  subjectUserId?: string;

  @ApiPropertyOptional({ description: 'Employee the export is about (defaults to the caller)' })
  @IsOptional()
  @IsUUID()
  subjectEmployeeId?: string;
}

export class DataExportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DataRequestStatus })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(DataRequestStatus)
  status?: DataRequestStatus;
}

export class CreateErasureDto {
  @ApiProperty({ description: 'Employee whose data must be erased' })
  @IsUUID()
  subjectEmployeeId!: string;

  @ApiPropertyOptional({ enum: ERASURE_METHODS, default: 'ANONYMIZE' })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ERASURE_METHODS)
  method?: ErasureMethod;

  @ApiPropertyOptional({ example: 'Subject exercised the right to erasure' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DecideErasureDto {
  @ApiPropertyOptional({ enum: ERASURE_METHODS, description: 'Overrides the requested method' })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(ERASURE_METHODS)
  method?: ErasureMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ErasureQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DataRequestStatus })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(DataRequestStatus)
  status?: DataRequestStatus;
}

export class CreateRetentionPolicyDto {
  @ApiProperty({ enum: RETENTION_DATA_TYPES })
  @IsIn(RETENTION_DATA_TYPES)
  dataType!: RetentionDataType;

  @ApiProperty({ example: 3650, description: 'Days to keep the data before the action runs' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36_500)
  retentionDays!: number;

  @ApiPropertyOptional({ enum: RETENTION_ACTIONS, default: 'ANONYMIZE' })
  @IsOptional()
  @Transform(toUpper)
  @IsIn(RETENTION_ACTIONS)
  action?: RetentionAction;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRetentionPolicyDto extends PartialType(CreateRetentionPolicyDto) {}

export class ApplyRetentionDto {
  @ApiPropertyOptional({ enum: RETENTION_DATA_TYPES, isArray: true, description: 'Limit the run to specific data types' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RETENTION_DATA_TYPES.length)
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').map((entry) => entry.trim().toUpperCase()) : value))
  @IsIn(RETENTION_DATA_TYPES, { each: true })
  dataTypes?: RetentionDataType[];

  @ApiPropertyOptional({ description: 'Only report what would be affected', default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class DataRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
