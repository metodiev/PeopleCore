import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  MinLength,
} from 'class-validator';
import { CalendarEventType, CalendarType, EventVisibility } from '@peoplecore/shared';

const ATTENDEE_STATUSES = ['ACCEPTED', 'DECLINED', 'TENTATIVE'] as const;

export class CreateCalendarDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: CalendarType, default: 'COMPANY' })
  @IsOptional()
  @IsIn(CalendarType)
  type?: (typeof CalendarType)[number];

  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional({ description: 'Required for PERSONAL calendars owned by somebody else' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Read-only calendars accept no event mutations' })
  @IsOptional()
  @IsBoolean()
  isReadOnly?: boolean;
}

export class UpdateCalendarDto extends PartialType(CreateCalendarDto) {}

export class CalendarEventQueryDto {
  @ApiPropertyOptional({ example: '2026-07-01', description: 'Inclusive range start (defaults to today)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-07-31', description: 'Range end (defaults to 42 days after `from`)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ type: [String], description: 'Restrict to these calendar ids' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsUUID('4', { each: true })
  calendarIds?: string[];

  @ApiPropertyOptional({ description: 'Only events organised by or inviting this employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class CreateCalendarEventDto {
  @ApiPropertyOptional({ description: 'Defaults to the default company calendar' })
  @IsOptional()
  @IsUUID()
  calendarId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: CalendarEventType, default: 'EVENT' })
  @IsOptional()
  @IsIn(CalendarEventType)
  type?: (typeof CalendarEventType)[number];

  @ApiProperty({ example: '2026-07-01T09:00:00.000Z' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ example: '2026-07-01T10:00:00.000Z' })
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ enum: EventVisibility, default: 'TENANT' })
  @IsOptional()
  @IsIn(EventVisibility)
  visibility?: (typeof EventVisibility)[number];

  @ApiPropertyOptional({ description: 'Defaults to the caller’s employee record' })
  @IsOptional()
  @IsUUID()
  organizerEmployeeId?: string;

  @ApiPropertyOptional({ description: 'RFC 5545 recurrence rule, stored as-is', example: 'FREQ=WEEKLY;COUNT=4' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  recurrenceRule?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attendeeEmployeeIds?: string[];
}

export class UpdateCalendarEventDto extends PartialType(CreateCalendarEventDto) {}

export class RespondToEventDto {
  @ApiProperty({ enum: ATTENDEE_STATUSES })
  @IsIn(ATTENDEE_STATUSES)
  status!: (typeof ATTENDEE_STATUSES)[number];
}

export class HolidayQueryDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
