import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { buildAgentExecutionEvidence, collectAgentFleetEvidence } from './agent-fleet-measurement.mjs';
import { buildDefaultAgentRegistry, buildStableAgentFleetMeasurement } from './agent-registry.mjs';

const ENV_KEY = 'PBK_AGENT_LATENCY_BUDGETS_MS';
// Explicit fixture policy, not production SLO defaults.
const configured = {
  chat: { completion: 80_000 },
  phone: { completion: 12_000, speech_start: 2500, speech_completion: 15_000 },
  research: { completion: 60_000 },
  provider: { completion: 10_000 },
};
const policyFor = (matrix = configured) => getAgentLatencyPolicy({ [ENV_KEY]: JSON.stringify(matrix) });

function fixture() {
  const at = '2026-11-16T12:00:00.000Z';
  const now = Date.parse(at);
  const registry = buildDefaultAgentRegistry({ env: {}, now });
  const agent = registry.find(({ id }) => id === 'ava');
  const tasks = [
    ['chat', 71_660, { firstTokenMs: 800 }],
    ['phone', 9000, { firstTokenMs: 1000, speechStartMs: 2000, speechCompletionMs: 11_000 }],
    ['research', 25_000, {}],
    ['provider', 4500, {}],
  ].map(([channel, durationMs, timings]) => {
    const id = `fixture-${channel}`;
    return { id, agentId: 'ava', status: 'complete', completedAt: at, metadata: {
      workOrder: { id },
      executionEvidence: buildAgentExecutionEvidence({ agentId: 'ava', channel, durationMs, timings,
        completedAt: at, workOrderId: id,
        output: { ok: true, routedTo: 'agent_brain', response: { ok: true, answer: 'Fixture response.' } },
      }),
    } };
  });
  const evidence = collectAgentFleetEvidence({ agentTasks: tasks }, { now });
  return { registry, tasks, options: {
    now, requiredIds: ['ava'], requireSourceProvenance: true,
    toolCatalog: Object.fromEntries(agent.metadata.requiredTools.map((tool) => [tool, true])),
    healthProbes: [{ id: 'ava', ready: true, present: true, lastSeen: at }],
    ...evidence,
    intelligenceContext: { identity: { leadId: 'fixture-lead' }, memoryReady: true, skillsReady: true,
      dataFreshness: { ready: true, lastSyncAt: at,
        source: { kind: 'runtime_lead_record', recordId: 'fixture-lead', at } },
      readiness: { ready: true },
    },
  } };
}

function measure(policy, setup = fixture()) {
  return buildStableAgentFleetMeasurement(setup.registry, {
    ...setup.options, latencyBudgetsMs: policy.budgets, latencyPolicy: policy,
  });
}

for (const [channel, field, kind] of [
  ['chat', 'firstTokenMs', 'first_token'],
  ['phone', 'firstTokenMs', 'first_token'],
  ['phone', 'speechStartMs', 'speech_start'],
  ['phone', 'speechCompletionMs', 'speech_completion'],
]) {
  test(`configured ${channel} policy cannot qualify missing ${kind} observations`, () => {
    const setup = fixture();
    const tasks = setup.tasks.filter(task => task.metadata.executionEvidence.channel === channel);
    for (const task of tasks) delete task.metadata.executionEvidence.timings[field];
    Object.assign(setup.options, collectAgentFleetEvidence({ agentTasks: tasks }, { now: setup.options.now }));
    const result = measure(policyFor(), setup);
    assert.equal(result.ready, false);
    assert.equal(result.agents[0].measurement.latencyMeasured, false);
    assert(result.agents[0].blockers.includes(`latency_milestone_missing:${channel}:${kind}`));
  });
}

test('complete configured policy defaults only chat and phone first-token SLOs', () => {
  const policy = policyFor();
  assert.equal(policy.ready, true);
  assert.deepEqual(policy.issues, []);
  assert.deepEqual(policy.budgets, {
    chat: { first_token: 1800, completion: 80_000 },
    phone: { first_token: 1800, completion: 12_000, speech_start: 2500, speech_completion: 15_000 },
    research: { completion: 60_000 }, provider: { completion: 10_000 },
  });
});

test('explicit positive finite overrides and allowlisted optional milestones are preserved', () => {
  const matrix = Object.fromEntries(['chat', 'phone', 'research', 'provider'].map((channel) => [channel,
    { first_token: 0.5, completion: 100_000, speech_start: 20, speech_completion: 110_000 },
  ]));
  assert.deepEqual(policyFor(matrix).budgets, matrix);
  assert.equal(policyFor(matrix).ready, true);
});

for (const [label, env] of [
  ['absent', {}], ['empty', { [ENV_KEY]: '' }], ['blank', { [ENV_KEY]: '  ' }],
  ['undefined', { [ENV_KEY]: undefined }],
]) {
  test(`${label} policy is explicitly blocked with no usable budgets`, () => {
    const policy = getAgentLatencyPolicy(env);
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.includes(`policy_missing:${ENV_KEY}`));
    const result = measure(policy);
    assert.equal(result.ready, false);
    assert(result.agents[0].blockers.includes('latency_budget_unknown:chat:completion'));
  });
}

for (const [channel, kind] of [
  ['chat', 'completion'], ['phone', 'completion'], ['phone', 'speech_start'],
  ['phone', 'speech_completion'], ['research', 'completion'], ['provider', 'completion'],
]) {
  test(`missing ${channel}.${kind} fails the entire policy closed`, () => {
    const matrix = structuredClone(configured);
    delete matrix[channel][kind];
    const policy = policyFor(matrix);
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.includes(`budget_missing:${channel}:${kind}`));
    assert.equal(measure(policy).ready, false);
  });
}

for (const [label, raw] of [
  ['malformed JSON', '{'], ['null JSON', 'null'], ['array JSON', '[]'],
  ['string JSON', '"policy"'], ['numeric JSON', '1800'], ['boolean JSON', 'true'],
  ['object environment value', configured], ['number environment value', 1800],
  ['null environment value', null], ['array environment value', []],
]) {
  test(`${label} is rejected without throwing or echoing the supplied value`, () => {
    const policy = getAgentLatencyPolicy({ [ENV_KEY]: raw });
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.length > 0);
    assert(policy.issues.every((issue) => typeof issue === 'string'));
  });
}

for (const value of [null, '', '80000', true, false, [], {}, 0, -1]) {
  test(`invalid numeric budget ${JSON.stringify(value)} cannot be coerced or partially accepted`, () => {
    const policy = policyFor({ ...configured, chat: { completion: value } });
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.includes('budget_invalid:chat:completion'));
    assert.equal(measure(policy).ready, false);
  });
}

for (const token of ['1e309', '-1e309', 'NaN', 'Infinity']) {
  test(`nonfinite ${token} budget fails closed`, () => {
    const raw = JSON.stringify(configured).replace('80000', token);
    const policy = getAgentLatencyPolicy({ [ENV_KEY]: raw });
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.length > 0);
  });
}

for (const channelValue of [null, [], '80000', 80000, true]) {
  test(`invalid channel matrix ${JSON.stringify(channelValue)} fails closed`, () => {
    const policy = policyFor({ ...configured, chat: channelValue });
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.includes('channel_invalid:chat'));
  });
}

for (const extra of [
  { unknown: { completion: 10 } }, { Chat: { completion: 10 } },
  { chat: { ...configured.chat, firstTokenMs: 10 } },
  { provider: { ...configured.provider, timeoutMs: 10 } },
  JSON.parse('{"__proto__":{"completion":10}}'),
  { phone: JSON.parse('{"completion":12000,"speech_start":2500,"speech_completion":15000,"constructor":10}') },
]) {
  test(`unknown keys ${JSON.stringify(extra)} invalidate otherwise complete configuration`, () => {
    const policy = policyFor({ ...configured, ...extra });
    assert.equal(policy.ready, false);
    assert.deepEqual(policy.budgets, {});
    assert(policy.issues.length > 0);
    assert.equal(measure(policy).ready, false);
  });
}

test('diagnostics never reflect arbitrary untrusted keys or configuration contents', () => {
  const policy = policyFor({ ...configured, 'private-fixture-value': { 'sensitive-fixture-value': 100 } });
  assert.equal(policy.ready, false);
  assert(!JSON.stringify(policy).includes('private-fixture-value'));
  assert(!JSON.stringify(policy).includes('sensitive-fixture-value'));
});

test('valid channel-specific policy qualifies supplied fresh source-bound timings in exact milestone order', () => {
  const setup = fixture();
  assert.deepEqual(setup.options.latencyObservations.ava.map(({ channel, kind, valueMs }) => [channel, kind, valueMs]), [
    ['chat', 'completion', 71_660], ['chat', 'first_token', 800],
    ['phone', 'completion', 9000], ['phone', 'first_token', 1000],
    ['phone', 'speech_start', 2000], ['phone', 'speech_completion', 11_000],
    ['research', 'completion', 25_000], ['provider', 'completion', 4500],
  ]);
  const result = measure(policyFor(), setup);
  assert.equal(result.ready, true);
  assert.equal(result.measuredCount, 1);
  assert.deepEqual(result.agents[0].blockers, []);
  assert.equal(result.agents[0].metrics.latencyByKind.chat.completion.p95Ms, 71_660);
  assert.equal(result.agents[0].metrics.latencyByKind.chat.first_token.budgetMs, 1800);
});

test('budget comparisons report a slow completion without truncating or discarding its evidence', () => {
  const setup = fixture();
  const before = JSON.stringify(setup);
  const result = measure(policyFor({ ...configured, chat: { completion: 60_000 } }), setup);
  assert.equal(result.ready, false);
  assert(result.agents[0].blockers.includes('latency_p95_above_budget:chat:completion'));
  assert.equal(result.agents[0].metrics.latencyByKind.chat.first_token.withinBudget, true);
  assert.equal(result.agents[0].metrics.latencyByKind.chat.completion.p95Ms, 71_660);
  assert.equal(JSON.stringify(setup), before);
});

for (const change of [
  { kind: 'unknown' }, { channel: 'unknown' }, { verified: false },
  { valueMs: null }, { at: '2020-01-01T00:00:00.000Z' },
  { at: '2030-01-01T00:00:00.000Z' }, { source: 'legacy' }, { recordId: '' },
]) {
  test(`valid policy cannot mask mixed bad timing evidence ${JSON.stringify(change)}`, () => {
    const setup = fixture();
    setup.options.latencyObservations.ava.push({ ...setup.options.latencyObservations.ava[0], ...change });
    const result = measure(policyFor(), setup);
    assert.equal(result.ready, false);
    assert.equal(result.agents[0].metrics.latencyObservationCount, 9);
  });
}

test('valid policy does not relabel or suppress collected legacy observations', () => {
  const setup = fixture();
  setup.options = { ...setup.options, ...collectAgentFleetEvidence({ agentTasks: [...setup.tasks,
    { id: 'legacy-fixture', agentId: 'ava', status: 'complete', latencyMs: 90_000,
      completedAt: new Date(setup.options.now).toISOString(), metadata: {} },
  ] }, { now: setup.options.now }) };
  const result = measure(policyFor(), setup);
  assert.equal(result.ready, false);
  assert.equal(result.agents[0].metrics.unverifiedLatencyP95Ms, 90_000);
  assert(result.agents[0].blockers.includes('latency_kind_unknown:unknown:unknown'));
});

test('valid policy cannot manufacture absent samples or source context', () => {
  const setup = fixture();
  setup.options.latencyObservations = {};
  assert.equal(measure(policyFor(), setup).ready, false);
  const withoutContext = fixture();
  delete withoutContext.options.intelligenceContext;
  assert(measure(policyFor(), withoutContext).agents[0].blockers.includes('dataFreshness_not_ready'));
});

for (const change of ['old', 'missing', 'mismatched']) {
  test(`valid policy leaves ${change} source freshness blocked`, () => {
    const setup = fixture();
    const freshness = setup.options.intelligenceContext.dataFreshness;
    if (change === 'old') setup.options.now += 60_001;
    if (change === 'missing') delete freshness.source;
    if (change === 'mismatched') freshness.source.recordId = 'another-fixture-lead';
    const result = measure(policyFor(), setup);
    assert.equal(result.ready, false);
    assert(result.agents[0].blockers.includes('dataFreshness_not_ready'));
    assert(result.agents[0].blockers.includes('fleetReadiness_not_ready'));
  });
}

test('policy reads are isolated from earlier results and do not mutate caller environment', () => {
  const env = Object.freeze({ [ENV_KEY]: JSON.stringify(configured) });
  const first = getAgentLatencyPolicy(env);
  first.budgets.chat.completion = 1;
  const second = getAgentLatencyPolicy(env);
  assert.equal(second.budgets.chat.completion, 80_000);
  assert.equal(second.budgets.chat.first_token, 1800);
  assert.equal(second.ready, true);
});
