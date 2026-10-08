import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Re-runs a fetch when the screen regains focus (for example after a modal
 * pushed on top of it closes). The first focus is skipped because the query
 * already fetched on mount.
 */
export function useRefreshOnFocus(refetch: () => void | Promise<void>): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const firstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refetchRef.current();
    }, []),
  );
}
