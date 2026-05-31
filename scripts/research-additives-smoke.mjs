import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAcpEnvelope,
  buildResearchAdditivesStatus,
  buildSafetyTransparencyReport,
  compactLongHorizonMemory,
  discoverExternalTool,
  evaluateStoppingAgent,
  induceWorkflowMemory,
  inferProactiveHumanState,
  planDeterministicGuiAutomation,
  planExecutionPathSearch,
  planMasterAgentMission,
  routeAcpMessage,
} from './research-additives.mjs';
import { buildDefaultAgentRegistry, findAgentsByCapability } from './agent-registry.mjs';

const status = buildResearchAdditivesStatus({ env: {}, now: new Date('2026-05-31T12:00:00Z') });
assert.equal(status.ok, true);
assert.equal(status.summary.total, 10, 'all ten frontier additives should be represented.');
assert(status.summary.ready >= 5, 'PBK-native additive adapters should be ready without new signups.');

const registry = buildDefaultAgentRegistry({ now: 1780000000000 });
assert(
  findAgentsByCapability(registry, 'research_additives').some((agent) => agent.id === 'research-orchestrator'),
  'Research Orchestrator should be discoverable by capability.'
);

const envelope = buildAcpEnvelope({
  method: 'pbk.analyze_deal',
  params: { address: '202 Cherry Ln' },
  sourceAgent: 'external-title-agent',
});
assert.equal(envelope.jsonrpc, '2.0');
assert.equal(envelope.method, 'pbk.analyze_deal');

const acpPlan = await routeAcpMessage(envelope);
assert.equal(acpPlan.ok, true);
assert.equal(acpPlan.route.toolName, 'analyzeDeal');
assert.equal(acpPlan.safety.approvalGate, true);

const pathSearch = planExecutionPathSearch({
  objection: 'This feels like a scam and your price is too low.',
});
assert.equal(pathSearch.ok, true);
assert(pathSearch.selected, 'path search should select a best move.');
assert.equal(pathSearch.backtracking.enabled, true);

const awm = induceWorkflowMemory({
  trajectories: [
    { transcript: 'Probate seller needed executor clarity and a respectful close.', outcome: 'accepted' },
    { transcript: 'Estate conversation worked after empathy and title process proof.', outcome: 'accepted' },
  ],
});
assert.equal(awm.workflow.trigger, 'probate_or_estate');

const stop = evaluateStoppingAgent({
  lastSellerUtterance: 'Stop calling me or I will call my attorney.',
});
assert.equal(stop.result, 'halt');
assert(stop.flags.includes('dnc_or_stop_request'));

const discovery = discoverExternalTool(
  { query: 'Should I send SMS or email follow up?' },
  { toolNames: ['consultNurtureAgent', 'analyzeDeal'], env: {} }
);
assert.equal(discovery.result, 'matched');
assert.equal(discovery.matches[0].toolName, 'consultNurtureAgent');

const compact = compactLongHorizonMemory({
  transcript: 'Seller inherited the house, needs proof we are real, and wants to close soon.',
  bant: { timeline: 'soon' },
  env: {},
});
assert.equal(compact.result, 'compact_state_ready');
assert(compact.compactState.openLoops.includes('Confirm decision authority.'));

const humanState = inferProactiveHumanState({
  transcript: 'I am overwhelmed and busy, can you explain this later?',
  silenceMs: 4000,
  responseLatencyMs: 2500,
  env: {},
});
assert.equal(humanState.result, 'state_inferred');
assert(humanState.stateOfMind.stress > 0.2);

const guiPlan = planDeterministicGuiAutomation({
  targetApp: 'CRM',
  objective: 'Open lead record and update status',
});
assert.equal(guiPlan.safety.approvalRequired, true);
assert.equal(guiPlan.safety.clickUiPolicy, 'not_wired_by_default');

const mission = planMasterAgentMission({
  goal: 'Debug production, fix deploy, and verify tests',
  env: {},
});
assert.equal(mission.mission.type, 'ops_repair');
assert(mission.mission.approvalGates.includes('provider_write'));

const safety = buildSafetyTransparencyReport();
assert.equal(safety.document, 'SAFETY.md');
assert(readFileSync(resolve('SAFETY.md'), 'utf8').includes('PBK Command Center Safety'));

const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve('Dockerfile.openclaw'), 'utf8');
assert.match(bridge, /getResearchAdditivesStatus/, 'bridge should expose research-additive status tool.');
assert.match(bridge, /\/api\/research-additives\/status/, 'bridge should expose research-additive status endpoint.');
assert.match(bridge, /pbk_research_additive_runs/, 'bridge should persist research additive run audit rows.');
assert.match(dockerfile, /COPY scripts\/research-additives\.mjs/, 'Render image should copy research additive module.');

console.log('[research-additives-smoke] ok', {
  total: status.summary.total,
  ready: status.summary.ready,
  gated: status.summary.gated,
  selectedPath: pathSearch.selected.id,
  discoveredTool: discovery.matches[0].toolName,
});
