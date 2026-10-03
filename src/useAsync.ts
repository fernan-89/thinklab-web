import { useCallback, useEffect, useRef, useState } from 'react';
import { ProblemError } from './api/client';

export interface AsyncState<T> {
  data: T | undefined;
  error: ProblemError | Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Runs `load` on mount and whenever `deps` change; a stale response never overwrites a newer one. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ProblemError | Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    setLoading(true);
    load().then(
      (result) => {
        if (request !== latest.current) return;
        setData(result);
        setError(undefined);
        setLoading(false);
      },
      (failure: unknown) => {
        if (request !== latest.current) return;
        setError(failure instanceof Error ? failure : new Error(String(failure)));
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
