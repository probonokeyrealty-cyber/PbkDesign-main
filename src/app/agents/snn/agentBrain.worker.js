import {
  applySpikeInjection,
  createLifNetwork,
  getNetworkSnapshot,
  restoreNetworkFromSnapshot,
  stepLifNetwork,
} from './lifCore.mjs';

let agentId = 'agent';
let network = createLifNetwork();

function post(type, payload = {}) {
  self.postMessage({
    type,
    agentId,
    ...payload,
  });
}

function normalizeInjection(message = {}) {
  const data = message.data && typeof message.data === 'object' ? message.data : message;
  return {
    ...data,
    symbolicFacts: Array.isArray(message.symbolicFacts)
      ? message.symbolicFacts
      : Array.isArray(data.symbolicFacts)
        ? data.symbolicFacts
        : [],
  };
}

self.onmessage = (event) => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      agentId = String(message.agentId || message.agent || agentId || 'agent');
      const options = message.options || {};
      const restoredSnapshot = options.restoredSnapshot || message.restoredSnapshot || null;
      network = restoredSnapshot
        ? restoreNetworkFromSnapshot(restoredSnapshot, options)
        : createLifNetwork(options);
      post('initialized', {
        restored: Boolean(restoredSnapshot),
        snapshot: getNetworkSnapshot(network),
      });
      return;
    }

    if (message.type === 'reset') {
      network = createLifNetwork(message.options || {});
      post('reset', { snapshot: getNetworkSnapshot(network) });
      return;
    }

    if (message.type === 'restore_state') {
      network = restoreNetworkFromSnapshot(
        message.snapshot || message.data || {},
        message.options || {}
      );
      post('restored', { snapshot: getNetworkSnapshot(network) });
      return;
    }

    if (message.type === 'inject_spikes') {
      const injection = normalizeInjection(message);
      const accepted = applySpikeInjection(network, injection);
      const step = message.step === false ? null : stepLifNetwork(network, { dtMs: message.dtMs });
      post('spikes_injected', {
        accepted,
        step,
        snapshot: getNetworkSnapshot(network),
      });
      return;
    }

    if (message.type === 'step') {
      const step = stepLifNetwork(network, { dtMs: message.dtMs });
      post('step', {
        step,
        snapshot: getNetworkSnapshot(network),
      });
      return;
    }

    if (message.type === 'get_state') {
      post('state', { snapshot: getNetworkSnapshot(network) });
      return;
    }

    post('error', {
      error: `Unsupported SNN worker message: ${String(message.type || 'missing')}`,
    });
  } catch (error) {
    post('error', { error: error instanceof Error ? error.message : String(error) });
  }
};

self.addEventListener?.('error', (event) => {
  post('error', { error: event?.message || 'SNN worker crashed.' });
});

self.addEventListener?.('unhandledrejection', (event) => {
  post('error', {
    error: event?.reason?.message || String(event?.reason || 'SNN worker promise rejected.'),
  });
});
