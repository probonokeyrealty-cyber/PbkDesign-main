import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { requiredAgentRegistryIds } from './agent-registry.mjs';
import { buildPBKIntelligenceContext } from './pbk-intelligence-context.mjs';
import { ensureFreshPBKIntelligenceContext } from './pbk-intelligence-context-runtime.mjs';
import { isNonOperationalAgentEvidence } from './agent-fleet-measurement.mjs';

const agents = requiredAgentRegistryIds.map((id) => ({ id }));
const oldAt = '2026-07-14T12:00:00.000Z';
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function buildRuntimePBKIntelligenceContext(');
const end = source.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start);
const sandbox = vm.createContext({
  buildPBKIntelligenceContext,
  isNonOperationalAgentEvidence,
  ensureAgentFleetCollections() {},
  sortNewest: (items) => items,
  state: { agents, skillOutcomes: [] },
  buildDefaultAgentFleet: () => agents,
  isoNow: () => new Date().toISOString(),
});
vm.runInContext(source.slice(start, end), sandbox);

function bridgeContext(overrides = {}, storedAt = null) {
  sandbox.state.calls = [];
  sandbox.state.leads = storedAt ? [{ id: 'source-evidence-lead', updatedAt: storedAt }] : [];
  return sandbox.buildRuntimePBKIntelligenceContext({
    leadId: 'source-evidence-lead',
    scripts: { activeMemories: [{ id: 'lesson' }], selectedSkills: [{ id: 'skill' }] },
    turnContract: { ok: true, intent: 'qualification' },
    ...overrides,
  });
}

test('a supplied Redis success label is not authoritative source freshness', () => {
  const syncAt = Date.now() - 50;
  const context = bridgeContext({ session: { lastRedisSyncResult: 'redis_call_state_synced', lastRedisSyncAt: syncAt } });
  assert.equal(context.dataFreshness.lastSyncAt, null);
  assert.equal(context.dataFreshness.ready, false);
});

for (const result of ['redis_unavailable', 'redis_call_state_failed', 'redis_call_state_throttled']) {
  test(`${result} cannot turn a sync attempt into freshness evidence`, () => {
    const context = bridgeContext({
      session: { lastRedisSyncResult: result, lastRedisSyncAt: Date.now() },
      contextCall: { updatedAt: oldAt },
    });
    assert.equal(context.dataFreshness.lastSyncAt, null);
    assert.equal(context.dataFreshness.ready, false);
  });
}

test('unavailable Redis does not hide an authoritative stored source timestamp', () => {
  const updatedAt = new Date(Date.now() - 50).toISOString();
  const context = bridgeContext({ session: { lastRedisSyncResult: 'redis_unavailable' }, contextCall: { updatedAt } }, updatedAt);
  assert.equal(context.dataFreshness.lastSyncAt, updatedAt);
  assert.equal(context.dataFreshness.ready, true);
});

test('missing bridge source timestamps are not replaced with builder execution time', () => {
  assert.equal(bridgeContext().dataFreshness.lastSyncAt, null);
  assert.equal(bridgeContext().dataFreshness.ready, false);
});

test('cloning an expired packet twice retains the original source timestamp and blockers', async () => {
  const context = bridgeContext({ leadStale: true }, oldAt);
  const first = await ensureFreshPBKIntelligenceContext(context);
  const second = await ensureFreshPBKIntelligenceContext(first);
  assert.equal(second.dataFreshness.lastSyncAt, oldAt);
  assert.equal(second.dataFreshness.ready, false);
  assert.equal(second.dataFreshness.leadStale, true);
});

test('a missing timestamp cannot be manufactured by runtime refresh', async () => {
  const refreshed = await ensureFreshPBKIntelligenceContext(bridgeContext());
  assert.equal(refreshed.dataFreshness.lastSyncAt, null);
  assert.equal(refreshed.dataFreshness.ready, false);
});

test('runtime refresh consumes the timestamp and lead data of a newly supplied full packet', async () => {
  const old = bridgeContext({}, oldAt);
  const freshAt = new Date(Date.now() - 50).toISOString();
  const fresh = bridgeContext({ leadName: 'New Source Name' }, freshAt);
  const refreshed = await ensureFreshPBKIntelligenceContext(old, { input: fresh });
  assert.equal(refreshed.dataFreshness.lastSyncAt, freshAt);
  assert.equal(refreshed.identity.name, 'New Source Name');
  assert.equal(refreshed.dataFreshness.ready, true);
});

test('runtime refresh respects an explicitly missing timestamp in replacement data', async () => {
  const old = bridgeContext({ contextCall: { updatedAt: oldAt } });
  const fresh = bridgeContext();
  const refreshed = await ensureFreshPBKIntelligenceContext(old, { input: fresh });
  assert.equal(refreshed.dataFreshness.lastSyncAt, null);
  assert.equal(refreshed.dataFreshness.ready, false);
});
