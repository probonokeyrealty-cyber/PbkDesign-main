import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import {
  buildAgentRegistrySnapshot,
  buildDefaultAgentRegistry,
  buildStableAgentFleetMeasurement,
} from './agent-registry.mjs';

function fixture() {
  const at = '2026-11-13T12:00:00.000Z';
  const registry = buildDefaultAgentRegistry({ env: {} }).map((agent) => ({
    ...agent,
    status: 'active',
    healthCheckedAt: at,
    health_checked_at: at,
  }));
  return {
    registry,
    options: {
      now: Date.parse(at),
      toolCatalog: Object.fromEntries(
        registry.flatMap((agent) => agent.metadata.requiredTools.map((tool) => [tool, true]))
      ),
      healthProbes: registry.map(({ id }) => ({ id, ready: true, present: true, lastSeen: at })),
      latencySamples: Object.fromEntries(registry.map(({ id }) => [id, [100, 150, 200]])),
      lastActions: Object.fromEntries(registry.map(({ id }) => [id, { status: 'success', at }])),
      intelligenceContext: {
        memory: { ready: true },
        skills: { ready: true },
        dataFreshness: { ready: true },
        fleetReadiness: { ready: true },
      },
    },
  };
}

test('all 11 agents need explicit measurement evidence', () => {
  const { registry, options } = fixture();
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, true);
  assert.equal(result.measuredCount, 11);
});

test('active labels do not replace registry health checks', () => {
  const { registry } = fixture();
  const result = buildAgentRegistrySnapshot(
    registry.map((agent) => ({ ...agent, healthCheckedAt: '', health_checked_at: '' }))
  );
  assert.equal(result.ready, false);
  assert.equal(result.required.pendingHealth.length, 11);
});

test('default definitions cannot replace missing runtime inventory', () => {
  const { options } = fixture();
  const result = buildStableAgentFleetMeasurement([], options);
  assert.equal(result.ready, false);
  assert(result.agents.every((agent) => agent.blockers.includes('agent_missing')));
});

test('partial runtime records retain canonical tool requirements', () => {
  const { registry, options } = fixture();
  const partial = registry.map(({ metadata, ...agent }) => agent);
  options.toolCatalog = {};
  const result = buildStableAgentFleetMeasurement(partial, options);
  assert.equal(result.ready, false);
  assert(result.agents.every((agent) => agent.missingTools.length > 0));
});

test('unknown context is not ready context', () => {
  const { registry, options } = fixture();
  delete options.intelligenceContext;
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, false);
  assert(result.agents.every((agent) => agent.blockers.includes('dataFreshness_not_ready')));
});

test('bridge context summaries retain negative readiness evidence', () => {
  const { registry, options } = fixture();
  options.intelligenceContext = {
    memoryReady: true,
    skillsReady: true,
    dataFreshnessReady: false,
    readiness: { ready: false },
  };
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, false);
  assert(result.agents.every((agent) => agent.blockers.includes('dataFreshness_not_ready')));
  assert(result.agents.every((agent) => agent.blockers.includes('fleetReadiness_not_ready')));
  assert(result.agents.every((agent) => !agent.blockers.includes('memory_not_ready')));
});

test('positive bridge context summaries are accepted', () => {
  const { registry, options } = fixture();
  options.intelligenceContext = {
    memoryReady: true,
    skillsReady: true,
    dataFreshnessReady: true,
    readiness: { ready: true },
  };
  assert.equal(buildStableAgentFleetMeasurement(registry, options).ready, true);
});

test('health timestamps are not successful action proof', () => {
  const { registry, options } = fixture();
  options.lastActions = {};
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, false);
  assert(result.agents.every((agent) => agent.blockers.includes('last_success_missing')));
});

for (const status of ['queued', 'running', 'pending_approval', 'failed', 'cancelled', '']) {
  test(`${status || 'missing status'} is not successful action proof`, () => {
    const { registry, options } = fixture();
    options.lastActions.ava.status = status;
    const result = buildStableAgentFleetMeasurement(registry, options);
    assert.equal(result.ready, false);
    assert.equal(result.agents.find(({ id }) => id === 'ava').measurement.lastSuccessObserved, false);
  });
}

test('incomplete health probes do not pass', () => {
  const { registry, options } = fixture();
  options.healthProbes = registry.map(({ id }) => ({ id }));
  assert.equal(buildStableAgentFleetMeasurement(registry, options).ready, false);
});

test('measurement does not mutate caller latency arrays', () => {
  const { registry, options } = fixture();
  options.healthProbes[0].latencyMs = 10;
  const before = Object.fromEntries(
    Object.entries(options.latencySamples).map(([id, samples]) => [id, [...samples]])
  );
  const first = buildStableAgentFleetMeasurement(registry, options);
  const second = buildStableAgentFleetMeasurement(registry, options);
  assert.deepEqual(options.latencySamples, before);
  assert.deepEqual(first.agents[0].metrics, second.agents[0].metrics);
});

test('null, blank, boolean and negative latencies are not samples', () => {
  const { registry, options } = fixture();
  options.latencySamples.ava = [null, '', false, -1];
  options.healthProbes[0].latencyMs = null;
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, false);
  assert(result.agents.find(({ id }) => id === 'ava').blockers.includes('latency_not_sampled'));
});

test('reported live latency gaps remain blockers with a healthy context', () => {
  const { registry, options } = fixture();
  options.latencySamples = { ava: [100, 200, 300, 400, 500, 600, 6544] };
  const result = buildStableAgentFleetMeasurement(registry, options);
  assert.equal(result.ready, false);
  assert.equal(result.agents.filter((agent) => agent.blockers.includes('latency_not_sampled')).length, 10);
  const ava = result.agents.find(({ id }) => id === 'ava');
  assert.equal(ava.metrics.latencyP95Ms, 6544);
  assert(ava.blockers.includes('latency_p95_above_budget'));
});
