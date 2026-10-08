import { describe, expect, it } from 'vitest';
import {
  buildQueryOptions,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginate,
  pageNumber,
  pageSizeOf,
} from './pagination.util.js';

const SORTABLE = ['createdAt', 'lastName', 'hireDate'] as const;

describe('buildQueryOptions', () => {
  it('applies defaults when nothing is supplied', () => {
    expect(buildQueryOptions({}, SORTABLE)).toEqual({
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('translates page/pageSize into skip/take', () => {
    expect(buildQueryOptions({ page: 3, pageSize: 10 }, SORTABLE)).toMatchObject({ skip: 20, take: 10 });
    expect(buildQueryOptions({ page: 1, pageSize: 1 }, SORTABLE)).toMatchObject({ skip: 0, take: 1 });
  });

  it('clamps page size into the allowed range', () => {
    expect(buildQueryOptions({ pageSize: 10_000 }, SORTABLE).take).toBe(MAX_PAGE_SIZE);
    expect(buildQueryOptions({ pageSize: 0 }, SORTABLE).take).toBe(DEFAULT_PAGE_SIZE);
    expect(buildQueryOptions({ pageSize: Number.NaN }, SORTABLE).take).toBe(DEFAULT_PAGE_SIZE);
    // Out-of-range values are clamped, never passed through to the query.
    expect(buildQueryOptions({ pageSize: -5 }, SORTABLE).take).toBe(1);
    expect(buildQueryOptions({ pageSize: 50 }, SORTABLE).take).toBe(50);
  });

  it('falls back to page one for invalid page values', () => {
    expect(buildQueryOptions({ page: 0 }, SORTABLE).skip).toBe(0);
    expect(buildQueryOptions({ page: -2 }, SORTABLE).skip).toBe(0);
    expect(buildQueryOptions({ page: Number.NaN }, SORTABLE).skip).toBe(0);
  });

  it('only sorts by allow-listed fields', () => {
    expect(buildQueryOptions({ sortBy: 'lastName' }, SORTABLE).orderBy).toEqual({ lastName: 'desc' });
    expect(buildQueryOptions({ sortBy: 'lastName', sortOrder: 'asc' }, SORTABLE).orderBy).toEqual({
      lastName: 'asc',
    });
    // Not allow-listed → ignored, default ordering (and therefore no injection surface) applies.
    expect(buildQueryOptions({ sortBy: 'salary' }, SORTABLE).orderBy).toEqual({ createdAt: 'desc' });
    expect(buildQueryOptions({ sortBy: '"; drop table x' }, SORTABLE).orderBy).toEqual({ createdAt: 'desc' });
  });

  it('honours a custom default ordering', () => {
    expect(buildQueryOptions({}, SORTABLE, { hireDate: 'asc' }).orderBy).toEqual({ hireDate: 'asc' });
  });
});

describe('pagination metadata', () => {
  it('resolves page and page size with the same rules as buildQueryOptions', () => {
    expect(pageNumber({})).toBe(1);
    expect(pageNumber({ page: 4 })).toBe(4);
    expect(pageSizeOf({})).toBe(DEFAULT_PAGE_SIZE);
    expect(pageSizeOf({ pageSize: 500 })).toBe(MAX_PAGE_SIZE);
  });

  it('computes total pages and never reports zero pages for an empty result', () => {
    expect(paginate([1, 2], 2, {})).toEqual({
      data: [1, 2],
      meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
    });
    expect(paginate([], 0, {}).meta).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
    expect(paginate([], 51, { page: 2, pageSize: 25 }).meta).toEqual({
      page: 2,
      pageSize: 25,
      total: 51,
      totalPages: 3,
    });
  });
});
