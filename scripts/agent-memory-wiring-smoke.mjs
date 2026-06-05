import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtimeBridge = readFileSync('src/app/utils/runtimeBridge.ts', 'utf8');
const agentFleet = readFileSync('src/app/routes/AgentFleet.tsx', 'utf8');
const memoryAnalytics = readFileSync('src/app/routes/MemoryAnalytics.tsx', 'utf8');
const settings = readFileSync('src/app/routes/Settings.tsx', 'utf8');
const dataMap = readFileSync('docs/modern-shell-bridge-data-map.md', 'utf8');

assert.match(
  runtimeBridge,
  /export async function deployAgentRequest/,
  'runtimeBridge must expose deployAgentRequest for POST /api/agents/deploy.'
);
assert.match(
  runtimeBridge,
  /path:\s*['"]\/api\/agents\/deploy['"]/,
  'deployAgentRequest must call the bridge deploy endpoint.'
);
assert.match(
  agentFleet,
  /deployAgentRequest/,
  'AgentFleet must use deployAgentRequest instead of a decorative deploy card.'
);
assert.doesNotMatch(
  agentFleet,
  /POST \/api\/agents\/deploy["'][^>]*status=["']needs-wiring/,
  'Agent deploy source label must not claim needs-wiring when the bridge endpoint exists.'
);
assert.match(
  agentFleet,
  /Request deployment/,
  'Agent deploy card must expose an approval-gated deployment action.'
);
assert.match(
  runtimeBridge,
  /export async function fetchAgentSnnStatusRequest/,
  'runtimeBridge must expose fetchAgentSnnStatusRequest for durable SNN status.'
);
assert.match(
  agentFleet,
  /fetchAgentSnnStatusRequest/,
  'AgentFleet must use GET /api/agents/snn-status for bridge SNN worker status.'
);
assert.doesNotMatch(
  agentFleet,
  /GET \/api\/agents\/snn-status["'][^>]*status=["']needs-wiring/,
  'Agent SNN status source label must not claim needs-wiring when the bridge endpoint exists.'
);

assert.match(
  runtimeBridge,
  /export async function fetchActiveExperimentsRequest/,
  'runtimeBridge must expose fetchActiveExperimentsRequest for active experiment rows.'
);
assert.match(
  runtimeBridge,
  /\/api\/emotion\/policies\/experiments/,
  'Active experiments should use the existing bridge emotional policy experiment endpoint.'
);
assert.match(
  memoryAnalytics,
  /fetchActiveExperimentsRequest/,
  'MemoryAnalytics must fetch active experiment rows from the bridge.'
);
assert.doesNotMatch(
  memoryAnalytics,
  /GET \/api\/experiments\/active["'][^>]*status=["']needs-wiring/,
  'MemoryAnalytics must not label active experiments needs-wiring when a bridge source exists.'
);
assert.match(
  dataMap,
  /Agent deploy request\s*\|[\s\S]*POST \/api\/agents\/deploy/,
  'Data map must document the agent deploy bridge endpoint.'
);
assert.match(
  dataMap,
  /Active memory experiments\s*\|[\s\S]*GET \/api\/emotion\/policies\/experiments/,
  'Data map must document the active memory experiment bridge endpoint.'
);
assert.match(
  runtimeBridge,
  /export async function fetchObservabilityStatusRequest/,
  'runtimeBridge must expose fetchObservabilityStatusRequest.'
);
assert.match(
  settings,
  /fetchObservabilityStatusRequest/,
  'Settings must fetch canonical observability status from the bridge.'
);
assert.doesNotMatch(
  settings,
  /GET \/api\/observability\/status["'][^>]*status=["']needs-wiring/,
  'Settings must not label observability status needs-wiring when the bridge endpoint exists.'
);
assert.match(
  dataMap,
  /Metrics\/observability link\s*\|[\s\S]*GET \/api\/observability\/status/,
  'Data map must document the observability bridge endpoint.'
);

console.log('[agent-memory-wiring-smoke] ok');
