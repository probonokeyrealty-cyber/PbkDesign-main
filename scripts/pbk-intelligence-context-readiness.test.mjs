import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { requiredAgentRegistryIds } from './agent-registry.mjs';
import {
  buildPBKIntelligenceContext,
  buildPBKIntelligenceFleetReadiness,
  mergePBKIntelligenceContextOutcome,
} from './pbk-intelligence-context.mjs';

const now = Date.parse('2026-11-13T12:00:00.000Z');
const at = new Date(now).toISOString();
const agents = requiredAgentRegistryIds.map((id) => ({ id }));
function input(overrides = {}) {
  return {
    leadId: 'synthetic-lead', lastSyncAt: at, agents,
    memory: { coaching: [{ id: 'lesson' }] },
    skills: { active: [{ id: 'skill', status: 'active' }] },
    turnContract: { ok: true, intent: 'qualification' },
    ...overrides,
  };
}

test('injected clock produces deterministic context timestamps', () => {
  const context = buildPBKIntelligenceContext(input(), { now: () => now });
  assert.equal(context.generatedAt, at);
  assert.equal(context.auditTrail[0].at, at);
  assert.equal(context.fleetReadiness.checkedAt, at);
  assert.equal(context.dataFreshness.ageMs, 0);
  assert.equal(context.fleetReadiness.ready, true);
});

for (const [label, lastSyncAt] of [
  ['missing', undefined], ['blank', ''], ['invalid', 'ok'],
  ['future', new Date(now + 1).toISOString()], ['expired', new Date(now - 60_001).toISOString()],
]) {
  test(`${label} source timestamp cannot claim fresh context`, () => {
    const context = buildPBKIntelligenceContext(input({ lastSyncAt }), { now });
    assert.equal(context.dataFreshness.ready, false);
    assert.equal(context.fleetReadiness.ready, false);
  });
}

test('the existing 60-second freshness boundary is explicit and configurable', () => {
  const values = input({ lastSyncAt: new Date(now - 60_000).toISOString() });
  assert.equal(buildPBKIntelligenceContext(values, { now }).dataFreshness.ready, true);
  assert.equal(buildPBKIntelligenceContext(values, { now, maxAgeMs: 59_999 }).dataFreshness.ready, false);
});

test('invalid freshness policies fail closed', () => {
  for (const maxAgeMs of [NaN, Infinity, -1]) {
    assert.equal(buildPBKIntelligenceContext(input(), { now, maxAgeMs }).dataFreshness.ready, false);
  }
});

test('readiness rechecks age rather than trusting cached ready flags', () => {
  const context = buildPBKIntelligenceContext(input(), { now });
  assert.equal(buildPBKIntelligenceFleetReadiness({ context, agents, now: now + 60_001 }).ready, false);
});

for (const flag of ['leadStale', 'memoryStale', 'skillsStale']) {
  test(`fresh timestamp does not clear ${flag}`, () => {
    const context = buildPBKIntelligenceContext(input({ [flag]: true }), { now });
    assert.equal(context.dataFreshness.ready, false);
    assert.equal(context.fleetReadiness.ready, false);
  });
}

test('an empty roster is missing all 11 agents', () => {
  const context = buildPBKIntelligenceContext(input({ agents: [] }), { now });
  assert.equal(context.fleetReadiness.ready, false);
  assert.deepEqual([...context.fleetReadiness.missingAgents].sort(), [...requiredAgentRegistryIds].sort());
});

for (const id of requiredAgentRegistryIds) {
  test(`coverage requires ${id}`, () => {
    const context = buildPBKIntelligenceContext(input({ agents: agents.filter((agent) => agent.id !== id) }), { now });
    assert.equal(context.fleetReadiness.ready, false);
    assert.deepEqual(context.fleetReadiness.missingAgents, [id]);
  });
}

test('duplicate roster rows cannot replace missing agents', () => {
  const context = buildPBKIntelligenceContext(input({ agents: Array.from({ length: 11 }, () => ({ id: 'ava' })) }), { now });
  assert.equal(context.fleetReadiness.ready, false);
  assert.equal(context.fleetReadiness.missingAgents.length, 10);
});

test('outcome merge preserves observed coverage without refreshing source age', () => {
  const context = buildPBKIntelligenceContext(input(), { now });
  const merged = mergePBKIntelligenceContextOutcome(context, { actionTaken: 'inspect' }, { now: now + 60_001 });
  assert.equal(merged.dataFreshness.lastSyncAt, at);
  assert.equal(merged.fleetReadiness.required.agentCoverage, true);
  assert.equal(merged.fleetReadiness.ready, false);
});

test('outcome merge cannot clear an explicit freshness blocker', () => {
  const context = buildPBKIntelligenceContext(input(), { now });
  context.dataFreshness.ready = false;
  const merged = mergePBKIntelligenceContextOutcome(context, { actionTaken: 'inspect' }, { now });
  assert.equal(merged.dataFreshness.ready, false);
  assert.equal(merged.fleetReadiness.ready, false);
});

test('explicit empty coverage does not fall back to a remembered roster', () => {
  const context = buildPBKIntelligenceContext(input(), { now });
  const readiness = buildPBKIntelligenceFleetReadiness({ context, agents: [], now });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missingAgents.length, 11);
});
