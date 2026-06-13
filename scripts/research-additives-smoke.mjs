import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAcpEnvelope,
  buildResearchAdditivesStatus,
  buildSafetyTransparencyReport,
  checkResearchAdditiveProviders,
  compactLongHorizonMemory,
  discoverExternalTool,
  evaluateStoppingAgent,
  induceWorkflowMemory,
  inferProactiveHumanState,
  planDeterministicGuiAutomation,
  planExecutionPathSearch,
  planMasterAgentMission,
  routeAcpMessage,
  runProviderAugmentedAdditiveIntelligence,
  runUnifiedAdditiveIntelligence,
} from './research-additives.mjs';
import { buildDefaultAgentRegistry, findAgentsByCapability } from './agent-registry.mjs';

const status = buildResearchAdditivesStatus({ env: {}, now: new Date('2026-05-31T12:00:00Z') });
assert.equal(status.ok, true);
assert.equal(status.summary.total, 11, 'all registered frontier additives should be represented.');
assert.equal(status.summary.ready, 11, 'all frontier additives should have a PBK-native ready adapter.');
assert.equal(status.summary.nativeReady, 11, 'all frontier additives should be native-ready today.');
assert(status.summary.providerUpgradesPending >= 4, 'provider/model upgrades should be tracked separately from native readiness.');
assert(
  status.additives.some((item) => item.id === 'agent_reach_internet_layer' && item.mode === 'optional_local_readonly'),
  'Agent Reach should be registered as an optional read-only internet layer.'
);

const providerChecks = await checkResearchAdditiveProviders({ liveProbe: false }, { env: {} });
assert.equal(providerChecks.ok, true);
assert.equal(providerChecks.result, 'provider_matrix_checked');
assert.equal(providerChecks.summary.nativeFallbackReady, true);
assert.equal(providerChecks.summary.configured, 0);
assert(providerChecks.providers.length >= 8, 'provider connector matrix should cover optional frontier upgrades.');
const agentReachProvider = providerChecks.providers.find((provider) => provider.providerId === 'agent-reach');
assert(agentReachProvider, 'provider matrix should include Agent Reach.');
assert.equal(agentReachProvider.commandEnv, '', 'Agent Reach command env should remain unset by default.');
assert.equal(agentReachProvider.safety.advisoryOnly, true, 'Agent Reach must remain advisory/read-only.');
assert.equal(agentReachProvider.safety.providerWritesAllowed, false, 'Agent Reach provider writes must stay blocked.');

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
  emotion: { dominant: 'fear', intensity: 0.62 },
  env: {},
});
assert.equal(compact.result, 'compact_state_ready');
assert(compact.compactState.openLoops.includes('Confirm decision authority.'));
assert.equal(compact.compactState.bant.timeline, 'soon');
assert.equal(compact.compactState.emotion.dominant, 'fear');
assert(compact.compactState.retentionPolicy.memoryWindow >= 20);
assert(compact.compactState.retentionPolicy.minRetentionTokens >= 512);
assert(compact.compactState.protectedFields.includes('bant'));
assert.equal(compact.model.mem1ModelConfigured, false);

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

const unified = await runUnifiedAdditiveIntelligence(
  {
    query: 'Use all intelligence to decide whether to SMS, call, or pause. Seller says this feels like a scam.',
    transcript: 'Seller says this feels like a scam and asks for proof.',
    bant: { timeline: 'soon' },
  },
  { env: {}, toolNames: ['consultNurtureAgent', 'analyzeDeal', 'runAgentTeam'] }
);
assert.equal(unified.result, 'unified_intelligence_ready');
assert.equal(unified.coverage.total, 11);
assert.equal(unified.coverage.used, 11);
assert.equal(unified.providerAugmentation.mode, 'native_first_provider_aware');
assert.equal(unified.providerAugmentation.providerWritesAllowed, false);
assert.equal(unified.sync.stoppingFeedsPathSearch, true);
assert.equal(unified.sync.toolDiscoveryFeedsNextAction, true);
assert.equal(unified.sync.providersAdvisoryOnly, true);
assert(unified.modules.pathSearch.selected, 'unified intelligence should include selected path search output.');
assert(unified.modules.discovery.matches.length > 0, 'unified intelligence should include tool discovery matches.');
assert(unified.modules.providerChecks.providers.length > 0, 'unified intelligence should include provider health matrix.');
assert(unified.nextAction.action, 'unified intelligence should return an operator next action.');

const providerAugmented = await runProviderAugmentedAdditiveIntelligence(
  {
    query: 'Upgrade the whole PBK intelligence stack but keep provider writes blocked.',
    transcript: 'Seller is cautious and needs proof.',
    liveProbe: false,
  },
  { env: {}, toolNames: ['consultNurtureAgent', 'analyzeDeal'] }
);
assert.equal(providerAugmented.result, 'unified_intelligence_ready');
assert.equal(providerAugmented.providerAugmentation.advisoryOnly, true);

const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve('Dockerfile.openclaw'), 'utf8');
assert.match(bridge, /getResearchAdditivesStatus/, 'bridge should expose research-additive status tool.');
assert.match(bridge, /agentReach/, 'bridge should expose Agent Reach tooling status.');
assert.match(bridge, /runUnifiedAdditiveIntelligence/, 'bridge should expose unified additive intelligence tool.');
assert.match(bridge, /runProviderAugmentedAdditiveIntelligence/, 'bridge should expose provider-augmented additive intelligence tool.');
assert.match(bridge, /checkResearchAdditiveProviders/, 'bridge should expose provider health checks.');
assert.match(bridge, /\/api\/research-additives\/status/, 'bridge should expose research-additive status endpoint.');
assert.match(bridge, /pbk_research_additive_runs/, 'bridge should persist research additive run audit rows.');
assert.match(bridge, /pbk_research_additive_provider_checks/, 'bridge should persist provider check audit rows.');
assert.match(dockerfile, /COPY scripts\/research-additives\.mjs/, 'Render image should copy research additive module.');

console.log('[research-additives-smoke] ok', {
  total: status.summary.total,
  ready: status.summary.ready,
  providerUpgradesPending: status.summary.providerUpgradesPending,
  selectedPath: pathSearch.selected.id,
  discoveredTool: discovery.matches[0].toolName,
  unifiedNextAction: unified.nextAction.action,
});
