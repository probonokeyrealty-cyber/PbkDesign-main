import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const [nextSnapshot, nextQuotas, nextTooling] = await Promise.all([
          fetchRuntimeState(),
          fetchRuntimeQuotas().catch(() => null),
          fetchRuntimeToolingStatus().catch(() => null),
        ]);
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setQuotas(nextQuotas);
        setTooling(nextTooling);
        setError('');
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Could not load PBK runtime.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();
    const timer = window.setInterval(hydrate, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return {
    snapshot,
    quotas,
    tooling,
    loading,
    error,
  };
}
