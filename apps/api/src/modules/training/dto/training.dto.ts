import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CertificationStatus, EnrollmentStatus } from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** Mirrors the `LearningPlanStatus` Prisma enum. */
export const LEARNING_PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type LearningPlanStatusValue = (typeof LEARNING_PLAN_STATUSES)[number];

const booleanFlag = () => Transform(({ value }) => value === 'true' || value === true);

// ── Courses ─────────────────────────────────────────────────────────────────

export class CourseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Include courses that were deactivated' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateCourseDto {
  @ApiProperty({ example: 'GDPR awareness' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ example: 4.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1000)
  durationHours?: number;

  @ApiPropertyOptional({ description: 'Required for every employee (drives compliance reporting)' })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Validity of the completion certificate, in months' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  validityMonths?: number;

  @ApiPropertyOptional({ description: 'Skill ids developed by this course', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  skillIds?: string[];
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Assignments ─────────────────────────────────────────────────────────────

export class AssignmentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: EnrollmentStatus })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @ApiPropertyOptional({ description: 'Only assignments past their due date and not completed' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  overdue?: boolean;
}

export class CreateAssignmentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  employeeIds!: string[];

  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional({ enum: EnrollmentStatus, description: 'IN_PROGRESS starts the course, COMPLETED finishes it' })
  @IsOptional()
  @IsEnum(EnrollmentStatus)
  status?: EnrollmentStatus;

  @ApiPropertyOptional({ example: 92.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  score?: number;

  @ApiPropertyOptional({ description: 'Document holding the certificate' })
  @IsOptional()
  @IsUUID()
  certificateDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

// ── Certifications ──────────────────────────────────────────────────────────

export class CertificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: CertificationStatus })
  @IsOptional()
  @IsEnum(CertificationStatus)
  status?: CertificationStatus;
}

export class CreateCertificationDto {
  @ApiPropertyOptional({ description: 'Defaults to the caller’s own employee record' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  issuer?: string;

  @ApiProperty({ example: '2025-04-01' })
  @IsDateString()
  issuedDate!: string;

  @ApiPropertyOptional({ example: '2028-04-01' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateCertificationDto extends PartialType(CreateCertificationDto) {
  @ApiPropertyOptional({ enum: CertificationStatus, description: 'REVOKED certifies the certification was withdrawn' })
  @IsOptional()
  @IsEnum(CertificationStatus)
  status?: CertificationStatus;
}

// ── Skills ──────────────────────────────────────────────────────────────────

export class SkillQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

export class CreateSkillDto {
  @ApiProperty({ example: 'TypeScript' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;
}

export class SkillMatrixQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

// ── Learning plans ──────────────────────────────────────────────────────────

export class LearningPlanQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: LEARNING_PLAN_STATUSES })
  @IsOptional()
  @IsIn(LEARNING_PLAN_STATUSES)
  status?: LearningPlanStatusValue;
}

export class CreateLearningPlanDto {
  @ApiPropertyOptional({ description: 'Defaults to the caller’s own employee record' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;
}

export class CreateLearningPlanItemDto {
  @ApiProperty()
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateLearningPlanItemDto {
  @ApiProperty({ enum: EnrollmentStatus })
  @IsEnum(EnrollmentStatus)
  status!: EnrollmentStatus;
}
