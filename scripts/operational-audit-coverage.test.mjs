import assert from 'node:assert/strict';
import { afterAll, beforeAll, jest, test } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { canonicalJson } from './skill-governance-store.mjs';
import { collectOperationalAudit } from './operational-audit-collector.mjs';
import * as store from './operational-audit-store.mjs';
import { createAuditFixture, auditFixtureHealth } from './operational-audit-test-fixture.mjs';
import { readRuntimeCoverage } from './runtime-coverage-store.mjs';
import { createRuntimeCoverageSampler } from './runtime-coverage-sampler.mjs';
import { collectRuntimeSourceSnapshot } from './runtime-source-evidence.mjs';
import { AGENT_LATENCY_PILOT_V2, getAgentLatencyPolicy } from './agent-latency-policy.mjs';
import { collectAgentFleetEvidence } from './agent-fleet-measurement.mjs';
import { buildDefaultAgentRegistry, buildStableAgentFleetMeasurement } from './agent-registry.mjs';

const end = Date.parse('2026-11-17T12:00:00.000Z'), revision = 'a'.repeat(40);
const secret = 'explicit-isolated-task-five-material';
let fixture;
beforeAll(async () => { fixture = await createAuditFixture({ end, revision, secret }); }, 120000);
afterAll(async () => { await fixture?.close(); });
const collect = (options = {}) => collectOperationalAudit({ pool: fixture.pool, secret, revision,
  now: fixture.now(), observationNow: fixture.now, sampler: fixture.sampler, runtime: auditFixtureHealth(), ...options });
const read = options => store.readOperationalAudit({ pool: fixture.pool, secret, revision, now: fixture.now(), ...options });
const run = options => store.executeOperationalAudit({ pool: fixture.pool, secret, revision, now: fixture.now,
  collect: ({ pool, now, observationNow }) => collect({ pool, now, observationNow }), ...options });
function resign(report, version = 'v2') {
  const { attestation: _ignored, ...unsigned } = report;
  const key = createHmac('sha256', secret).update(`pbk.operational-audit.signing-key.${version}`).digest();
  report.attestation = { version: `pbk-operational-audit-${version}`, signature: createHmac('sha256', key)
    .update(`pbk-operational-audit-${version}\n${canonicalJson(unsigned)}`).digest('hex') };
}

test('an initial current-boundary audit cannot manufacture a preceding day or fill a past gap', async () => {
  const short = await createAuditFixture({ end, revision, secret: secret + '-short', duration: 0 });
  try {
    short.advance(1);
    const first = await collectOperationalAudit({ pool: short.pool, secret: secret + '-short', revision,
      now: short.now(), observationNow: short.now, sampler: short.sampler, runtime: auditFixtureHealth() });
    assert.equal(first.coverage.verified, false);
    assert.equal(short.sampler.status().cutoff, new Date(short.now()).toISOString(), 'actual pending boundary closed');
    short.advance(90001);
    const gap = await collectOperationalAudit({ pool: short.pool, secret: secret + '-short', revision,
      now: short.now(), observationNow: short.now, sampler: short.sampler, runtime: auditFixtureHealth() });
    assert.equal(gap.coverage.verified, false);
  } finally { await short.close(); }
});

test('a genuine covered quiet day passes monitoring only; saved reference survives healthy head advancement', async () => {
  const result = await run({ createId: () => 'quiet-day' });
  assert.equal(result.verified, true, JSON.stringify(result));
  assert.equal(result.audit.ready, true, JSON.stringify(result.audit));
  assert.deepEqual(result.audit.coverage.reference, fixture.coverage.proof.reference);
  assert(result.audit.checks.every(c => c.status === 'passed'));
  assert.equal(result.audit.checks[0].counts.observations, 0);
  fixture.advance(60000);
  assert.equal((await fixture.sampler.sample()).verified, true);
  const later = await read();
  assert.equal(later.audit.ready, true, JSON.stringify(later));
  assert.deepEqual(later.audit.coverage.reference, result.audit.coverage.reference);
  assert.equal(JSON.stringify(later).includes(secret), false);
}, 30000);

test('a signed Boolean or malformed/missing reference cannot qualify, including signed re-tampering', async () => {
  const genuine = await collect();
  for (const coverage of [{ verified: true }, { ...genuine.coverage, reference: null },
    { ...genuine.coverage, reference: { ...genuine.coverage.reference, bootRef: '0'.repeat(64) } }]) {
    const result = await run({ collect: async () => ({ ...genuine, coverage }) });
    assert.equal(result.audit.ready, false);
  }
  const result = await run();
  const row = (await fixture.db.query('SELECT report FROM pbk_eval_runs WHERE id=$1', [result.runId])).rows[0];
  for (const field of ['revision', 'bootRef', 'policyHash', 'orderedRoot', 'sourceIntervalRoot']) {
    const report = structuredClone(row.report);
    report.audit.coverage.reference[field] = field === 'revision' ? 'b'.repeat(40) : '0'.repeat(64);
    resign(report);
    await fixture.db.query('UPDATE pbk_eval_runs SET report=$2 WHERE id=$1', [result.runId, report]);
    assert.equal((await read()).audit.ready, false, field);
  }
  await fixture.db.query('UPDATE pbk_eval_runs SET report=$2 WHERE id=$1', [result.runId, row.report]);
  assert.equal((await read({ now: fixture.now() + 90001 })).audit.ready, false, 'stale current control');
  assert.equal((await read({ revision: 'b'.repeat(40) })).verified, false);
}, 30000);

test('known failures cannot hide behind controlled/diagnostic labels; changed census remains a source blocker', async () => {
  const result = await run();
  fixture.advance(1);
  await fixture.db.query(`INSERT INTO activity_log(id,source,status,created_at)
    VALUES ('forged-label','runtime-event:controlled-qualification','error',$1)`, [new Date(fixture.now()).toISOString()]);
  const saved = await read();
  assert.equal(saved.audit.ready, false, 'late unknown source remains a readiness blocker');
  assert.equal(saved.audit.coverage.verified, true, 'a later observation must not rewrite the saved interval');
  assert.deepEqual(saved.audit.coverage.reference, result.audit.coverage.reference);
  assert.equal((await fixture.sampler.sample({ cutoff: fixture.now() })).verified, true);
  const current = await collect();
  assert.equal(current.checks.find(c => c.id === 'runtime_archive').status, 'failed');
  assert.equal(current.checks.find(c => c.id === 'runtime_archive').counts.errors, 1);
  assert.equal(current.coverage.verified, true, 'new current census is not whole-proof equality');
  await fixture.db.exec("DELETE FROM activity_log WHERE id='forged-label'");
  fixture.advance(1);
  assert.equal((await fixture.sampler.sample({ cutoff: fixture.now() })).verified, true);
  const tombstone = await collect();
  assert.equal(tombstone.checks.find(c => c.id === 'runtime_archive').status, 'failed', 'retained failure cannot disappear behind a tombstone');
}, 30000);

test.each(['v1', 'v2'])('newest %s pending/invalid admission wins even on explicit old-id reads', async version => {
  const old = await run();
  const id = `newer-${version}`;
  await fixture.db.query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,source,created_at,report)
    VALUES ($1,'pbk',$2,$3,$4,'{}')`, [id, `operational_audit_${version}`,
    `server:operational-audit:${version}`, new Date(fixture.now() + 1).toISOString()]);
  assert.equal((await read({ id: old.runId, now: fixture.now() + 1 })).verified, false);
  await fixture.db.query('DELETE FROM pbk_eval_runs WHERE id=$1', [id]);
});

test('a fresh audit without the private sampler cannot activate or borrow existing coverage', async () => {
  const report = await collect({ sampler: undefined });
  assert.equal(report.coverage.verified, false);
  assert.equal(report.checks.find(check => check.id === 'monitoring_continuity').status, 'unverified');
});

test('a genuinely signed legacy audit remains untouched and visible only as legacy diagnostics', async () => {
  const result = await run();
  const original = (await fixture.db.query('SELECT * FROM pbk_eval_runs WHERE id=$1', [result.runId])).rows[0];
  const report = structuredClone(original.report);
  report.schemaVersion = 'pbk-operational-audit-v1'; report.runId = 'signed-legacy';
  delete report.observationCutoff;
  report.audit.coverage = { verified: true };
  for (const check of report.audit.checks) { check.status = 'passed'; check.reason = 'no_findings'; }
  report.audit.ready = true;
  resign(report, 'v1');
  await fixture.db.query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,source,created_at,report,ok,total,passed,failed)
    VALUES ('signed-legacy','pbk','operational_audit_v1','server:operational-audit:v1',$1,$2,true,8,8,0)`,
  [new Date(fixture.now() + 1).toISOString(), report]);
  const legacy = await read({ now: fixture.now() + 1 });
  assert.equal(legacy.verified, false);
  assert.equal(legacy.audit.ready, false);
  assert.equal(legacy.legacy.authenticated, true);
  assert.equal(legacy.legacy.audit.ready, true, 'original v1 claims are diagnostic, not qualification');
  assert.equal(canonicalJson((await fixture.db.query("SELECT report FROM pbk_eval_runs WHERE id='signed-legacy'")).rows[0].report),
    canonicalJson(report), 'readback must not mutate the original signed v1 audit');
  assert.equal((await read({ id: result.runId, now: fixture.now() + 1 })).verified, false);
  await fixture.db.exec("DELETE FROM pbk_eval_runs WHERE id='signed-legacy'");
});

test('a new admission during asynchronous source verification blocks the authenticated old audit', async () => {
  const old = await run();
  let admitted = false;
  fixture.intercept(async text => {
    if (admitted || !text.includes('AS coverage_now')) return;
    admitted = true;
    await fixture.db.query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,source,created_at,report)
      VALUES ('concurrent-pending','pbk','operational_audit_v1','server:operational-audit:v1',$1,'{}')`,
    [new Date(fixture.now() + 1).toISOString()]);
  });
  try { assert.equal((await read({ id: old.runId })).verified, false); assert(admitted); }
  finally { fixture.intercept(null); await fixture.db.exec("DELETE FROM pbk_eval_runs WHERE id='concurrent-pending'"); }
});

test('the acquisition and callback deadline fences late SQL/commit, not just a late return', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let deliver, commits = 0, destroyed = 0;
  try {
    const pool = { query() {}, connect: () => new Promise(resolve => { deliver = resolve; }) };
    const pending = store.executeOperationalAudit({ pool, secret, revision, now: () => end, collect: async () => ({}) });
    await jest.advanceTimersByTimeAsync(60001);
    assert.equal((await pending).verified, false);
    deliver({ query() { commits++; return { rows: [] }; }, release(value) { destroyed += Number(value === true); } });
    await jest.advanceTimersByTimeAsync(0);
    assert.equal(destroyed, 1);
    assert.equal(commits, 0);
  } finally { jest.useRealTimers(); }
});

test.each(['callback', 'coverage', 'sampler', 'source'])('parent expiry prevents late %s continuations from committing', async kind => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  const deadlineSecret = `${secret}-${kind}-deadline`;
  let continueWork, deliverQuery, writes = 0, destroyed = 0;
  try {
    const raw = { query(config) {
      const text = config.text;
      if (text === 'COMMIT') writes++;
      if (text.includes('pg_try_advisory_xact_lock')) return Promise.resolve({ rows: [{ acquired: true }] });
      if (text.includes('INSERT INTO public.pbk_eval_runs')) return Promise.resolve({ rows: [], rowCount: 1 });
      if (text.includes('FROM public.pbk_eval_runs') || kind === 'sampler' && text.includes('AS coverage_now')) {
        return new Promise(resolve => { deliverQuery = resolve; });
      }
      return Promise.resolve({ rows: [] });
    }, release(value) { destroyed += Number(value === true); } };
    const pool = { query: raw.query, connect: async () => raw };
    const sampler = createRuntimeCoverageSampler({ pool: store.createOperationalAuditPool(pool), secret: deadlineSecret, revision,
      enabled: true, hosted: true, health: auditFixtureHealth, now: () => end });
    let lateRejected = false;
    const pending = store.executeOperationalAudit({ pool, secret: deadlineSecret, revision, now: () => end,
      collect: async ({ pool: boundedPool }) => {
        if (kind !== 'callback') {
          await new Promise(resolve => setTimeout(resolve, 59000));
          if (kind === 'coverage') await readRuntimeCoverage({ pool: boundedPool, secret: deadlineSecret, revision, now: end });
          if (kind === 'sampler') await sampler.sample();
          if (kind === 'source') {
            const client = await boundedPool.connect();
            try { await collectRuntimeSourceSnapshot({ client, secret: deadlineSecret, revision, now: () => end,
              windowStart: end - 86400000, windowEnd: end }); }
            finally { client.release(false); }
          }
        } else {
          const client = await boundedPool.connect();
          await new Promise(resolve => { continueWork = resolve; });
          try { await client.query('COMMIT'); } catch { lateRejected = true; }
        }
        return {};
      } });
    await jest.advanceTimersByTimeAsync(60001);
    assert.equal((await pending).verified, false);
    if (kind !== 'callback') assert.equal(typeof deliverQuery, 'function', 'actual nested SQL must have started');
    const atExpiry = writes;
    continueWork?.(); deliverQuery?.({ rows: [] });
    await jest.advanceTimersByTimeAsync(15001);
    assert.equal(writes, atExpiry, 'no finalization or nested commit after expiry');
    assert.equal(writes, 1, 'only the initial pending admission committed');
    assert(destroyed > 0);
    if (kind === 'callback') assert(lateRejected);
  } finally { jest.useRealTimers(); }
});

test('both bridge fleet reads require policy before collection and internal v2 verification options', () => {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  for (const name of ['buildProductionReadinessSnapshot', 'buildAgentOrchestrationSnapshot']) {
    const start = source.indexOf(`function ${name}(`);
    const body = source.slice(start, source.indexOf('\n}\n', source.indexOf(') {', start)));
    assert.match(body, /getAgentLatencyPolicy\(process.env, \{ requireVersion2: true \}\)/);
    assert(body.indexOf('getAgentLatencyPolicy(') < body.indexOf('collectAgentFleetEvidence('));
    assert.match(body, /secret: BRIDGE_API_KEY/);
    assert.match(body, /timingEvidenceSecret: BRIDGE_API_KEY/);
    assert.match(body, /requireTimingV2: true/);
  }
});

test.each([{}, { PBK_AGENT_LATENCY_POLICY_V2: '' },
  { PBK_AGENT_LATENCY_POLICY_V2: JSON.stringify(AGENT_LATENCY_PILOT_V2) }])(
  'actual isolated bridge read functions fail closed with missing/invalid policy or no business sample: %p', async env => {
    const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const registry = buildDefaultAgentRegistry({ now: end, env: {} });
    let collectionOptions, measurementOptions;
    const context = vm.createContext({ Date: { now: () => end }, process: { env },
      BUILD_REVISION: revision, BRIDGE_API_KEY: secret, state: { agents: [], status: {} },
      getAgentLatencyPolicy, ensureAgentFleetCollections() {}, getCurrentAgentRegistry: () => registry,
      buildAgentRegistrySnapshot: () => ({ required: { ids: [] } }), buildAgentHealthProbe: a => a,
      getPendingRuntimeApprovals: () => [], agentRegistryLoadedAt: null, toolHandlers: {}, isoNow: () => new Date(end).toISOString(),
      buildProductionToolCatalog: () => [], buildProductionAgentLatencySamples: () => ({}),
      buildProductionLastAgentActions: () => ({}),
      collectAgentFleetEvidence: (state, options) => {
        collectionOptions = options;
        return collectAgentFleetEvidence(state, options);
      },
      buildStableAgentFleetMeasurement: (agents, options) => {
        measurementOptions = options;
        return buildStableAgentFleetMeasurement(agents, options);
      },
      getRuntimeMeta: () => ({}), buildCommandCenterHealthSnapshot: async () => ({}),
      buildAgentCapabilityReadiness: () => ({ ready: true, degraded: [] }),
      buildBridgeConnectionStatus: () => ({ ready: true, blockers: [] }),
      buildProductionTruthGateFromRuntime: () => ({ ready: true, blockers: [] }),
      productionReadinessMonitor: { getSloStatus: () => ({ burned: [] }) },
      buildProductionMaturitySnapshot: async () => ({ summary: { ready: true, blockers: [] } }),
      productionIdempotencyStore: { status: () => ({}) },
    });
    for (const name of ['buildProductionReadinessSnapshot', 'buildAgentOrchestrationSnapshot']) {
      const start = source.indexOf(`function ${name}(`);
      const finish = source.indexOf('\n}\n', source.indexOf(') {', start)) + 2;
      vm.runInContext((name === 'buildProductionReadinessSnapshot' ? 'async ' : '') + source.slice(start, finish), context);
      const result = await context[name]();
      assert.equal(collectionOptions.now, end);
      assert.equal(collectionOptions.secret, secret);
      assert.equal(collectionOptions.revision, revision);
      assert.equal(collectionOptions.policy.version, 2);
      assert.equal(collectionOptions.requireTimingV2, true);
      assert.equal(measurementOptions.now, end);
      assert.equal(measurementOptions.latencyPolicy, collectionOptions.policy);
      assert.equal(measurementOptions.timingEvidenceSecret, secret);
      assert.equal(measurementOptions.requireTimingV2, true);
      const measurement = result.measurement || result.stableAgentFleetMeasurement;
      assert.equal(measurement.ready, false);
      assert.equal(result.latencyPolicy.ready, Boolean(env.PBK_AGENT_LATENCY_POLICY_V2));
    }
  });

test('a genuine new boot resets the current durable control and invalidates saved audit coverage', async () => {
  const before = await run();
  assert.equal(before.audit.coverage.verified, true);
  const rebooted = createRuntimeCoverageSampler({ pool: fixture.pool, secret, revision, enabled: true, hosted: true,
    health: auditFixtureHealth, now: fixture.now, bootId: 'genuine-new-audit-fixture-boot' });
  try {
    const busy = await rebooted.sample();
    assert.equal(busy.verified, false);
    assert.equal(busy.result, 'coverage_lease_busy', 'a new boot cannot steal the active durable lease');
    fixture.advance(120001);
    assert.equal((await rebooted.sample()).verified, true);
    const after = await read({ id: before.runId });
    assert.equal(after.audit.coverage.verified, false);
    assert.equal(after.audit.ready, false);
  } finally { rebooted.stop(); }
});
