import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRuntimeQuotas,
  fetchRuntimeState,
  fetchRuntimeToolingStatus,
  RuntimeQuotas,
  RuntimeSnapshot,
  RuntimeToolingStatus,
} from '../utils/runtimeBridge';

export function useRuntimeSnapshot(pollMs = 12000) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [quotas, setQuotas] = useState<RuntimeQuotas | null>(null);
  const [tooling, setTooling] = useState<RuntimeToolingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const failuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const latestSnapshotRef = useRef<RuntimeSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return latestSnapshotRef.current;
    inFlightRef.current = true;
    try {
      const [nextSnapshot, nextQuotas, nextTooling] = await Promise.all([
        fetchRuntimeState(),
        fetchRuntimeQuotas().catch(() => null),
        fetchRuntimeToolingStatus().catch(() => null),
      ]);
      latestSnapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setQuotas(nextQuotas);
      setTooling(nextTooling);
      failuresRef.current = 0;
      hasHydratedRef.current = true;
      setError('');
      return nextSnapshot;
    } catch (nextError) {
      failuresRef.current += 1;
      const message = nextError instanceof Error ? nextError.message : 'Could not load PBK runtime.';
      if (!hasHydratedRef.current || failuresRef.current >= 4) {
        setError(message);
      } else {
        setError('');
      }
      throw nextError;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const getNextDelay = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return Math.max(30000, pollMs);
      if (typeof document !== 'undefined' && document.hidden) return Math.max(30000, pollMs);
      if (!failuresRef.current) return pollMs;
      return Math.min(60000, Math.round(pollMs * Math.pow(1.6, failuresRef.current)));
    };

    const hydrate = async () => {
      try {
        await refresh();
      } catch {
        // refresh already stores the visible error state.
      }
      if (!cancelled) {
        timerRef.current = window.setTimeout(hydrate, getNextDelay());
      }
    };

    if (!cancelled) hydrate();

    const reconnectNow = () => {
      if (cancelled) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      failuresRef.current = 0;
      hydrate();
    };
    const reconnectWhenVisible = () => {
      if (!document.hidden) reconnectNow();
    };

    window.addEventListener('online', reconnectNow);
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener('online', reconnectNow);
      document.removeEventListener('visibilitychange', reconnectWhenVisible);
    };
  }, [pollMs, refresh]);

  return {
    snapshot,
    quotas,
    tooling,
    loading,
    error,
    refresh,
  };
}
