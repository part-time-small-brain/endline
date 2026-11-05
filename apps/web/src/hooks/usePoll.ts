import { useCallback, useEffect, useRef, useState } from "react";

interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
}

export function usePoll<T>(load: (() => Promise<T>) | null, intervalMs: number, key: string): Polled<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key });
  const loadRef = useRef(load);
  loadRef.current = load;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    const run = () => {
      const current = loadRef.current;
      if (!current) return;
      current().then(
        (data) => alive && setState({ key, data }),
        (error: unknown) => alive && setState((s) => ({ ...s, key, error: error instanceof Error ? error.message : String(error) })),
      );
    };
    run();
    const timer = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [key, intervalMs, tick]);

  const fresh = state.key === key;
  return { data: fresh ? state.data : undefined, error: fresh ? state.error : undefined, reload };
}
