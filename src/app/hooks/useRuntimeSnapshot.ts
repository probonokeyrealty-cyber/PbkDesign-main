import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildRuntimeWebSocketUrl,
  buildRuntimeHeaders,
  getRuntimeConfig,
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
let runtimeSnapshotStreamScope = '';
let runtimeSnapshotStreamGeneration = 0;
let runtimeSnapshotStreamAt = 0;
let runtimeSnapshotReadAt = 0;
let runtimeSnapshotReadScope = '';
let lastReconnectEvent: Event | null = null;

const FALLBACK_POLL_MS = 15_000;
const STREAM_SAFETY_POLL_MS = 60_000;
type SnapshotRead = {
  snapshot: RuntimeSnapshot;
  quotas: RuntimeQuotas | null;
  tooling: RuntimeToolingStatus | null;
};
type PendingSnapshotRead = { scope: string; id: number; promise: Promise<SnapshotRead> };
let pendingSnapshotRead: PendingSnapshotRead | null = null;
let snapshotReadId = 0;
type SnapshotMetadata = Pick<SnapshotRead, 'quotas' | 'tooling'>;
const snapshotMetadataListeners = new Set<(read: SnapshotMetadata) => void>();
let recentSnapshotRead: { scope: string; at: number; value: SnapshotRead } | null = null;
let latestStreamSnapshot: RuntimeSnapshot | null = null;
let streamRevision = 0;

function runtimeSnapshotScope() {
  // Reads may be shared only inside the same tab, endpoint and authority.
  return JSON.stringify([getRuntimeConfig().endpoint, buildRuntimeHeaders()]);
}

async function readRuntimeSnapshot(): Promise<SnapshotRead> {
  const scope = runtimeSnapshotScope();
  if (
    recentSnapshotRead?.scope === scope &&
    Date.now() - recentSnapshotRead.at < FALLBACK_POLL_MS
  ) {
    return structuredClone(recentSnapshotRead.value);
  }
  if (!pendingSnapshotRead || pendingSnapshotRead.scope !== scope) {
    const revision = streamRevision;
    const pending: PendingSnapshotRead = {
      scope,
      id: ++snapshotReadId,
      promise: Promise.all([
        fetchRuntimeState(),
        fetchRuntimeQuotas().catch(() => null),
        fetchRuntimeToolingStatus().catch(() => null),
      ]).then(([snapshot, quotas, tooling]) => {
        if (runtimeSnapshotScope() !== scope)
          throw new Error('Your PBK session changed. Refresh to reconnect.');
        const value = {
          snapshot:
            streamRevision !== revision &&
            runtimeSnapshotStreamScope === scope &&
            latestStreamSnapshot
              ? latestStreamSnapshot
              : snapshot,
          quotas,
          tooling,
        };
        // Only automatic reads reuse this bounded window. Explicit refreshes invalidate it.
        if (pendingSnapshotRead === pending) {
          runtimeSnapshotReadAt = Date.now();
          runtimeSnapshotReadScope = scope;
          recentSnapshotRead = { scope, at: Date.now(), value };
          for (const listener of snapshotMetadataListeners)
            listener(structuredClone({ quotas, tooling }));
        }
        return value;
      }),
    };
    pendingSnapshotRead = pending;
    // Failures are never cached and an older read cannot clear a newer request.
    void pending.promise
      .finally(() => {
        if (pendingSnapshotRead === pending) pendingSnapshotRead = null;
      })
      .catch(() => {});
  }
  const pending = pendingSnapshotRead;
  try {
    const value = await pending.promise;
    if (runtimeSnapshotScope() !== scope)
      throw new Error('Your PBK session changed. Refresh to reconnect.');
    // A forced refresh in another consumer supersedes this response too.
    if (pending.id !== snapshotReadId) return readRuntimeSnapshot();
    return structuredClone(value);
  } catch (error) {
    if (pending.id !== snapshotReadId && runtimeSnapshotScope() === scope) {
      return readRuntimeSnapshot();
    }
    throw error;
  }
}

function notifyRuntimeSnapshotListeners(snapshot: RuntimeSnapshot) {
  runtimeSnapshotStreamAt = Date.now();
  streamRevision += 1;
  latestStreamSnapshot = snapshot;
  if (recentSnapshotRead?.scope === runtimeSnapshotStreamScope)
    recentSnapshotRead.value.snapshot = snapshot;
  for (const listener of runtimeSnapshotListeners) {
    listener(snapshot);
  }
}

function closeRuntimeSnapshotStream() {
  runtimeSnapshotStreamGeneration += 1;
  runtimeSnapshotStreamAt = 0;
  runtimeSnapshotStreamScope = '';
  latestStreamSnapshot = null;
  recentSnapshotRead = null;
  pendingSnapshotRead = null;
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
  const scope = runtimeSnapshotScope();
  if (runtimeSnapshotStreamScope && runtimeSnapshotStreamScope !== scope)
    closeRuntimeSnapshotStream();
  if (!runtimeSnapshotListeners.size || runtimeSnapshotStreamStarting) return;
  if (
    runtimeSnapshotSocket &&
    (runtimeSnapshotSocket.readyState === WebSocket.CONNECTING ||
      runtimeSnapshotSocket.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  runtimeSnapshotStreamStarting = true;
  runtimeSnapshotStreamScope = scope;
  const generation = runtimeSnapshotStreamGeneration;
  try {
    const response = await createRuntimeStateStreamSessionRequest();
    if (
      generation !== runtimeSnapshotStreamGeneration ||
      !runtimeSnapshotListeners.size ||
      runtimeSnapshotScope() !== scope
    )
      return;
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
      if (runtimeSnapshotSocket !== socket || runtimeSnapshotScope() !== scope) return;
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
      if (runtimeSnapshotSocket !== socket) return;
      runtimeSnapshotSocket = null;
      runtimeSnapshotStreamAt = 0;
      runtimeSnapshotRetryCount += 1;
      scheduleRuntimeSnapshotReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  } catch {
    if (generation !== runtimeSnapshotStreamGeneration) return;
    runtimeSnapshotRetryCount += 1;
    scheduleRuntimeSnapshotReconnect();
  } finally {
    if (generation === runtimeSnapshotStreamGeneration) runtimeSnapshotStreamStarting = false;
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

export function useRuntimeSnapshot(pollMs = 5000, reportFirstFailure = false) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [quotas, setQuotas] = useState<RuntimeQuotas | null>(null);
  const [tooling, setTooling] = useState<RuntimeToolingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const failuresRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const snapshotRevisionRef = useRef(0);
  const readRevisionRef = useRef(0);
  const hasHydratedRef = useRef(false);
  const latestSnapshotRef = useRef<RuntimeSnapshot | null>(null);

  const applySnapshot = useCallback((nextSnapshot: RuntimeSnapshot) => {
    snapshotRevisionRef.current += 1;
    latestSnapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    failuresRef.current = 0;
    hasHydratedRef.current = true;
    setError('');
    setLoading(false);
  }, []);

  const applyMetadata = useCallback((next: SnapshotMetadata) => {
    setQuotas(next.quotas);
    setTooling(next.tooling);
  }, []);

  const loadSnapshot = useCallback(async () => {
    const revision = ++snapshotRevisionRef.current;
    const readRevision = ++readRevisionRef.current;
    try {
      const next = await readRuntimeSnapshot();
      if (readRevision === readRevisionRef.current) {
        applyMetadata(next);
      }
      if (revision === snapshotRevisionRef.current) {
        applySnapshot(next.snapshot);
      }
      return latestSnapshotRef.current || next.snapshot;
    } catch (nextError) {
      if (revision !== snapshotRevisionRef.current) throw nextError;
      failuresRef.current += 1;
      const message =
        nextError instanceof Error ? nextError.message : 'Could not load PBK runtime.';
      if (reportFirstFailure || !hasHydratedRef.current || failuresRef.current >= 4) {
        setError(message);
      } else {
        setError('');
      }
      throw nextError;
    } finally {
      if (revision === snapshotRevisionRef.current) setLoading(false);
    }
  }, [applySnapshot, applyMetadata, reportFirstFailure]);

  const refresh = useCallback(() => {
    pendingSnapshotRead = null;
    recentSnapshotRead = null;
    return loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    snapshotMetadataListeners.add(applyMetadata);
    const unsubscribe = subscribeRuntimeSnapshotStream(applySnapshot);
    return () => {
      snapshotMetadataListeners.delete(applyMetadata);
      unsubscribe();
    };
  }, [applySnapshot, applyMetadata]);

  useEffect(() => {
    let cancelled = false;
    let hydrationGeneration = 0;
    const baseDelay = Math.max(FALLBACK_POLL_MS, pollMs);
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
      if (!failuresRef.current) return baseDelay;
      return Math.max(
        baseDelay,
        Math.min(60000, Math.round(baseDelay * Math.pow(1.6, failuresRef.current)))
      );
    };

    const hydrate = async (immediate = false) => {
      const generation = ++hydrationGeneration;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void startRuntimeSnapshotStream();
      try {
        const scope = runtimeSnapshotScope();
        const freshStream =
          runtimeSnapshotStreamScope === scope &&
          runtimeSnapshotStreamAt > 0 &&
          Date.now() - runtimeSnapshotStreamAt < 30_000;
        const recentRead =
          runtimeSnapshotReadScope === scope &&
          runtimeSnapshotReadAt > 0 &&
          Date.now() - runtimeSnapshotReadAt < STREAM_SAFETY_POLL_MS;
        if (immediate || !freshStream || !recentRead || failuresRef.current) await loadSnapshot();
      } catch {
        // refresh already stores the visible error state.
      }
      if (!cancelled && generation === hydrationGeneration) {
        timerRef.current = window.setTimeout(() => void hydrate(), getNextDelay());
      }
    };

    if (!cancelled) void hydrate(true);

    const reconnectNow = (event: Event) => {
      if (cancelled) return;
      if (event !== lastReconnectEvent) {
        lastReconnectEvent = event;
        pendingSnapshotRead = null;
        recentSnapshotRead = null;
      }
      if (timerRef.current) window.clearTimeout(timerRef.current);
      failuresRef.current = 0;
      void hydrate(true);
    };
    const reconnectWhenVisible = (event: Event) => {
      if (!document.hidden) reconnectNow(event);
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
  }, [pollMs, loadSnapshot]);

  return {
    snapshot,
    quotas,
    tooling,
    loading,
    error,
    refresh,
  };
}
