import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AttendanceStatus, CorrectionStatus, PunchSource } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class PunchDto {
  @ApiProperty({ enum: PunchSource, description: 'Where the punch came from' })
  @IsEnum(PunchSource)
  source!: PunchSource;

  @ApiPropertyOptional({ description: 'Office location the punch was made at' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: 42.6977 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 23.3219 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Employee consent to store the GPS coordinates of this punch' })
  @IsOptional()
  @IsBoolean()
  gpsConsent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Employee the punch belongs to (attendance managers only)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({
    description:
      'Punch time (ISO 8601). Defaults to now; only attendance managers (HR/kiosk) may record a different time.',
  })
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class ClockOutDto extends PartialType(PunchDto) {}

export class BreakDto {
  @ApiPropertyOptional({ description: 'Employee the break belongs to (attendance managers only)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Break time (ISO 8601). Only attendance managers may backdate it.' })
  @IsOptional()
  @IsDateString()
  at?: string;
}

export class AttendanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class MissingPunchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Defaults to the last 7 days' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class SummaryQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the first day of the current month' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Defaults to today' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class CreateCorrectionDto {
  @ApiPropertyOptional({ description: 'Employee the correction belongs to (attendance managers only)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty({ example: '2026-09-30' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ example: '09:00', description: 'Corrected clock-in as HH:MM or an ISO 8601 date-time' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  requestedClockIn?: string;

  @ApiPropertyOptional({ example: '17:30', description: 'Corrected clock-out as HH:MM or an ISO 8601 date-time' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  requestedClockOut?: string;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  requestedStatus?: AttendanceStatus;

  @ApiProperty({ example: 'I forgot to clock out before leaving the office' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class CorrectionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CorrectionStatus })
  @IsOptional()
  @IsEnum(CorrectionStatus)
  status?: CorrectionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class DecideCorrectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

export class KioskPunchDto {
  @ApiProperty({ example: 'EMP-0007' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  employeeNumber!: string;

  @ApiPropertyOptional({ enum: PunchSource, default: 'KIOSK' })
  @IsOptional()
  @IsEnum(PunchSource)
  source?: PunchSource;

  @ApiPropertyOptional({
    description:
      'Shared kiosk device id. Recorded for the audit trail; device authentication is not implemented yet — ' +
      'this endpoint currently requires a signed-in user holding attendance.manage.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  gpsConsent?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Punch time (ISO 8601), defaults to now' })
  @IsOptional()
  @IsDateString()
  at?: string;
}
