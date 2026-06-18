import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentFleet = readFileSync('src/app/routes/AgentFleet.tsx', 'utf8');
const runtimeBridge = readFileSync('src/app/utils/runtimeBridge.ts', 'utf8');
const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
const agentRegistry = readFileSync('scripts/agent-registry.mjs', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

assert(
  packageJson.includes('"test:agent-fleet-controls"'),
  'package.json must expose test:agent-fleet-controls.'
);

const requiredRuntimeHelpers = [
  ['fetchAgentRegistryRequest', '/api/agents/registry'],
  ['fetchAgentHealthRequest', '/api/agents/health'],
  ['fetchLatestQaAuditRequest', '/api/qa/audit/latest'],
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
  '/api/agents/measurement',
  '/api/agents/snn-status',
  '/api/qa/audit/latest',
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
assert.match(
  agentFleet,
  /QA proof/,
  'Agent Fleet selected-lead preview must surface durable QA proof status.'
);
assert.match(
  agentFleet,
  /'qa-agent':\s*\[/,
  'QA Agent must expose visible production skills in the fleet.'
);

const canonicalAgentIds = [
  'ava',
  'rex',
  'max',
  'hermes',
  'call-analyzer',
  'prosody-tuner',
  'script-rotator',
  'bant-enforcer',
  'qa-agent',
  'nurture-agent',
  'research-orchestrator',
];

for (const agentId of canonicalAgentIds) {
  assert(
    agentFleet.includes(`${agentId}: [`) || agentFleet.includes(`'${agentId}': [`),
    `Agent Fleet must expose visible production skills for ${agentId}.`
  );
  assert(
    agentRegistry.includes(`'${agentId}'`),
    `Bridge agent registry must require and/or define canonical agent ${agentId}.`
  );
}

assert.match(
  agentRegistry,
  /const REQUIRED_AGENT_IDS = \[[\s\S]*'research-orchestrator'[\s\S]*\];/,
  'Research Orchestrator must be part of required backend fleet readiness.'
);
assert.match(
  agentRegistry,
  /const AGENT_REQUIRED_TOOLS = \{[\s\S]*'research-orchestrator': \[[\s\S]*runProviderAugmentedAdditiveIntelligence[\s\S]*\][\s\S]*\};/,
  'Every canonical agent should declare production required tools for honest readiness.'
);
assert.match(
  bridge,
  /orchestration\.registry\?\.requiredAgents/,
  'SNN worker status should default to the canonical required agent roster.'
);
assert.match(
  bridge,
  /snnAgentIds\.length > 0 && workers\.length === snnAgentIds\.length/,
  'SNN worker status must not pass with an empty roster.'
);
assert.match(
  agentRegistry,
  /pendingHealth/,
  'Agent registry should separate inventory from health readiness.'
);
assert.match(
  bridge,
  /runLocalAgentSmokeProbe/,
  'Agent orchestration smoke should probe every local agent handler, not only Ava/Rex/Hermes.'
);
assert.match(
  bridge,
  /handlerCoverageReady/,
  'Agent orchestration smoke should expose all-agent handler coverage readiness.'
);
assert.match(
  bridge,
  /rawAgentId === 'nurture'\s*\?\s*'nurture-agent'/,
  'YouTube skill ingest must normalize the legacy nurture id to canonical nurture-agent.'
);
assert.match(
  bridge,
  /new Set\(\['ava', 'rex', 'nurture-agent', 'max'\]\)/,
  'YouTube skill ingest must allow canonical nurture-agent skill candidates.'
);
assert.match(
  bridge,
  /recordQaPreviewAudit/,
  'Bridge must persist preview-time QA intent into the QA audit ledger.'
);
assert.match(
  bridge,
  /const fields = \{ budget, authority, need, timeline, urgency \};/,
  'Agent Fleet preview BANT proof must include urgency to match seller-facing safety validation.'
);

console.log('agent-fleet-controls-smoke: ok');
