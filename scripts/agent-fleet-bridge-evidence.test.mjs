import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { normalizeAgentRegistryId } from './agent-registry.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const oldAt = '2026-07-14T12:00:00.000Z';
const freshAt = '2026-11-13T12:00:00.000Z';

function bridgeFunctions({ registry = [], tasks = [], decisions = [] } = {}) {
  const sandbox = vm.createContext({
    normalizeStringList: (value) => Array.isArray(value) ? [...new Set(value)] : [],
    normalizeAgentRosterId: normalizeAgentRegistryId,
    getCurrentAgentRegistry: () => registry,
    getHermesProviderMeta: () => ({ ready: true }),
    toolHandlers: { runAgentCommand() {} },
    state: { agentTasks: tasks, agentDecisions: decisions, rexDecisions: [] },
    getItemTimestamp: (item) => item.createdAt || '',
    isoNow: () => freshAt,
  });
  // Evaluate only these pure functions, never bridge startup or provider imports.
  for (const name of [
    'getAgentRosterQualityScore', 'mergeAgentRosterRecord', 'mergeDuplicateAgentRosterRecord',
    'getAgentToolProbe', 'buildAgentHealthProbe', 'buildProductionLastAgentActions',
  ]) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    assert(start >= 0 && end > start, `Cannot isolate ${name}`);
    vm.runInContext(source.slice(start, end), sandbox);
  }
  return sandbox;
}

function roster() {
  return {
    id: 'ava', status: 'active', role: 'supervisor', capabilities: ['voice'],
    skills: [{ id: 'skill' }], requiredTools: ['runAgentCommand'], lastSeen: oldAt,
    registry: { source: 'agent_registry' },
  };
}

test('registry merge updates health evidence without rewriting action history', () => {
  const runtime = bridgeFunctions();
  const existing = roster();
  const incoming = { ...existing, skills: [], lastSeen: freshAt };
  const result = runtime.mergeDuplicateAgentRosterRecord(existing, incoming);
  assert.equal(result.lastSeen, oldAt);
  assert.equal(result.healthCheckedAt, freshAt);
  assert.equal(result.skills[0].id, 'skill');
});

test('registry health is not invented as an action for a new agent', () => {
  const runtime = bridgeFunctions();
  const result = runtime.mergeDuplicateAgentRosterRecord(
    { ...roster(), lastSeen: '' }, { ...roster(), lastSeen: freshAt }
  );
  assert.equal(result.lastSeen, '');
  assert.equal(result.healthCheckedAt, freshAt);
});

test('non-registry activity still updates lastSeen', () => {
  const runtime = bridgeFunctions();
  const result = runtime.mergeDuplicateAgentRosterRecord(roster(), {
    ...roster(), registry: undefined, lastSeen: freshAt,
  });
  assert.equal(result.lastSeen, freshAt);
});

test('health exposes canonical checkedAt independently of old activity', () => {
  const runtime = bridgeFunctions({ registry: [{ id: 'ava', status: 'active', healthCheckedAt: freshAt }] });
  const result = runtime.buildAgentHealthProbe(roster());
  assert.equal(result.checkedAt, freshAt);
  assert.equal(result.healthCheckedAt, freshAt);
  assert.equal(result.lastSeen, oldAt);
  assert.equal(result.ready, true);
});

test('a registry-only lastSeen is not surfaced as action evidence', () => {
  const runtime = bridgeFunctions({ registry: [{ id: 'ava', status: 'active', healthCheckedAt: freshAt }] });
  const result = runtime.buildAgentHealthProbe({ ...roster(), lastSeen: freshAt });
  assert.equal(result.checkedAt, freshAt);
  assert.equal(result.lastSeen, '');
});

for (const registry of [[], [{ id: 'ava', status: 'active' }], [{ id: 'ava', status: 'degraded', healthCheckedAt: freshAt }]]) {
  test(`health fails closed for ${JSON.stringify(registry)}`, () => {
    assert.equal(bridgeFunctions({ registry }).buildAgentHealthProbe(roster()).ready, false);
  });
}

for (const status of ['pending_approval', 'approved', 'queued', 'running', 'warning', 'cancelled', '']) {
  test(`bridge does not promote ${status || 'unknown'} into success`, () => {
    const result = bridgeFunctions({ tasks: [{ agentId: 'max', status, createdAt: freshAt }] })
      .buildProductionLastAgentActions();
    assert.equal(result.max.status, status || 'unknown');
  });
}

for (const status of ['success', 'succeeded', 'complete', 'completed']) {
  test(`bridge recognizes terminal ${status}`, () => {
    const result = bridgeFunctions({ tasks: [{ agentId: 'max', status, completedAt: freshAt }] })
      .buildProductionLastAgentActions();
    assert.equal(result.max.status, 'success');
    assert.equal(result.max.at, freshAt);
  });
}

test('completedAt takes precedence over task creation time', () => {
  const result = bridgeFunctions({ tasks: [{ agentId: 'max', status: 'complete', createdAt: oldAt, completedAt: freshAt }] })
    .buildProductionLastAgentActions();
  assert.equal(result.max.at, freshAt);
});

test('missing timestamps are not fabricated from the current clock', () => {
  const result = bridgeFunctions({ tasks: [{ agentId: 'max', status: 'complete' }] })
    .buildProductionLastAgentActions();
  assert.equal(result.max?.at || '', '');
});

test('latest action is selected by instant, not timestamp string order', () => {
  const result = bridgeFunctions({ tasks: [
    { agentId: 'max', status: 'success', updatedAt: '2026-11-13T12:30:00+02:00' },
    { agentId: 'max', status: 'pending_approval', updatedAt: '2026-11-13T11:00:00Z' },
  ] }).buildProductionLastAgentActions();
  assert.equal(result.max.status, 'pending_approval');
});

test('newer failures remain visible instead of falling back to an older success', () => {
  const result = bridgeFunctions({
    tasks: [{ agentId: 'max', status: 'success', createdAt: oldAt }],
    decisions: [{ agentId: 'max', status: 'failed', createdAt: freshAt }],
  }).buildProductionLastAgentActions();
  assert.equal(result.max.status, 'failure');
});
