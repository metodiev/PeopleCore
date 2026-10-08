import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { HRRequestPriority, HRRequestStatus, HRRequestType } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

const booleanFlag = () => Transform(({ value }) => value === 'true' || value === true);

/** Statuses an HR agent can set from the inbox. */
export const HANDLED_REQUEST_STATUSES = ['WAITING_EMPLOYEE', 'RESOLVED', 'CLOSED', 'CANCELLED'] as const;

export class HRRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: HRRequestStatus })
  @IsOptional()
  @IsEnum(HRRequestStatus)
  status?: HRRequestStatus;

  @ApiPropertyOptional({ enum: HRRequestType })
  @IsOptional()
  @IsEnum(HRRequestType)
  type?: HRRequestType;

  @ApiPropertyOptional({ enum: HRRequestPriority })
  @IsOptional()
  @IsEnum(HRRequestPriority)
  priority?: HRRequestPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ description: 'Only tickets nobody picked up yet' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({ description: 'Only the caller’s own tickets' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class CreateHRRequestDto {
  @ApiProperty({ enum: HRRequestType })
  @IsEnum(HRRequestType)
  type!: HRRequestType;

  @ApiProperty({ example: 'Employment certificate for a mortgage application' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ enum: HRRequestPriority, default: 'NORMAL' })
  @IsOptional()
  @IsEnum(HRRequestPriority)
  priority?: HRRequestPriority;

  @ApiPropertyOptional({ example: '2026-04-15' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'HR can file a ticket on behalf of an employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class HRRequestCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ description: 'Internal notes are visible to HR only' })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class AssignHRRequestDto {
  @ApiProperty()
  @IsUUID()
  assigneeId!: string;
}

export class UpdateHRRequestStatusDto {
  @ApiProperty({ enum: HANDLED_REQUEST_STATUSES })
  @IsIn(HANDLED_REQUEST_STATUSES)
  status!: (typeof HANDLED_REQUEST_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Resolution text shown to the employee' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resolution?: string;
}

export class HRRequestStatsQueryDto {
  @ApiPropertyOptional({ description: 'Only tickets created from this date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Only tickets created up to this date' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
