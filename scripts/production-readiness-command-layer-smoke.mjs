import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildAgentCapabilityReadiness,
  buildBridgeConnectionStatus,
  buildProductionTruthGate,
  createIdempotencyStore,
  createProductionReadinessMonitor,
  executeIdempotentAction,
} from './production-readiness-command-layer.mjs';

const root = process.cwd();
const bridgeSource = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const now = new Date('2026-06-13T20:00:00.000Z').getTime();

const monitor = createProductionReadinessMonitor({
  now: () => now,
});
monitor.recordSuccess('bridgeHealth');
monitor.recordFailure('bridgeHealth', 'forced_probe_failure');
monitor.recordSuccess('manualSend');
monitor.recordLatency('avaLiveResponse', 900);
monitor.recordLatency('avaLiveResponse', 2100);
const slo = monitor.getSloStatus();

assert.equal(slo.ok, true, 'SLO monitor should produce a status object.');
assert.equal(slo.metrics.bridgeHealth.total, 2, 'SLO monitor must count success and failure events.');
assert.equal(slo.metrics.bridgeHealth.failures, 1, 'SLO monitor must retain failures.');
assert.equal(slo.metrics.avaLiveResponse.p95Ms, 2100, 'SLO monitor must calculate latency p95.');
assert.equal(slo.metrics.avaLiveResponse.burned, true, 'Slow Ava turns should burn the latency budget.');

const freshTruth = buildProductionTruthGate({
  runtimeMeta: {
    hosted: true,
    stateBackend: 'postgres',
    productionReady: true,
  },
  identity: {
    leadId: 'lead-1',
    normalizedPhone: '+16145550142',
  },
  conversation: {
    threadId: 'thread-1',
  },
  memory: {
    ready: true,
  },
  skills: {
    ready: true,
    active: [{ id: 'skill-1' }],
  },
  turnContract: {
    ok: true,
    intent: 'price_objection',
  },
  senderIdentity: {
    id: 'sms-1',
    channel: 'sms',
    healthStatus: 'active',
  },
  providers: {
    telnyx: { ready: true, messagingReady: true, voiceReady: true },
    docusign: { productionReady: true },
  },
  actionType: 'send_sms',
});

assert.equal(freshTruth.ready, true, 'Fresh truth should allow normal manual SMS action.');
assert.deepEqual(freshTruth.blockers, [], 'Fresh truth should not produce blockers.');

const staleTruth = buildProductionTruthGate({
  runtimeMeta: {
    hosted: true,
    stateBackend: 'file',
    productionReady: false,
  },
  identity: {},
  conversation: {},
  memory: { ready: false },
  skills: { ready: false, active: [] },
  turnContract: { ok: false },
  senderIdentity: null,
  providers: {
    telnyx: { ready: false, messagingReady: false },
  },
  actionType: 'send_sms',
});

assert.equal(staleTruth.ready, false, 'Stale truth must fail closed.');
assert(staleTruth.blockers.includes('hosted_state_backend_not_postgres'), 'Hosted file-backed state is a blocker.');
assert(staleTruth.blockers.includes('lead_identity_missing'), 'Missing lead identity is a blocker.');
assert(staleTruth.blockers.includes('conversation_thread_missing'), 'Missing conversation thread is a blocker.');
assert(staleTruth.blockers.includes('sender_identity_missing'), 'Missing sender identity is a blocker.');
assert(staleTruth.blockers.includes('active_skills_missing'), 'Missing active skills is a blocker.');

const idempotency = createIdempotencyStore({
  now: () => now,
  ttlMs: 60_000,
});
let attempts = 0;
const first = await executeIdempotentAction({
  actionType: 'send_sms',
  idempotencyKey: 'same-action-key',
  idempotency,
  truthGate: freshTruth,
  monitor,
  execute: async () => {
    attempts += 1;
    return { ok: true, providerMessageId: `msg-${attempts}` };
  },
  projectTimeline: async (result) => ({
    id: 'timeline-1',
    status: result.ok ? 'sent' : 'failed',
  }),
});
const second = await executeIdempotentAction({
  actionType: 'send_sms',
  idempotencyKey: 'same-action-key',
  idempotency,
  truthGate: freshTruth,
  monitor,
  execute: async () => {
    attempts += 1;
    return { ok: true, providerMessageId: `msg-${attempts}` };
  },
  projectTimeline: async (result) => ({
    id: 'timeline-2',
    status: result.ok ? 'sent' : 'failed',
  }),
});

assert.equal(attempts, 1, 'Idempotent action must not execute provider work twice.');
assert.equal(first.idempotentReplay, false, 'First execution should not be marked replay.');
assert.equal(second.idempotentReplay, true, 'Second execution should be a replay.');
assert.equal(second.result.providerMessageId, first.result.providerMessageId, 'Replay must return original provider result.');
assert.equal(second.timeline.id, 'timeline-1', 'Replay must return original timeline projection.');

const blocked = await executeIdempotentAction({
  actionType: 'send_sms',
  idempotencyKey: 'blocked-action-key',
  idempotency,
  truthGate: staleTruth,
  monitor,
  execute: async () => {
    throw new Error('should not execute');
  },
});
assert.equal(blocked.ok, false, 'Blocked action should return failure envelope.');
assert.equal(blocked.providerAttempted, false, 'Blocked action must not attempt provider work.');
assert.equal(blocked.result, 'truth_gate_blocked', 'Blocked action should label the production truth gate.');

const agentReadiness = buildAgentCapabilityReadiness({
  agents: [
    {
      id: 'ava',
      name: 'Ava',
      requiredTools: ['telnyx_sms'],
      status: 'active',
    },
    {
      id: 'qa-agent',
      name: 'QA Agent',
      requiredTools: ['validateProviderActionSafety'],
      status: 'standby',
    },
  ],
  toolCatalog: {
    telnyx_sms: true,
    validateProviderActionSafety: true,
  },
  intelligenceContext: {
    memory: { ready: true },
    skills: { ready: true },
    dataFreshness: { ready: true },
    fleetReadiness: { ready: true },
  },
  latencySamples: {
    ava: [800, 1200, 1600],
  },
  lastActions: {
    ava: { status: 'success', at: '2026-06-13T19:59:00.000Z' },
  },
});
assert.equal(agentReadiness.ready, true, 'Agent capability readiness should pass with tools, memory, skills, and freshness.');
assert.equal(agentReadiness.agents.find((agent) => agent.id === 'ava').capability.latencyP95Ms, 1600);

const bridgeConnection = buildBridgeConnectionStatus({
  runtimeMeta: {
    hosted: true,
    authRequired: true,
    stateBackend: 'postgres',
    productionReady: true,
  },
  health: {
    status: 'ok',
    components: {
      bridge: { ready: true },
      postgres: { ready: true },
      agentOrchestration: { ready: true },
      telnyx: { ready: true },
      docusign: { ready: true },
    },
  },
});
assert.equal(bridgeConnection.ready, true, 'Bridge connection should be ready when core components are live.');
assert.deepEqual(bridgeConnection.blockers, []);

assert(
  bridgeSource.includes("from './production-readiness-command-layer.mjs'"),
  'Bridge must import the production readiness command layer.'
);
for (const route of ['/api/production/readiness', '/api/slo/status', '/api/truth/status', '/api/bridge/connection']) {
  assert(bridgeSource.includes(route), `Bridge must expose ${route}.`);
}
assert(
  /buildAgentCapabilityReadiness\(/.test(bridgeSource),
  'Agent Fleet response must include capability readiness from the production layer.'
);
assert.equal(
  packageJson.scripts?.['test:production-readiness-command-layer'],
  'node ./scripts/production-readiness-command-layer-smoke.mjs'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:production-readiness-command-layer'),
  'Production hardening gate must include the production readiness command layer smoke.'
);

console.log('production-readiness-command-layer-smoke: ok');
