import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Entity groups global search can return. */
export const SEARCH_ENTITY_TYPES = [
  'employees',
  'departments',
  'documents',
  'requests',
  'assets',
  'leaveRequests',
  'positions',
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export class SearchQueryDto {
  @ApiProperty({ example: 'ivan', description: 'Free-text query (minimum 2 characters)' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({
    enum: SEARCH_ENTITY_TYPES,
    description: 'Comma-separated entity groups; defaults to every group the caller may see',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(SEARCH_ENTITY_TYPES.length)
  @IsIn(SEARCH_ENTITY_TYPES, { each: true })
  types?: SearchEntityType[];

  @ApiPropertyOptional({ minimum: 1, maximum: 25, default: 5, description: 'Maximum hits per entity group' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;
}
