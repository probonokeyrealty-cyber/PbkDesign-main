import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from '@jest/globals';
import * as protocol from './canary-evidence-protocol.mjs';
import { canonicalJson } from './skill-governance-store.mjs';
import { buildExecutedReadinessEvidence } from './production-maturity-loop.mjs';
import { makeCanaryFixture, rebuildCanaryFixture, resignCanaryRow } from './fixtures/canary-evidence-fixture.mjs';

const verify = (f) => protocol.verifyCanaryChain(f);
const clone = (value) => JSON.parse(JSON.stringify(value));
const obs = (f, side = 'candidate') => f.observations.filter((row) => row.report.runId === f.runs.find((r) => r.report.side === side).id);
const rebind = (f) => rebuildCanaryFixture(f, { membership: false, counters: false });
const authenticate = (f) => rebuildCanaryFixture(f, { counters: false });
function denied(f, expected) {
  const result = verify(f);
  assert.equal(result.verified, false);
  assert.deepEqual(result.evidence, {});
  if (expected) assert.equal(result.result, expected);
  assert(Buffer.byteLength(JSON.stringify(result.diagnostics)) <= 8192);
  if (f.secret) assert(!JSON.stringify(result).includes(f.secret));
  return result;
}

test('authentic independent versions yield only recomputed nearest-rank metrics and run facts', () => {
  const f = makeCanaryFixture();
  const rows = obs(f);
  rows[0].report.outcome = 'error'; rows[0].report.behaviorPassed = false;
  rows[1].report.fallback = true; rows[2].report.fallback = true;
  rebuildCanaryFixture(f);
  const before = canonicalJson(f);
  const result = verify(f);
  assert.equal(result.verified, true);
  assert.equal(result.result, 'canary_evidence_verified');
  const c = result.evidence.canary;
  assert.notEqual(c.baseline.runId, c.candidate.runId);
  assert.notEqual(c.baseline.revision, c.candidate.revision);
  assert.deepEqual(c, {
    runId: f.comparison.id, revision: f.revision, executed: true,
    executedAt: f.comparison.report.completedAt, provenance: 'operational',
    baseline: { runId: f.runs[0].id, revision: f.runs[0].report.revision, executed: true,
      executedAt: f.runs[0].report.completedAt, provenance: 'operational', sampleCount: 20,
      behaviorPassRate: 1, p95LatencyMs: 100, errorRate: 0, fallbackRate: 0 },
    candidate: { runId: f.runs[1].id, revision: f.revision, executed: true,
      executedAt: f.runs[1].report.completedAt, provenance: 'operational', sampleCount: 20,
      behaviorPassRate: 19 / 20, p95LatencyMs: 100, errorRate: 1 / 20, fallbackRate: 2 / 20 },
  });
  assert.equal(canonicalJson(f), before);
});

test('valid bad metrics remain authenticated and blocked by the unchanged readiness gate', () => {
  const f = makeCanaryFixture();
  for (const row of obs(f)) Object.assign(row.report, { outcome: 'error', behaviorPassed: false, fallback: true, latencyMs: 2000 });
  rebuildCanaryFixture(f);
  const result = verify(f);
  assert.equal(result.verified, true);
  assert.deepEqual(Object.fromEntries(['sampleCount', 'behaviorPassRate', 'errorRate', 'fallbackRate', 'p95LatencyMs']
    .map((key) => [key, result.evidence.canary.candidate[key]])),
  { sampleCount: 20, behaviorPassRate: 0, errorRate: 1, fallbackRate: 1, p95LatencyMs: 2000 });
  const proof = { runId: 'other-proof', revision: f.revision, executed: true,
    executedAt: f.comparison.report.completedAt, provenance: 'operational', passed: true };
  const ready = buildExecutedReadinessEvidence({ revision: f.revision, now: f.now, requiredScenarioIds: ['stop'],
    evidence: { ...result.evidence, failedCallEval: { ...proof, scenarios: [{ id: 'stop', passed: true }] },
      behavior: proof, silentErrors: { ...proof, scope: 'durable_operational_audit' } } });
  assert.equal(ready.ready, false);
  assert.equal(ready.canaryPromotionGate.ready, false);
  for (const code of ['behavior_pass_rate_below_threshold', 'p95_latency_regression', 'error_rate_regression', 'fallback_rate_regression']) {
    assert(ready.shadowCanaryComparison.blockers.includes(code));
  }
});

test('good authenticated metrics pass only the canary gate, never supply other readiness lanes', () => {
  const f = makeCanaryFixture();
  const result = buildExecutedReadinessEvidence({ revision: f.revision, now: f.now, requiredScenarioIds: ['stop'], evidence: verify(f).evidence });
  assert.equal(result.shadowCanaryComparison.ready, true);
  assert.equal(result.ready, false);
});

test('row digest binds exactly the canonical physical projection including signature and microseconds', () => {
  const f = makeCanaryFixture();
  const row = f.observations[0];
  assert.equal(protocol.canaryRowDigest(row), createHash('sha256').update(canonicalJson(row)).digest('hex'));
  const original = protocol.canaryRowDigest(row);
  for (const key of Object.keys(row)) {
    const changed = clone(row);
    if (key === 'report') changed.report.attestation.signature = '0'.repeat(64);
    else if (key === 'created_at_exact') changed[key] = changed[key].replace('000000Z', '000001Z');
    else changed[key] = typeof changed[key] === 'number' ? changed[key] + 1 : typeof changed[key] === 'boolean' ? !changed[key] : `${changed[key]}x`;
    assert.notEqual(protocol.canaryRowDigest(changed), original);
  }
  assert.throws(() => protocol.canaryRowDigest({ ...row, created_at: new Date() }));
});

for (const [label, mutate] of [
  ['missing comparison', (f) => { f.comparison = null; }],
  ['missing run', (f) => { f.runs.pop(); }],
  ['extra run', (f) => { f.runs.push(clone(f.runs[0])); }],
  ['missing observation', (f) => { f.observations.pop(); }],
  ['extra observation', (f) => { f.observations.push(clone(f.observations[0])); }],
  ['wrong key', (f) => { f.secret = 'wrong-fixture-key'; }],
  ['empty key', (f) => { f.secret = ''; }],
  ['wrong revision', (f) => { f.revision = 'c'.repeat(40); }],
  ['bad policy hash', (f) => { f.policyHash = 'bad'; }],
  ['different policy hash', (f) => { f.policyHash = 'd'.repeat(64); }],
  ['invalid now', (f) => { f.now = NaN; }],
  ['coerced now', (f) => { f.now = String(f.now); }],
  ['out of range now', (f) => { f.now = Number.MAX_VALUE; }],
]) test(`input rejection: ${label}`, () => { const f = makeCanaryFixture(); mutate(f); denied(f); });

for (const kind of ['comparison', 'run', 'observation']) {
  const target = (f) => kind === 'comparison' ? f.comparison : kind === 'run' ? f.runs[1] : obs(f)[0];
  const mutations = [
    ['schema', (r) => { r.report.schemaVersion = 'other'; }],
    ['kind', (r) => { r.report.kind = 'unknown'; }],
    ['tenant', (r) => { r.report.tenantId = 'other'; }],
    ['id', (r) => { r.report.id += 'x'; }],
    ['revision type', (r) => { r.report.revision = 123; }],
    ['uppercase revision', (r) => { r.report.revision = 'A'.repeat(40); }],
    ['provenance', (r) => { r.report.provenance = 'controlled'; }],
    ['scope', (r) => { r.report.scope = 'same_version_reference'; }],
    ['not executed', (r) => { r.report.executed = false; }],
    ['unknown status', (r) => { r.report.status = 'cancelled'; }],
    ['metric', (r) => { r.report.metricVersion = 'other'; }],
    ['policy', (r) => { r.report.policyHash = 'e'.repeat(64); }],
    ['cohort', (r) => { r.report.cohortRef = 'e'.repeat(64); }],
    ['extra field', (r) => { r.report.synthetic = false; }],
    ['contradictory flag', (r) => { r.report.operational = false; }],
    ['aggregate pass', (r) => { r.report.passed = true; }],
    ['caller ratio', (r) => { r.report.errorRate = 0; }],
    ['missing field', (r) => { delete r.report.provenance; }],
    ['start after end', (r) => { r.report.startedAt = new Date(Date.parse(r.report.completedAt) + 1).toISOString(); }],
    ['zero duration', (r) => { r.report.startedAt = r.report.completedAt; }],
    ['admission after end one microsecond', (r) => { r.report.admittedAt = r.report.completedAt.replace('Z', '001Z'); r.created_at_exact = r.report.admittedAt; }],
    ['microsecond mismatch', (r) => { r.created_at_exact = r.created_at_exact.replace('000Z', '001Z'); }],
    ['millisecond admission', (r) => { r.report.admittedAt = r.report.startedAt; r.created_at_exact = r.report.admittedAt; }],
    ['noncanonical start', (r) => { r.report.startedAt = r.report.startedAt.replace('.000Z', 'Z'); }],
    ['invalid calendar', (r) => { r.report.startedAt = '2026-02-30T12:00:00.000Z'; }],
    ['physical tenant', (r) => { r.tenant_id = 'other'; }],
    ['physical suite', (r) => { r.suite_name = 'other'; }],
    ['physical source', (r) => { r.source = 'other'; }],
    ['physical id', (r) => { r.id += 'x'; }],
    ['counter string', (r) => { r.total = String(r.total); }],
    ['counter mismatch', (r) => { r.failed += 1; }],
    ['result mismatch', (r) => { r.ok = !r.ok; }],
  ];
  for (const [label, mutate] of mutations) test(`${kind} signed rejection: ${label}`, () => {
    const f = makeCanaryFixture(); mutate(target(f));
    (kind === 'observation' ? authenticate : rebind)(f); denied(f);
  });
  for (const [label, mutate] of [
    ['changed signed body', (r) => { r.report.cohortRef = 'f'.repeat(64); }],
    ['wrong signature', (r) => { r.report.attestation.signature = '0'.repeat(64); }],
    ['short signature', (r) => { r.report.attestation.signature = '0'; }],
    ['uppercase signature', (r) => { r.report.attestation.signature = 'F'.repeat(64); }],
    ['attestation version', (r) => { r.report.attestation.version = 'other'; }],
    ['attestation extra', (r) => { r.report.attestation.extra = true; }],
    ['missing attestation', (r) => { delete r.report.attestation; }],
    ['extra physical metadata', (r) => { r.created_at = new Date(); }],
  ]) test(`${kind} unsigned rejection: ${label}`, () => {
    const f = makeCanaryFixture(); mutate(target(f)); denied(f);
  });
}

for (const [label, mutate] of [
  ['shared executions', (f) => { obs(f)[0].report.executionRef = obs(f, 'baseline')[0].report.executionRef; }],
  ['duplicate execution on one side', (f) => { obs(f)[0].report.executionRef = obs(f)[1].report.executionRef; }],
  ['different workloads', (f) => { obs(f)[0].report.workloadRef = 'f'.repeat(64); }],
  ['wrong comparison', (f) => { obs(f)[0].report.comparisonId = `canary_comparison_${'f'.repeat(64)}`; }],
  ['wrong run', (f) => { obs(f)[0].report.runId = f.runs[0].id; }],
  ['wrong observation revision', (f) => { obs(f)[0].report.revision = f.runs[0].report.revision; }],
  ['wrong side', (f) => { f.runs[1].report.side = 'baseline'; }],
  ['wrong run comparison', (f) => { f.runs[1].report.comparisonId = `canary_comparison_${'e'.repeat(64)}`; }],
  ['same revision', (f) => { f.runs[0].report.revision = f.revision; }],
  ['outside run bounds', (f) => { obs(f)[0].report.startedAt = f.comparison.report.startedAt; }],
  ['outside comparison bounds', (f) => { f.runs[0].report.completedAt = new Date(f.now).toISOString(); }],
]) test(`chain rejection: ${label}`, () => { const f = makeCanaryFixture(); mutate(f); authenticate(f); denied(f); });

for (const [label, mutate] of [
  ['run digest', (f) => { f.comparison.report.baseline.digest = '0'.repeat(64); }],
  ['run reference revision', (f) => { f.comparison.report.baseline.revision = 'c'.repeat(40); }],
  ['shared run id', (f) => { f.comparison.report.baseline = { ...f.comparison.report.candidate }; }],
  ['extra side reference field', (f) => { f.comparison.report.baseline.extra = true; }],
]) test(`comparison binding rejection: ${label}`, () => {
  const f = makeCanaryFixture(); mutate(f); resignCanaryRow(f.comparison, f.secret); denied(f);
});

for (const [label, mutate] of [
  ['unsorted membership', (r) => { r.observations.reverse(); }],
  ['duplicate membership', (r) => { r.observations[1] = { ...r.observations[0] }; }],
  ['omitted admitted member', (r) => { r.observations.pop(); }],
  ['empty membership', (r) => { r.observations = []; r.admittedCount = 0; }],
  ['count mismatch', (r) => { r.admittedCount++; }],
  ['string count', (r) => { r.admittedCount = String(r.admittedCount); }],
  ['member digest', (r) => { r.observations[0].digest = '0'.repeat(64); }],
  ['member extra', (r) => { r.observations[0].extra = true; }],
  ['member malformed id', (r) => { r.observations[0].id = 'raw-seller-id'; }],
]) test(`membership rejection: ${label}`, () => {
  const f = makeCanaryFixture(); mutate(f.runs[1].report); rebind(f); denied(f);
});

for (const [key, value] of [
  ['latencyMs', '1'], ['latencyMs', null], ['latencyMs', NaN], ['latencyMs', Infinity], ['latencyMs', -1], ['latencyMs', 2000.001],
  ['outcome', 'pending'], ['outcome', 'skipped'], ['outcome', 'cancelled'], ['fallback', 0], ['behaviorPassed', 'true'],
  ['executionRef', 'raw-call'], ['workloadRef', 'F'.repeat(64)],
]) test(`observation rejects ${key}=${String(value)}`, () => {
  const f = makeCanaryFixture(); obs(f)[0].report[key] = value; rebuildCanaryFixture(f); denied(f);
});
test('error outcome cannot assert behavior success', () => {
  const f = makeCanaryFixture(); obs(f)[0].report.outcome = 'error'; rebuildCanaryFixture(f); denied(f);
});

test('all admitted errors and fallbacks are required even when omitting them improves metrics', () => {
  const f = makeCanaryFixture(); const row = obs(f)[0];
  Object.assign(row.report, { outcome: 'error', behaviorPassed: false, fallback: true }); rebuildCanaryFixture(f);
  f.observations = f.observations.filter((r) => r !== row); denied(f);
});

for (const kind of ['comparison', 'run']) test(`authenticated pending ${kind} denies proof, unauthenticated pending is invalid`, () => {
  const f = makeCanaryFixture(); const row = kind === 'comparison' ? f.comparison : f.runs[1];
  Object.assign(row.report, { status: 'pending', executed: false, completedAt: null });
  if (kind === 'comparison') { row.report.baseline = null; row.report.candidate = null; resignCanaryRow(row, f.secret); }
  else rebind(f);
  denied(f, 'canary_evidence_pending');
  row.report.attestation.signature = '0'.repeat(64);
  denied(f, 'canary_evidence_invalid');
});

for (const [label, mutate] of [
  ['stale admission', (f) => { f.comparison.report.admittedAt = new Date(f.now - 86_400_001).toISOString().replace('Z', '000Z'); f.comparison.created_at_exact = f.comparison.report.admittedAt; }],
  ['stale observation', (f) => { obs(f)[0].report.startedAt = new Date(f.now - 86_400_001).toISOString(); }],
  ['future admission microsecond', (f) => { f.comparison.report.admittedAt = new Date(f.now).toISOString().replace('Z', '001Z'); f.comparison.created_at_exact = f.comparison.report.admittedAt; }],
  ['future completion', (f) => { f.comparison.report.completedAt = new Date(f.now + 1).toISOString(); }],
  ['stale chain final clock', (f) => { f.now += 86_400_000; }],
]) test(`freshness rejection: ${label}`, () => { const f = makeCanaryFixture(); mutate(f); authenticate(f); denied(f); });

test('exact 24-hour admission boundary is allowed; one microsecond older is stale', () => {
  const f = makeCanaryFixture(); const boundary = f.now - 86_400_000;
  f.comparison.report.admittedAt = new Date(boundary).toISOString().replace('Z', '000Z');
  f.comparison.created_at_exact = f.comparison.report.admittedAt; resignCanaryRow(f.comparison, f.secret);
  assert.equal(verify(f).verified, true);
  f.comparison.report.admittedAt = new Date(boundary - 1).toISOString().replace('Z', '999Z');
  f.comparison.created_at_exact = f.comparison.report.admittedAt; resignCanaryRow(f.comparison, f.secret);
  denied(f, 'canary_evidence_stale');
});

test('256 samples per side verify, 257 fail instead of truncating', () => {
  assert.equal(verify(makeCanaryFixture({ sampleCount: 256 })).verified, true);
  denied(makeCanaryFixture({ sampleCount: 257 }));
});
for (const kind of ['comparison', 'run', 'observation']) test(`oversized ${kind} is rejected with bounded redacted diagnostics`, () => {
  const f = makeCanaryFixture(); const row = kind === 'comparison' ? f.comparison : kind === 'run' ? f.runs[0] : f.observations[0];
  row.report.cohortRef = 'PRIVATE-PAYLOAD'.repeat(6000); authenticate(f);
  const result = denied(f, 'canary_evidence_limit_exceeded'); assert(!JSON.stringify(result).includes('PRIVATE-PAYLOAD'));
});

for (const [label, change] of [
  ['accessor', (r) => { Object.defineProperty(r.report, 'provenance', { enumerable: true, get() { throw new Error('must not invoke'); } }); }],
  ['custom prototype', (r) => { Object.setPrototypeOf(r.report, { inherited: true }); }],
  ['cycle', (r) => { r.report.cycle = r.report; }],
  ['symbol', (r) => { r.report[Symbol('hidden')] = true; }],
  ['nonenumerable', (r) => { Object.defineProperty(r.report, 'hidden', { value: true }); }],
  ['array extra', (r, f) => { f.runs[0].report.observations.extra = true; }],
  ['sparse array', (r, f) => { delete f.runs[0].report.observations[0]; }],
]) test(`non-JSON shape rejection without executing hooks: ${label}`, () => {
  const f = makeCanaryFixture(); change(f.comparison, f); denied(f);
});

test('top-level array accessors are rejected without invoking the getter', () => {
  const f = makeCanaryFixture(); let invoked = 0;
  Object.defineProperty(f.observations, '0', { enumerable: true, get() { invoked++; return null; } });
  denied(f);
  assert.equal(invoked, 0);
});

test('top-level dependency accessors are rejected without invoking the getter', () => {
  const f = makeCanaryFixture(); let invoked = 0;
  Object.defineProperty(f, 'secret', { get() { invoked++; return 'private'; } });
  const result = verify(f);
  assert.equal(result.verified, false); assert.deepEqual(result.evidence, {}); assert.equal(invoked, 0);
});

test('cumulative row and byte limits reject the whole chain', () => {
  const f = makeCanaryFixture();
  f.observations = Array.from({ length: 1098 }, () => f.observations[0]);
  denied(f, 'canary_evidence_limit_exceeded');
  const g = makeCanaryFixture();
  g.observations[0].report.workloadRef = 'x'.repeat(1_100_000);
  g.observations[1].report.workloadRef = 'y'.repeat(1_100_000);
  denied(g, 'canary_evidence_limit_exceeded');
});

test('workload comparison is a multiset, not a set', () => {
  const f = makeCanaryFixture();
  const [a, b] = obs(f).map((row) => row.report.workloadRef);
  for (const [side, workloads] of [['baseline', [a, a, b]], ['candidate', [a, b, b]]]) {
    workloads.forEach((workloadRef, i) => { obs(f, side)[i].report.workloadRef = workloadRef; });
  }
  rebuildCanaryFixture(f); denied(f);
  const g = makeCanaryFixture();
  for (const side of ['baseline', 'candidate']) obs(g, side)[1].report.workloadRef = obs(g, side)[0].report.workloadRef;
  rebuildCanaryFixture(g); assert.equal(verify(g).verified, true);
});

test('zero latency is valid and nearest rank works for one and two samples', () => {
  for (const [sampleCount, want] of [[1, 0], [2, 10]]) {
    const f = makeCanaryFixture({ sampleCount });
    for (const side of ['baseline', 'candidate']) obs(f, side)[0].report.latencyMs = 0;
    rebuildCanaryFixture(f);
    assert.equal(verify(f).evidence.canary.candidate.p95LatencyMs, want);
  }
});

test('proxy receipts are rejected without invoking traps or accepting shifting views', () => {
  const f = makeCanaryFixture(); let invoked = 0;
  f.comparison.report = new Proxy(f.comparison.report, {
    getPrototypeOf(target) { invoked++; return Reflect.getPrototypeOf(target); },
  });
  denied(f);
  assert.equal(invoked, 0);
});

test('child signatures must verify even when all parent digests are rebound correctly', () => {
  const digest = (row) => createHash('sha256').update(canonicalJson(row)).digest('hex');
  for (const kind of ['run', 'observation']) {
    const f = makeCanaryFixture();
    if (kind === 'observation') {
      const child = obs(f)[0]; child.report.attestation.signature = '0'.repeat(64);
      f.runs[1].report.observations.find((ref) => ref.id === child.id).digest = digest(child);
      resignCanaryRow(f.runs[1], f.secret);
    } else f.runs[1].report.attestation.signature = '0'.repeat(64);
    f.comparison.report.candidate.digest = digest(f.runs[1]); resignCanaryRow(f.comparison, f.secret);
    denied(f, 'canary_evidence_invalid');
  }
});

test('microsecond admissions preserve valid sub-millisecond precision and cannot fall after completion', () => {
  const f = makeCanaryFixture(); const row = obs(f)[0];
  row.report.admittedAt = row.report.startedAt.replace('Z', '001Z'); row.created_at_exact = row.report.admittedAt;
  rebuildCanaryFixture(f); assert.equal(verify(f).verified, true);
  row.report.admittedAt = row.report.completedAt.replace('Z', '001Z'); row.created_at_exact = row.report.admittedAt;
  rebuildCanaryFixture(f); denied(f);
});

for (const kind of ['comparison', 'run', 'observation']) {
  for (const field of ['admittedAt', 'startedAt', 'completedAt']) {
    for (const age of ['future', 'stale']) test(`${kind} ${field} cannot be ${age}`, () => {
      const f = makeCanaryFixture(); const row = kind === 'comparison' ? f.comparison : kind === 'run' ? f.runs[0] : f.observations[0];
      const time = new Date(f.now + (age === 'future' ? 1 : -86_400_001)).toISOString();
      row.report[field] = field === 'admittedAt' ? time.replace('Z', '000Z') : time;
      if (field === 'admittedAt') row.created_at_exact = row.report[field];
      authenticate(f); denied(f, `canary_evidence_${age}`);
    });
  }
}

for (const [label, mutate] of [
  ['duplicate run rows', (f) => { f.runs[1] = clone(f.runs[0]); }],
  ['duplicate observation rows', (f) => { f.observations[1] = clone(f.observations[0]); }],
  ['shared observation membership', (f) => {
    f.runs[1].report.observations[0] = { ...f.runs[0].report.observations[0] };
    f.runs[1].report.observations.sort((a, b) => a.id.localeCompare(b.id)); rebind(f);
  }],
  ['unknown observation row', (f) => { const row = clone(f.observations[0]); row.id = `canary_observation_${'f'.repeat(64)}`; f.observations.push(row); }],
]) test(`source reuse rejection: ${label}`, () => { const f = makeCanaryFixture(); mutate(f); denied(f); });

test('missing and malformed inputs never throw or expose arbitrary diagnostics', () => {
  for (const value of [undefined, null, {}, [], 'private-payload']) {
    const result = protocol.verifyCanaryChain(value);
    assert.equal(result.verified, false); assert.deepEqual(result.evidence, {});
    assert.deepEqual(result.diagnostics, { codes: ['canary_evidence_invalid'] });
  }
});
