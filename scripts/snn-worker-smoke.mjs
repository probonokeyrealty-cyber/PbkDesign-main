import {
  applySpikeInjection,
  createLifNetwork,
  getNetworkSnapshot,
  stepLifNetwork,
} from '../src/app/agents/snn/lifCore.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const network = createLifNetwork({ size: 256, threshold: 0.75, decay: 0.88 });
const accepted = applySpikeInjection(network, {
  version: 'pbk-web-search-spikes-v1',
  source: 'web-search',
  provider: 'deepseek',
  neuronIds: [30, 249, 252, 999, -1],
  strengths: [1, 0.8, 0.6, 1, 1],
  symbolicFacts: [
    { name: 'webSearch.provider', value: 'deepseek' },
    { name: 'webSearch.hasLiveData', value: false },
  ],
});

assert(accepted === 3, `Expected 3 valid spike injections, got ${accepted}.`);

const firstStep = stepLifNetwork(network, { dtMs: 16 });
assert(firstStep.spikes.includes(30), 'Urgent neuron 30 did not spike after full-strength injection.');
assert(firstStep.spikes.includes(249), 'DeepSeek provider neuron 249 did not spike after provider injection.');
assert(!firstStep.spikes.includes(999), 'Out-of-range neuron 999 should be ignored.');

const snapshot = getNetworkSnapshot(network);
assert(snapshot.tick === 1, `Expected tick 1 after one step, got ${snapshot.tick}.`);
assert(snapshot.lastSpikeCount >= 2, `Expected at least 2 spikes, got ${snapshot.lastSpikeCount}.`);
assert(snapshot.symbolicFacts.length === 2, 'Symbolic facts were not retained on the network snapshot.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bridgeSource = readFileSync(path.resolve(__dirname, '../src/app/utils/snnWorkerBridge.ts'), 'utf8');
const workerSource = readFileSync(path.resolve(__dirname, '../src/app/agents/snn/agentBrain.worker.js'), 'utf8');

assert(/worker\.onerror\s*=/.test(bridgeSource), 'SNN bridge should register worker.onerror for crash visibility.');
assert(/localStorage/.test(bridgeSource), 'SNN bridge should persist snapshots across page reloads.');
assert(/requestNetworkSnapshot/.test(bridgeSource), 'SNN bridge should expose a network snapshot request helper.');
assert(/getNetworkSnapshot/.test(bridgeSource), 'SNN bridge should expose the last network snapshot to UI/API callers.');
assert(/restore_state|restoredSnapshot/i.test(workerSource), 'SNN worker should support restoring persisted network state.');

console.log(JSON.stringify({
  ok: true,
  result: 'snn_worker_core_ready',
  accepted,
  spikes: firstStep.spikes,
  tick: snapshot.tick,
  symbolicFactCount: snapshot.symbolicFacts.length,
}, null, 2));
