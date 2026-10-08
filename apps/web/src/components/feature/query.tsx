import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api.js';
import { EmptyState, ErrorState, TableSkeleton } from '../ui/feedback.js';

type QueryLike<T> = Pick<UseQueryResult<T, unknown>, 'data' | 'isPending' | 'isError' | 'error' | 'refetch'>;

export function apiErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return null;
}

/** Resolves the message to show for a failed request. */
export function useApiErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return (error) => apiErrorMessage(error) ?? t('common.error');
}

export interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  /** Rendered while the first request is in flight. */
  skeleton?: ReactNode;
  /** Rendered when the request succeeds but there is nothing to show. */
  empty?: ReactNode;
  /** Custom emptiness predicate; defaults to "the data is an empty array". */
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

/**
 * Renders the loading / error / empty / content states of a query in one
 * place so every list on every page behaves the same way.
 */
export function QueryBoundary<T>({ query, skeleton, empty, isEmpty, children }: QueryBoundaryProps<T>): ReactNode {
  const describeError = useApiErrorText();

  if (query.isPending) return skeleton ?? <TableSkeleton />;
  if (query.isError) return <ErrorState message={describeError(query.error)} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return skeleton ?? <TableSkeleton />;

  const isEmptyFn = isEmpty ?? ((data: T) => Array.isArray(data) && data.length === 0);
  if (isEmptyFn(query.data)) {
    return empty ?? <EmptyState title="—" />;
  }
  return children(query.data);
}
