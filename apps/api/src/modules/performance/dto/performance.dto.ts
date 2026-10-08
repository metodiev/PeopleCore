import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  ValidateNested,
} from 'class-validator';
import {
  GoalPriority,
  GoalStatus,
  GoalType,
  ReviewCycleStatus,
  ReviewStatus,
  ReviewType,
} from '@peoplecore/shared';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

/** Mirrors the `FeedbackType` / `FeedbackVisibility` Prisma enums. */
export const FEEDBACK_TYPES = ['COMMENT', 'PRAISE', 'CONCERN'] as const;
export type FeedbackTypeValue = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_VISIBILITIES = ['HR_ONLY', 'MANAGER', 'EMPLOYEE', 'PUBLIC'] as const;
export type FeedbackVisibilityValue = (typeof FEEDBACK_VISIBILITIES)[number];

const booleanFlag = () => Transform(({ value }) => value === 'true' || value === true);

// ── Review cycles ───────────────────────────────────────────────────────────

export class ReviewCycleQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReviewCycleStatus })
  @IsOptional()
  @IsEnum(ReviewCycleStatus)
  status?: ReviewCycleStatus;
}

export class CreateReviewCycleDto {
  @ApiProperty({ example: 'H1 2026 review' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includesSelfReview?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includesPeerReview?: boolean;

  @ApiPropertyOptional({ enum: ReviewCycleStatus, default: 'DRAFT' })
  @IsOptional()
  @IsEnum(ReviewCycleStatus)
  status?: ReviewCycleStatus;
}

export class UpdateReviewCycleDto extends PartialType(CreateReviewCycleDto) {}

// ── Reviews ─────────────────────────────────────────────────────────────────

export class ReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cycleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ enum: ReviewType })
  @IsOptional()
  @IsEnum(ReviewType)
  type?: ReviewType;

  @ApiPropertyOptional({ description: 'Reviews the caller is the reviewer of' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  mineAsReviewer?: boolean;

  @ApiPropertyOptional({ description: 'Reviews about the caller' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  mineAsSubject?: boolean;
}

export class CreateReviewDto {
  @ApiProperty()
  @IsUUID()
  cycleId!: string;

  @ApiProperty({ description: 'Employee being reviewed' })
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ description: 'Reviewer employee; defaults to the subject (SELF) or their manager (MANAGER)' })
  @IsOptional()
  @IsUUID()
  reviewerId?: string;

  @ApiPropertyOptional({ enum: ReviewType, default: 'MANAGER' })
  @IsOptional()
  @IsEnum(ReviewType)
  type?: ReviewType;
}

export class SubmitReviewDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  overallRating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  improvements?: string;

  @ApiPropertyOptional({ description: 'false saves the draft as IN_PROGRESS instead of SUBMITTED', default: true })
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

// ── Goals / OKRs / KPIs ─────────────────────────────────────────────────────

export class GoalQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ enum: GoalType })
  @IsOptional()
  @IsEnum(GoalType)
  type?: GoalType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewCycleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Only goals past their due date and not completed' })
  @IsOptional()
  @booleanFlag()
  @IsBoolean()
  overdue?: boolean;
}

export class CreateKeyResultDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsNumber()
  targetValue!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  currentValue?: number;

  @ApiPropertyOptional({ example: '%' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateKeyResultDto extends PartialType(CreateKeyResultDto) {}

export class CreateGoalDto {
  @ApiPropertyOptional({ description: 'Defaults to the caller’s own employee record' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: GoalType, default: 'GOAL' })
  @IsOptional()
  @IsEnum(GoalType)
  type?: GoalType;

  @ApiPropertyOptional({ enum: GoalStatus, default: 'DRAFT' })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ enum: GoalPriority, default: 'MEDIUM' })
  @IsOptional()
  @IsEnum(GoalPriority)
  priority?: GoalPriority;

  @ApiPropertyOptional({ description: 'Parent goal for cascading objectives' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Company / department objective this goal is aligned to' })
  @IsOptional()
  @IsUUID()
  alignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Relative weight for weighted progress roll-ups' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewCycleId?: string;

  @ApiPropertyOptional({ type: [CreateKeyResultDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateKeyResultDto)
  keyResults?: CreateKeyResultDto[];
}

export class UpdateGoalDto extends PartialType(CreateGoalDto) {}

export class UpdateGoalProgressDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ description: 'Roll the goal progress up from its key results', default: false })
  @IsOptional()
  @IsBoolean()
  recomputeFromKeyResults?: boolean;
}

// ── Feedback ────────────────────────────────────────────────────────────────

export class FeedbackQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to the caller’s own feedback' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: FEEDBACK_TYPES })
  @IsOptional()
  @IsIn(FEEDBACK_TYPES)
  type?: FeedbackTypeValue;

  @ApiPropertyOptional({ enum: FEEDBACK_VISIBILITIES })
  @IsOptional()
  @IsIn(FEEDBACK_VISIBILITIES)
  visibility?: FeedbackVisibilityValue;
}

export class CreateFeedbackDto {
  @ApiProperty({ description: 'Employee the feedback is about' })
  @IsUUID()
  subjectEmployeeId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  message!: string;

  @ApiPropertyOptional({ enum: FEEDBACK_TYPES, default: 'COMMENT' })
  @IsOptional()
  @IsIn(FEEDBACK_TYPES)
  type?: FeedbackTypeValue;

  @ApiPropertyOptional({ enum: FEEDBACK_VISIBILITIES, default: 'MANAGER' })
  @IsOptional()
  @IsIn(FEEDBACK_VISIBILITIES)
  visibility?: FeedbackVisibilityValue;

  @ApiPropertyOptional({ description: 'Hides the author from everyone but HR' })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewId?: string;
}
