import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildRuntimeWebSocketUrl,
  createRuntimeStateStreamSessionRequest,
  fetchRuntimeQuotas,
  fetchRuntimeState,
  fetchRuntimeToolingStatus,
  RuntimeQuotas,
  RuntimeSnapshot,
  RuntimeToolingStatus,
} from '../utils/runtimeBridge';

type RuntimeSnapshotListener = (snapshot: RuntimeSnapshot) => void;

const runtimeSnapshotListeners = new Set<RuntimeSnapshotListener>();
let runtimeSnapshotSocket: WebSocket | null = null;
let runtimeSnapshotStreamStarting = false;
let runtimeSnapshotRetryTimer: number | null = null;
let runtimeSnapshotRetryCount = 0;

function notifyRuntimeSnapshotListeners(snapshot: RuntimeSnapshot) {
  for (const listener of runtimeSnapshotListeners) {
    listener(snapshot);
  }
}

function closeRuntimeSnapshotStream() {
  if (runtimeSnapshotRetryTimer) {
    window.clearTimeout(runtimeSnapshotRetryTimer);
    runtimeSnapshotRetryTimer = null;
  }
  const socket = runtimeSnapshotSocket;
  runtimeSnapshotSocket = null;
  runtimeSnapshotStreamStarting = false;
  if (socket && socket.readyState <= WebSocket.OPEN) {
    socket.close();
  }
}

function scheduleRuntimeSnapshotReconnect() {
  if (typeof window === 'undefined' || !runtimeSnapshotListeners.size) return;
  if (runtimeSnapshotRetryTimer) return;
  const delay = Math.min(30_000, 1_000 * Math.pow(1.7, runtimeSnapshotRetryCount));
  runtimeSnapshotRetryTimer = window.setTimeout(() => {
    runtimeSnapshotRetryTimer = null;
    void startRuntimeSnapshotStream();
  }, delay);
}

async function startRuntimeSnapshotStream() {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (!runtimeSnapshotListeners.size || runtimeSnapshotStreamStarting) return;
  if (
    runtimeSnapshotSocket &&
    (runtimeSnapshotSocket.readyState === WebSocket.CONNECTING ||
      runtimeSnapshotSocket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  runtimeSnapshotStreamStarting = true;
  try {
    const response = await createRuntimeStateStreamSessionRequest();
    const token = response.session?.token || '';
    const wsUrl =
      response.session?.wsUrl ||
      (token ? buildRuntimeWebSocketUrl(`/ws/state?token=${encodeURIComponent(token)}`) : '');
    if (!response.ok || !wsUrl) throw new Error('state_stream_session_unavailable');

    const socket = new WebSocket(wsUrl);
    runtimeSnapshotSocket = socket;
    socket.onopen = () => {
      runtimeSnapshotRetryCount = 0;
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data || '{}')) as {
          type?: string;
          snapshot?: RuntimeSnapshot;
        };
        if (payload.type === 'state' && payload.snapshot) {
          notifyRuntimeSnapshotListeners(payload.snapshot);
        }
      } catch {
        // Ignore malformed realtime frames and keep the polling fallback alive.
      }
    };
    socket.onclose = () => {
      if (runtimeSnapshotSocket === socket) runtimeSnapshotSocket = null;
      runtimeSnapshotRetryCount += 1;
      scheduleRuntimeSnapshotReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  } catch {
    runtimeSnapshotRetryCount += 1;
    scheduleRuntimeSnapshotReconnect();
  } finally {
    runtimeSnapshotStreamStarting = false;
  }
}

function subscribeRuntimeSnapshotStream(listener: RuntimeSnapshotListener) {
  runtimeSnapshotListeners.add(listener);
  void startRuntimeSnapshotStream();
  return () => {
    runtimeSnapshotListeners.delete(listener);
    if (!runtimeSnapshotListeners.size) closeRuntimeSnapshotStream();
  };
}

export function useRuntimeSnapshot(pollMs = 5000) {
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

  const applySnapshot = useCallback((nextSnapshot: RuntimeSnapshot) => {
    latestSnapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    failuresRef.current = 0;
    hasHydratedRef.current = true;
    setError('');
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return latestSnapshotRef.current;
    inFlightRef.current = true;
    try {
      const [nextSnapshot, nextQuotas, nextTooling] = await Promise.all([
        fetchRuntimeState(),
        fetchRuntimeQuotas().catch(() => null),
        fetchRuntimeToolingStatus().catch(() => null),
      ]);
      applySnapshot(nextSnapshot);
      setQuotas(nextQuotas);
      setTooling(nextTooling);
      return nextSnapshot;
    } catch (nextError) {
      failuresRef.current += 1;
      const message =
        nextError instanceof Error ? nextError.message : 'Could not load PBK runtime.';
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
  }, [applySnapshot]);

  useEffect(() => subscribeRuntimeSnapshotStream(applySnapshot), [applySnapshot]);

  useEffect(() => {
    let cancelled = false;
    const getNextDelay = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false)
        return Math.max(60000, pollMs);
      // Respect Save-Data / metered connections (Network Information API, Chrome/Android only).
      const conn =
        typeof navigator !== 'undefined'
          ? (
              navigator as Navigator & {
                connection?: { saveData?: boolean; effectiveType?: string };
              }
            ).connection
          : undefined;
      if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g')
        return Math.max(60000, pollMs);
      if (typeof document !== 'undefined' && document.hidden) return Math.max(60000, pollMs);
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
    window.addEventListener('pbk:approval-decision', reconnectNow);
    document.addEventListener('visibilitychange', reconnectWhenVisible);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      window.removeEventListener('online', reconnectNow);
      window.removeEventListener('pbk:approval-decision', reconnectNow);
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
