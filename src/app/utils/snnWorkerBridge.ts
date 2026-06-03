export type SearchCognitionResult = {
  snnSpikeInjection?: Record<string, unknown> | null;
  symbolicFacts?: Array<Record<string, unknown>>;
};

export const PBK_WEB_SEARCH_SPIKE_VERSION = 'pbk-web-search-spikes-v1';
const SNN_STORAGE_PREFIX = 'pbk:snn:';

export type SnnNetworkSnapshot = Record<string, unknown> & {
  tick?: number;
  size?: number;
  lastSpikes?: number[];
  symbolicFacts?: Array<Record<string, unknown>>;
  activeNeurons?: Array<Record<string, unknown>>;
};

export type PbkSnnWorker = Worker & {
  pbkAgentId?: string;
  pbkLastSnapshot?: SnnNetworkSnapshot | null;
  pbkLastError?: string;
};

export function getSnnStorageKey(agentId: string) {
  return `${SNN_STORAGE_PREFIX}${String(agentId || 'agent')}:snapshot`;
}

function getBrowserStorage() {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function loadPersistedSnnSnapshot(agentId: string): SnnNetworkSnapshot | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(getSnnStorageKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function persistSnnSnapshot(
  agentId: string,
  snapshot: SnnNetworkSnapshot | null | undefined
) {
  if (!snapshot) return false;
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.setItem(getSnnStorageKey(agentId), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function createPbkSnnWorker(agentId: string, options: Record<string, unknown> = {}) {
  if (typeof Worker === 'undefined') return null;
  const restoredSnapshot =
    (options.restoredSnapshot as SnnNetworkSnapshot | undefined) ||
    loadPersistedSnnSnapshot(agentId);
  const worker = new Worker(new URL('../agents/snn/agentBrain.worker.js', import.meta.url), {
    type: 'module',
    name: `pbk-${agentId}-snn`,
  }) as PbkSnnWorker;
  worker.pbkAgentId = agentId;
  worker.pbkLastSnapshot = restoredSnapshot || null;
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data || {};
    if (message.snapshot && typeof message.snapshot === 'object') {
      worker.pbkLastSnapshot = message.snapshot;
      persistSnnSnapshot(agentId, message.snapshot);
    }
    if (message.type === 'error') {
      worker.pbkLastError = String(message.error || 'SNN worker error');
      console.error('[pbk-snn-worker]', worker.pbkLastError);
    }
  };
  worker.onerror = (event: ErrorEvent) => {
    worker.pbkLastError = event.message || 'SNN worker crashed';
    console.error('[pbk-snn-worker]', worker.pbkLastError, event);
  };
  worker.postMessage({
    type: 'init',
    agentId,
    options: {
      ...options,
      restoredSnapshot,
    },
  });
  return worker;
}

export function extractSearchCognition(result: SearchCognitionResult) {
  const symbolicFacts = Array.isArray(result?.symbolicFacts) ? result.symbolicFacts : [];
  return {
    spikeInjection:
      result?.snnSpikeInjection ||
      (symbolicFacts.length
        ? {
            version: PBK_WEB_SEARCH_SPIKE_VERSION,
            source: 'web-search',
            neuronIds: [],
            strengths: [],
          }
        : null),
    symbolicFacts,
  };
}

export function injectSearchCognition(
  worker: Worker | null | undefined,
  result: SearchCognitionResult
) {
  const { spikeInjection, symbolicFacts } = extractSearchCognition(result);
  if (!worker || !spikeInjection) return false;
  const version = spikeInjection.version;
  if (version && version !== PBK_WEB_SEARCH_SPIKE_VERSION) return false;
  worker.postMessage({
    type: 'inject_spikes',
    data: {
      ...spikeInjection,
      symbolicFacts,
    },
    symbolicFacts,
  });
  return true;
}

export function requestNetworkSnapshot(worker: Worker | null | undefined) {
  if (!worker) return false;
  worker.postMessage({ type: 'get_state' });
  return true;
}

export function restoreNetworkSnapshot(
  worker: Worker | null | undefined,
  snapshot: SnnNetworkSnapshot | null | undefined
) {
  if (!worker || !snapshot) return false;
  worker.postMessage({ type: 'restore_state', snapshot });
  return true;
}

export function getNetworkSnapshot(worker: PbkSnnWorker | null | undefined) {
  return worker?.pbkLastSnapshot || null;
}

export function getNetworkError(worker: PbkSnnWorker | null | undefined) {
  return worker?.pbkLastError || '';
}

export function disposePbkSnnWorkers(workers: Array<Worker | null | undefined>) {
  for (const worker of workers) {
    worker?.terminate();
  }
}
