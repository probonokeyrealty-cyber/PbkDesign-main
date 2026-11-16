import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { randomUUID } from 'node:crypto';

let qualification = {};
try { qualification = await import('./release-qualification.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }

const revision = 'a'.repeat(40);
const now = Date.parse('2026-11-15T12:00:00Z');
const secret = 'qualification-test-signing-material';
const requiredCases = { failedCall: ['stop', 'offer'], behavior: ['identity'], silentPolicy: ['unknown-delivery'] };
const suite = (ids) => ({ ok: true, total: ids.length, passed: ids.length, failed: 0,
  results: ids.map(id => ({ id, executed: true, passed: true })) });
const checks = () => ({ failedCall: suite(requiredCases.failedCall), behavior: suite(requiredCases.behavior),
  silentPolicy: suite(requiredCases.silentPolicy) });
const ci = () => ({ source: 'github_actions', provenance: 'controlled', revision, runId: '12345',
  executedAt: new Date(now - 1000).toISOString(), executed: true, passed: true,
  expiresAt: new Date(now - 2000 + 86_400_000).toISOString(),
  checks: ['postgres_integration', 'browser_regression'].map(id => ({ id, executed: true, passed: true })) });

function api(name) {
  assert.equal(typeof qualification[name], 'function', `${name} must implement trusted qualification proof`);
  return qualification[name];
}

function database(transactionStarts = []) {
  const rows = [];
  const statements = [];
  let transactionStartedAt;
  const client = {
    release() {},
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql === 'BEGIN') transactionStartedAt = transactionStarts.shift() ?? now + statements.length;
      if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ acquired: true }] };
      if (/INSERT INTO public.pbk_eval_runs/.test(sql)) {
        rows.unshift({ id: values[0], tenant_id: values[1], suite_name: values[2],
          ok: values[3], total: values[4], passed: values[5], failed: values[6],
          report: JSON.parse(values[7]), source: values[8],
          created_at: values[9] || new Date(/GREATEST\(clock_timestamp\(\)/.test(sql)
            ? now + statements.length : transactionStartedAt).toISOString() });
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      if (/FROM public.pbk_eval_runs/.test(sql)) {
        const ordered = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
        return { rows: values.length > 3 ? ordered.filter(row => row.id === values[3]).slice(0, 1) : ordered.slice(0, 1) };
      }
      return { rows: [] };
    },
  };
  return { rows, statements, connect: async () => client, query: client.query };
}

async function execute(pool = database(), overrides = {}) {
  const result = await api('executeReleaseQualification')({ pool, revision, secret, requiredCases,
    runChecks: async () => checks(), loadCi: async () => ci(), now: () => now,
    createId: () => 'qualification-test-1', ...overrides });
  return { pool, result };
}

const read = (pool, overrides = {}) => api('readReleaseQualification')({ pool, revision, secret, requiredCases,
  now, ...overrides });

test('fixed execution commits and reads back signed controlled proof without operational promotion', async () => {
  const { pool, result } = await execute();
  assert.equal(result.ok, true);
  assert.equal(result.readbackVerified, true);
  const stored = await read(pool);
  assert.equal(stored.verified, true);
  assert.equal(stored.qualification.ready, true);
  assert.equal(stored.evidence.failedCallEval.scenarios.length, 2);
  assert.equal(stored.evidence.failedCallEval.provenance, 'controlled');
  assert.equal(stored.evidence.behavior.passed, true);
  assert.equal(stored.evidence.canary, undefined);
  assert.equal(stored.evidence.silentErrors, undefined, 'Policy fixtures are not an operational silent-error audit');
  assert.equal(JSON.stringify(stored).includes(secret), false);
  assert(pool.statements.some(row => row.sql === 'COMMIT'));
});

test('newest failed run is evidence, never replaced by an older successful run', async () => {
  const { pool } = await execute();
  await execute(pool, { createId: () => 'qualification-test-2', now: () => now + 10,
    runChecks: async () => { const report = checks(); report.failedCall.results[0].passed = false;
      report.failedCall.ok = false; report.failedCall.passed = 1; report.failedCall.failed = 1; return report; } });
  const stored = await read(pool, { now: now + 20 });
  assert.equal(stored.verified, true);
  assert.equal(stored.runId, 'qualification-test-2');
  assert.equal(stored.qualification.ready, false);
  assert.equal(stored.evidence.failedCallEval.passed, false);
});

test('same-millisecond execution times cannot make an older pass hide a newer failed run', async () => {
  const { pool } = await execute(database(), { createId: () => 'qualification-z-older' });
  await execute(pool, { createId: () => 'qualification-a-newer', runChecks: async () => {
    const report = checks(); report.failedCall.results[0].passed = false;
    report.failedCall.ok = false; report.failedCall.passed = 1; report.failedCall.failed = 1; return report;
  } });
  const stored = await read(pool);
  assert.equal(stored.runId, 'qualification-a-newer');
  assert.equal(stored.qualification.ready, false);
});

test('a delayed transaction cannot sort a later failure behind an earlier pass', async () => {
  const { pool } = await execute(database([now + 1, now - 1000]), { createId: () => 'qualification-z-pass' });
  await execute(pool, { createId: () => 'qualification-a-failure', runChecks: async () => {
    const report = checks(); report.failedCall.results[0].passed = false;
    report.failedCall.ok = false; report.failedCall.passed = 1; report.failedCall.failed = 1; return report;
  } });
  const stored = await read(pool);
  assert.equal(stored.runId, 'qualification-a-failure');
  assert.equal(stored.qualification.ready, false);
  const insert = pool.statements.find(row => /INSERT INTO public.pbk_eval_runs/.test(row.sql)).sql;
  assert.match(insert, /MAX\(created_at\)\s*\+\s*INTERVAL '1 microsecond'/);
});

for (const [label, mutate] of [
  ['case changed', row => { row.report.suites.failedCall.results[0].passed = false; }],
  ['different tenant', row => { row.tenant_id = 'other'; }],
  ['different source', row => { row.source = 'invoke'; }],
  ['different suite', row => { row.suite_name = 'ava_canonical'; }],
  ['different record identity', row => { row.id = 'other'; }],
  ['legacy unsigned', row => { delete row.report.attestation; }],
]) {
  test(`readback rejects ${label}`, async () => {
    const { pool } = await execute(); mutate(pool.rows[0]);
    const result = await read(pool);
    assert.equal(result.verified, false);
    assert.deepEqual(result.evidence, {});
  });
}

for (const [label, overrides] of [
  ['wrong revision', { revision: 'b'.repeat(40) }],
  ['wrong signing key', { secret: 'different-test-signing-material' }],
  ['expired', { now: now + 86_400_001 }],
  ['future', { now: now - 1 }],
]) {
  test(`readback rejects ${label}`, async () => {
    const { pool } = await execute(); assert.equal((await read(pool, overrides)).verified, false);
  });
}

test('database unavailability and missing proof remain unverified', async () => {
  assert.equal((await read(database())).verified, false);
  assert.equal((await read(null)).verified, false);
  const failed = { query: async () => { throw new Error(secret); } };
  const result = await read(failed);
  assert.equal(result.verified, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test.each(['empty', 'duplicate', 'partial', 'unexecuted', 'counts'])('%s cases cannot become a passing qualification', async (kind) => {
  const { result } = await execute(database(), { runChecks: async () => {
    const report = checks(); const s = report.failedCall;
    if (kind === 'empty') s.results = [];
    if (kind === 'duplicate') s.results[1].id = s.results[0].id;
    if (kind === 'partial') s.results.pop();
    if (kind === 'unexecuted') s.results[0].executed = false;
    if (kind === 'counts') s.passed = 999;
    return report;
  } });
  assert.equal(result.ok, true, 'Failed qualification attempts must still be durably recorded');
  assert.equal(result.qualification.ready, false);
  assert.equal(result.evidence.failedCallEval.passed, false);
});

test('unavailable CI is recorded, not invented as a pass', async () => {
  const { result } = await execute(database(), { loadCi: async () => { throw new Error(secret); } });
  assert.equal(result.readbackVerified, true);
  assert.equal(result.qualification.ready, false);
  assert.equal(result.evidence.failedCallEval.passed, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('failed CI identity and safe failure reason remain visible without becoming execution proof', async () => {
  const { result } = await execute(database(), { loadCi: async () => ({
    source: 'github_actions', provenance: 'controlled', revision, runId: '12345',
    executed: false, passed: false, executedAt: null, status: 'failed', errorCode: 'run_not_successful', checks: [],
  }) });
  assert.equal(result.qualification.ci.observedRunId, '12345');
  assert.equal(result.qualification.ci.status, 'failed');
  assert.equal(result.qualification.ci.errorCode, 'run_not_successful');
  assert.equal(result.qualification.ci.executed, false);
  assert.equal(result.qualification.ready, false);
});

test('a failed storage operation never reports durable proof', async () => {
  const pool = database(); pool.connect = async () => { throw new Error(secret); };
  const { result } = await execute(pool);
  assert.equal(result.ok, false);
  assert.equal(result.readbackVerified, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('a concurrent publisher is rejected before local execution or writes', async () => {
  const pool = database();
  const base = await pool.connect();
  const query = base.query;
  base.query = async (sql, values) => /pg_try_advisory_xact_lock/.test(sql)
    ? { rows: [{ acquired: false }] } : query(sql, values);
  let executed = false;
  const { result } = await execute(pool, { runChecks: async () => { executed = true; return checks(); } });
  assert.equal(result.ok, false);
  assert.equal(executed, false);
  assert.equal(pool.rows.length, 0);
});

test('controlled re-execution cannot refresh an expired CI execution', async () => {
  const { result } = await execute(database(), { loadCi: async () => ({ ...ci(),
    executedAt: new Date(now - 86_400_001).toISOString() }) });
  assert.equal(result.qualification.ready, false);
  assert.equal(result.qualification.ci.passed, false);
});

test('readback enforces the original earliest CI expiry rather than aggregate completion time', async () => {
  const { pool } = await execute(database(), { loadCi: async () => ({ ...ci(),
    expiresAt: new Date(now + 100).toISOString() }) });
  const stored = await read(pool, { now: now + 101 });
  assert.equal(stored.verified, true);
  assert.equal(stored.qualification.ready, false);
  assert.equal(stored.qualification.ci.passed, false);
});

test('qualification authority is direct founder only and accepts no submitted report', () => {
  const allowed = api('authorizeQualificationRequest');
  const request = { method: 'POST', search: '', body: {}, headers: { authorization: `Bearer ${secret}` } };
  assert.equal(allowed(request, secret).ok, true);
  for (const change of [
    { body: { passed: true } }, { body: [] }, { search: '?revision=other' }, { method: 'GET' },
    { headers: {} }, { headers: { authorization: `Bearer ${secret}`, 'x-pbk-team-token': 'team-session' } },
    { headers: { authorization: `Bearer ${secret}`, 'x-pbk-netlify-proxy': 'pbk-bridge-proxy' } },
  ]) assert.equal(allowed({ ...request, ...change }, secret).ok, false);
});

const postgresTest = process.env.PBK_TEST_DATABASE_URL ? test : test.skip;
postgresTest('disposable Postgres commits signed proof and rejects JSONB tampering after independent readback', async () => {
  assert.equal(process.env.PBK_TEST_DATABASE_URL, process.env.PBK_EVAL_DATABASE_URL,
    'Run this qualification test through the disposable evaluation harness');
  assert(new URL(process.env.PBK_TEST_DATABASE_URL).hostname.endsWith('.neon.tech'),
    'Qualification integration is restricted to the disposable Neon lane');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PBK_TEST_DATABASE_URL,
    max: 2, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  const id = `qualification-test-${randomUUID()}`;
  const orderPassId = `qualification-pass-${randomUUID()}`;
  const orderFailureId = `qualification-failure-${randomUUID()}`;
  let delayedClient;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.pbk_eval_runs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'pbk', suite_name TEXT NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT FALSE, total INT NOT NULL DEFAULT 0,
      passed INT NOT NULL DEFAULT 0, failed INT NOT NULL DEFAULT 0,
      report JSONB NOT NULL DEFAULT '{}'::jsonb, source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const result = await api('executeReleaseQualification')({ pool, revision, secret, requiredCases,
      runChecks: async () => checks(), loadCi: async () => ({ ...ci(),
        executedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() - 2000 + 86_400_000).toISOString() }), createId: () => id });
    assert.equal(result.readbackVerified, true, 'Committed JSONB key ordering must preserve signature verification');
    const before = await read(pool, { id, now: Date.now() });
    assert.equal(before.qualification.ready, true);
    await pool.query(`UPDATE public.pbk_eval_runs SET report = jsonb_set(report,
      '{suites,failedCall,results,0,passed}', 'false'::jsonb) WHERE id = $1`, [id]);
    assert.equal((await read(pool, { id, now: Date.now() })).verified, false);

    // Begin the eventual failure first, but let a newer transaction publish its pass first.
    delayedClient = await pool.connect();
    await delayedClient.query('BEGIN');
    await delayedClient.query('SELECT pg_sleep(0.02)');
    const realCi = async () => ({ ...ci(), executedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() - 2000 + 86_400_000).toISOString() });
    const run = overrides => api('executeReleaseQualification')({ pool, revision, secret, requiredCases,
      runChecks: async () => checks(), loadCi: realCi, ...overrides });
    assert.equal((await run({ createId: () => orderPassId })).qualification.ready, true);
    const held = delayedClient;
    delayedClient = null;
    const failure = await run({ pool: { connect: async () => held, query: (...args) => pool.query(...args) },
      createId: () => orderFailureId, runChecks: async () => {
        const report = checks(); report.failedCall.results[0].passed = false;
        report.failedCall.ok = false; report.failedCall.passed = 1; report.failedCall.failed = 1; return report;
      } });
    assert.equal(failure.readbackVerified, true);
    const latest = await read(pool, { now: Date.now() });
    assert.equal(latest.runId, orderFailureId, 'Later failure must win despite its earlier transaction start');
    assert.equal(latest.qualification.ready, false);
  } finally {
    if (delayedClient) {
      await delayedClient.query('ROLLBACK');
      delayedClient.release();
    }
    await pool.query('DELETE FROM public.pbk_eval_runs WHERE id = ANY($1::text[])', [[id, orderPassId, orderFailureId]]);
    await pool.end();
  }
}, 30_000);
