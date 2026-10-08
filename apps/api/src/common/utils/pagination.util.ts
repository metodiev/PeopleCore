import type { Paginated, PaginationMeta } from '@peoplecore/shared';

export interface PaginationInput {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export interface QueryOptions {
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'>;
}

/**
 * Builds Prisma skip/take/orderBy from query parameters. `allowedSortFields`
 * prevents ordering by arbitrary (potentially unindexed or sensitive) columns.
 */
export function buildQueryOptions(
  input: PaginationInput,
  allowedSortFields: readonly string[],
  defaultSort: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' },
): QueryOptions {
  const page = Math.max(1, Number(input.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize) || DEFAULT_PAGE_SIZE));
  const sortBy = input.sortBy && allowedSortFields.includes(input.sortBy) ? input.sortBy : undefined;
  const sortOrder = input.sortOrder === 'asc' ? 'asc' : 'desc';
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: sortBy ? { [sortBy]: sortOrder } : defaultSort,
  };
}

export function pageNumber(input: PaginationInput): number {
  return Math.max(1, Number(input.page) || 1);
}

export function pageSizeOf(input: PaginationInput): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.pageSize) || DEFAULT_PAGE_SIZE));
}

export function paginate<T>(data: T[], total: number, input: PaginationInput): Paginated<T> {
  const page = pageNumber(input);
  const pageSize = pageSizeOf(input);
  const meta: PaginationMeta = {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize) || 1,
  };
  return { data, meta };
}
