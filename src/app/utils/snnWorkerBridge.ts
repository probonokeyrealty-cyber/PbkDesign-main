export type SearchCognitionResult = {
  snnSpikeInjection?: Record<string, unknown> | null;
  symbolicFacts?: Array<Record<string, unknown>>;
};

export const PBK_WEB_SEARCH_SPIKE_VERSION = 'pbk-web-search-spikes-v1';

export type PbkSnnWorker = Worker & {
  pbkAgentId?: string;
};

export function createPbkSnnWorker(agentId: string, options: Record<string, unknown> = {}) {
  if (typeof Worker === 'undefined') return null;
  const worker = new Worker(new URL('../agents/snn/agentBrain.worker.js', import.meta.url), {
    type: 'module',
    name: `pbk-${agentId}-snn`,
  }) as PbkSnnWorker;
  worker.pbkAgentId = agentId;
  worker.postMessage({
    type: 'init',
    agentId,
    options,
  });
  return worker;
}

export function extractSearchCognition(result: SearchCognitionResult) {
  return {
    spikeInjection: result?.snnSpikeInjection || null,
    symbolicFacts: Array.isArray(result?.symbolicFacts) ? result.symbolicFacts : [],
  };
}

export function injectSearchCognition(worker: Worker | null | undefined, result: SearchCognitionResult) {
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

export function disposePbkSnnWorkers(workers: Array<Worker | null | undefined>) {
  for (const worker of workers) {
    worker?.terminate();
  }
}
