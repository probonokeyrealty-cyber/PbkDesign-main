import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentFleet = readFileSync('src/app/routes/AgentFleet.tsx', 'utf8');
const runtimeBridge = readFileSync('src/app/utils/runtimeBridge.ts', 'utf8');
const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

assert(
  packageJson.includes('"test:agent-fleet-controls"'),
  'package.json must expose test:agent-fleet-controls.'
);

const requiredRuntimeHelpers = [
  ['fetchAgentRegistryRequest', '/api/agents/registry'],
  ['fetchAgentHealthRequest', '/api/agents/health'],
  ['fetchAgentSnnStatusRequest', '/api/agents/snn-status'],
  ['deployAgentRequest', '/api/agents/deploy'],
  ['fetchLeadsRequest', '/api/leads'],
  ['startLeadCallRequest', 'telnyx_call'],
];

for (const [helper, endpoint] of requiredRuntimeHelpers) {
  assert(
    runtimeBridge.includes(`function ${helper}`) || runtimeBridge.includes(`function ${helper}(`),
    `runtimeBridge must expose ${helper}.`
  );
  assert(runtimeBridge.includes(endpoint), `${helper} must route through ${endpoint}.`);
  assert(agentFleet.includes(helper), `AgentFleet must use ${helper}.`);
}

const requiredAgentFleetControls = [
  ['handlePreviewAgentDealContext', 'previewAgentDealContext'],
  ['handleCallSelectedLead', 'startLeadCallRequest'],
  ['handleDeployAgent', 'deployAgentRequest'],
  ['handleTransfer', 'pbk_transfer_agent_skill'],
  ['flushTransferQueue', 'pbk_transfer_agent_skill'],
];

for (const [handler, bridgeTool] of requiredAgentFleetControls) {
  assert(agentFleet.includes(`const ${handler}`) || agentFleet.includes(`function ${handler}`), `AgentFleet must define ${handler}.`);
  assert(agentFleet.includes(bridgeTool), `${handler} must fire ${bridgeTool}.`);
}

assert.doesNotMatch(
  agentFleet,
  /POST \/invoke: getSnnWorkerStatus/,
  'Agent Fleet must not advertise the old invoke-only SNN status path.'
);

const requiredBridgeRoutes = [
  '/api/agents/registry',
  '/api/agents/health',
  '/api/agents/snn-status',
  '/api/agents/deploy',
  '/api/agents/:agentId/actions',
  '/api/agents/:agentId/skills',
];

for (const route of requiredBridgeRoutes) {
  assert(bridge.includes(route), `Bridge must expose ${route}.`);
}

for (const tool of [
  'previewAgentDealContext',
  'pbk_transfer_agent_skill',
  'telnyx_call',
  'runAgentCommand',
  'runAgentTeam',
]) {
  assert(bridge.includes(tool), `Bridge must register ${tool} for Agent Fleet operations.`);
}

assert.match(
  bridge,
  /requestApproval:\s*body\.requestApproval\s*!==\s*false/,
  'Agent deploy/action/skill bridge routes must remain approval-gated by default.'
);
assert.match(
  agentFleet,
  /pendingTransferQueueRef/,
  'Agent Fleet must queue skill transfers when the bridge is temporarily unavailable.'
);
assert.match(
  agentFleet,
  /assertBridgeTransferApplied/,
  'Agent Fleet must verify bridge transfer confirmation before showing success.'
);
assert.match(
  agentFleet,
  /showUiToast\(\{[\s\S]*title:\s*'Call request failed'[\s\S]*critical:\s*true/,
  'Agent Fleet call failures must surface as critical operator toasts.'
);

console.log('agent-fleet-controls-smoke: ok');
