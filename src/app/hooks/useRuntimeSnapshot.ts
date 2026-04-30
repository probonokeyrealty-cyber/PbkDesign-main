import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    try {
      const [nextSnapshot, nextQuotas, nextTooling] = await Promise.all([
        fetchRuntimeState(),
        fetchRuntimeQuotas().catch(() => null),
        fetchRuntimeToolingStatus().catch(() => null),
      ]);
      setSnapshot(nextSnapshot);
      setQuotas(nextQuotas);
      setTooling(nextTooling);
      setError('');
      return nextSnapshot;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load PBK runtime.');
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        await refresh();
      } catch {
        // refresh already stores the visible error state.
      }
    };

    if (!cancelled) hydrate();
    const timer = window.setInterval(() => {
      if (!cancelled) hydrate();
    }, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
