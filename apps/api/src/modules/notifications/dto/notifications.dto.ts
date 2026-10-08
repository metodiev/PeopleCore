import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NOTIFICATION_EVENTS, NotificationChannel, type NotificationEvent } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only unread notifications' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NOTIFICATION_EVENTS })
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS)
  type?: NotificationEvent;
}

export class SetNotificationPreferenceDto {
  @ApiProperty({ enum: NOTIFICATION_EVENTS })
  @IsIn(NOTIFICATION_EVENTS)
  eventType!: NotificationEvent;

  @ApiProperty({ enum: NotificationChannel })
  @IsIn(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [SetNotificationPreferenceDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SetNotificationPreferenceDto)
  preferences!: SetNotificationPreferenceDto[];
}

export class RegisterPushDeviceDto {
  @ApiProperty({ description: 'Expo push token (ExponentPushToken[...])' })
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  token!: string;

  @ApiProperty({ example: 'ios' })
  @IsString()
  @MaxLength(20)
  platform!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

export class BroadcastNotificationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({
    enum: NOTIFICATION_EVENTS,
    description: 'Catalogue event used for preference resolution (defaults to `employee.welcome`)',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_EVENTS)
  type?: NotificationEvent;

  @ApiPropertyOptional({ type: [String], description: 'Role keys that receive the message' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleKeys?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Specific employees that receive the message' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({ description: 'Structured payload attached to the notification' })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
