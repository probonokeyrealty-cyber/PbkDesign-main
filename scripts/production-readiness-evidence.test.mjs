import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import * as maturity from './production-maturity-loop.mjs';

const revision = 'release-under-test';
const executedAt = '2026-11-15T12:00:00.000Z';
const now = Date.parse(executedAt) + 1000;
const run = (runId, overrides = {}) => ({ runId, revision, executed: true, executedAt, provenance: 'controlled', ...overrides });
const metrics = { behaviorPassRate: 1, p95LatencyMs: 1200, errorRate: 0.01, fallbackRate: 0.02 };

function fixture() {
  return {
    revision, now, maxAgeMs: 60_000, requiredScenarioIds: ['stop', 'approval'],
    evidence: {
      failedCallEval: run('eval-1', { scenarios: [{ id: 'stop', passed: true }, { id: 'approval', passed: true }] }),
      behavior: run('behavior-1', { passed: true }),
      silentErrors: run('errors-1', { passed: true }),
      canary: run('comparison-1', {
        provenance: 'operational',
        baseline: run('baseline-1', { revision: 'previous-release', provenance: 'operational', sampleCount: 10, ...metrics }),
        candidate: run('candidate-1', { provenance: 'operational', sampleCount: 10, ...metrics }),
      }),
    },
  };
}

function build(options) {
  assert.equal(typeof maturity.buildExecutedReadinessEvidence, 'function', 'Executed proof must replace packaged readiness defaults');
  return maturity.buildExecutedReadinessEvidence(options);
}

test('packaged scenarios are not executed readiness proof', () => {
  const scenarios = [{ id: 'stop', passed: true, source: 'eval-pack.mjs' }];
  assert.equal(maturity.buildFailedCallEvalGate({ scenarios }).ready, true);
  const result = build({ revision, now, requiredScenarioIds: ['stop'], evidence: { failedCallEval: { scenarios } } });
  assert.equal(result.ready, false);
  assert.equal(result.failedCallEvalGate.ready, false);
  assert.equal(result.canaryPromotionGate.ready, false);
  assert.notEqual(result.shadowCanaryComparison.result, 'shadow_canary_comparison_ready');
});

test('fresh revision-matched executed evaluations and independent canary can pass existing gates', () => {
  const options = fixture();
  const before = JSON.stringify(options);
  const result = build(options);
  assert.equal(result.ready, true);
  assert.equal(result.failedCallEvalGate.passed, 2);
  assert.equal(result.canaryPromotionGate.ready, true);
  assert.equal(result.shadowCanaryComparison.ready, true);
  assert.equal(result.provenance.failedCallEval, 'controlled');
  assert.equal(result.provenance.canary, 'operational');
  assert.equal(result.runs.failedCallEval.runId, 'eval-1');
  assert.equal(result.runs.failedCallEval.executedAt, executedAt);
  assert.equal(result.runs.canary.candidate.revision, revision);
  assert.equal(JSON.stringify(options), before);
});

for (const lane of ['failedCallEval', 'behavior', 'silentErrors', 'canary']) {
  for (const [label, change] of [
    ['missing', () => undefined],
    ['unexecuted fixture', (proof) => ({ ...proof, executed: false })],
    ['undated', (proof) => ({ ...proof, executedAt: undefined })],
    ['stale', (proof) => ({ ...proof, executedAt: new Date(now - 60_001).toISOString() })],
    ['future', (proof) => ({ ...proof, executedAt: new Date(now + 1).toISOString() })],
    ['wrong revision', (proof) => ({ ...proof, revision: 'other-release' })],
    ['no run identity', (proof) => ({ ...proof, runId: '' })],
    ['no provenance', (proof) => ({ ...proof, provenance: undefined })],
    ['synthetic pass', (proof) => ({ ...proof, synthetic: true })],
  ]) {
    test(`${lane}: ${label} cannot establish readiness`, () => {
      const options = fixture();
      options.evidence[lane] = change(options.evidence[lane]);
      const result = build(options);
      assert.equal(result.ready, false);
      assert(result.blockers.some((blocker) => blocker.startsWith(`${lane}:`)));
    });
  }
}

test('absent evidence never passes an empty evaluation set', () => {
  const result = build({ revision, now });
  assert.equal(result.ready, false);
  assert.equal(result.failedCallEvalGate.ready, false);
  assert.equal(result.failedCallEvalGate.passed, 0);
});

for (const scenarios of [
  [], [{ id: 'stop', passed: true }],
  [{ id: 'stop', passed: true }, { id: 'stop', passed: true }, { id: 'approval', passed: true }],
  [{ id: 'stop', passed: false }, { id: 'approval', passed: true }],
  [{ id: 'stop', passed: true }, { id: 'approval', passed: 'true' }],
  [{ id: 'stop', passed: true }, { id: 'approval', passed: true }, { id: 'extra', passed: false }],
]) {
  test(`missing, duplicated or failed scenarios stay blocked: ${JSON.stringify(scenarios)}`, () => {
    const options = fixture();
    options.evidence.failedCallEval.scenarios = scenarios;
    const result = build(options);
    assert.equal(result.ready, false);
    assert.equal(result.failedCallEvalGate.ready, false);
  });
}

for (const lane of ['behavior', 'silentErrors']) {
  test(`${lane} preserves a real failed evaluation`, () => {
    const options = fixture();
    options.evidence[lane].passed = false;
    assert.equal(build(options).ready, false);
  });
}

for (const [label, change] of [
  ['same version', (c) => { c.baseline.revision = revision; }],
  ['same run', (c) => { c.baseline.runId = c.candidate.runId; }],
  ['reference only', (c) => { c.mode = 'same_version_reference'; }],
  ['controlled drill', (c) => { c.provenance = 'controlled'; }],
  ['controlled baseline', (c) => { c.baseline.provenance = 'controlled'; }],
  ['stale baseline', (c) => { c.baseline.executedAt = new Date(now - 60_001).toISOString(); }],
  ['unexecuted candidate', (c) => { c.candidate.executed = false; }],
  ['wrong candidate revision', (c) => { c.candidate.revision = 'other-release'; }],
  ['no samples', (c) => { c.candidate.sampleCount = 0; }],
  ['missing metric', (c) => { delete c.baseline.errorRate; }],
  ['null metric', (c) => { c.candidate.p95LatencyMs = null; }],
  ['latency regression', (c) => { c.candidate.p95LatencyMs = 60_000; }],
]) {
  test(`independent canary proof required: ${label}`, () => {
    const options = fixture();
    change(options.evidence.canary);
    const result = build(options);
    assert.equal(result.ready, false);
    assert.equal(result.shadowCanaryComparison.ready, false);
    assert.notEqual(result.shadowCanaryComparison.result, 'shadow_canary_comparison_ready');
    assert.equal(result.canaryPromotionGate.ready, false);
  });
}

test('invalid verification inputs fail closed and exact freshness boundary is accepted', () => {
  for (const invalid of [{ revision: '' }, { now: NaN }, { maxAgeMs: Infinity }, { maxAgeMs: -1 }, { requiredScenarioIds: [] }]) {
    assert.equal(build({ ...fixture(), ...invalid }).ready, false);
  }
  const options = fixture();
  options.maxAgeMs = 1000;
  assert.equal(build(options).ready, true);
});

test('contradictory operational flags cannot certify operational runs', () => {
  const options = fixture();
  options.evidence.canary.candidate.operational = false;
  assert.equal(build(options).ready, false);
});

test('unexecuted scenario rows cannot certify an executed evaluation run', () => {
  const other = fixture();
  other.evidence.failedCallEval.scenarios[0].executed = false;
  assert.equal(build(other).failedCallEvalGate.ready, false);
  assert.equal(build(other).failedCallEvalGate.passed, 1);
});

test('existing SLO burns still prevent promotion when executed proof otherwise passes', () => {
  const result = build({ ...fixture(), sloStatus: { burned: ['ava_latency'] } });
  assert.equal(result.ready, false);
  assert(result.canaryPromotionGate.blockers.includes('slo_budget_burned:ava_latency'));
});

test('out-of-range clocks fail closed without throwing and malformed evidence is absent proof', () => {
  assert.equal(build({ ...fixture(), now: Number.MAX_VALUE }).ready, false);
  assert.equal(build({ ...fixture(), evidence: null }).ready, false);
});
