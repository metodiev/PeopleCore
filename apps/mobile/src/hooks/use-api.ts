import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueryResult<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  refetch: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Small data-fetching hook: tracks loading/refreshing/error state and
 * re-runs the fetcher when `deps` change. No global cache — screens refetch
 * after mutations, which matches the API's freshness expectations.
 */
export function useApiQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (!mounted.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught);
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run('initial');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    error,
    loading,
    refreshing,
    refetch: () => run('refresh'),
    refresh: () => run('refresh'),
  };
}

export interface ActionState {
  pending: boolean;
  error: unknown;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  reset: () => void;
}

/** Tracks a single in-flight mutation (submit buttons, approvals, punches). */
export function useAction(): ActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      return result;
    } catch (caught) {
      if (mounted.current) setError(caught);
      return undefined;
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);

  return { pending, error, run, reset: () => setError(null) };
}

/** Debounces fast-changing values (search fields). */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
