import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createHmac, randomUUID } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';

let store = {};
try { store = await import('./operational-audit-store.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }

const revision = 'a'.repeat(40);
const secret = 'operational-audit-test-signing-material';
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const DAY = 24 * 3600_000;
const SOURCE = 'server:operational-audit:v1';
const SUITE = 'operational_audit_v1';
const SCHEMA = 'pbk-operational-audit-v1';
const IDS = ['runtime_archive', 'provider_dispatch', 'dead_letters', 'conversation_projection',
  'safety_qa', 'database_security', 'runtime_health', 'monitoring_continuity'];
const iso = ms => new Date(ms).toISOString();

function api(name) {
  assert.equal(typeof store[name], 'function', `${name} must implement durable operational audit receipts`);
  return store[name];
}

function collection(end = NOW, ready = false) {
  return { windowStart: iso(end - DAY), windowEnd: iso(end),
    checks: IDS.map(id => ({ id, status: ready || id !== 'monitoring_continuity' ? 'passed' : 'unverified',
      reason: ready || id !== 'monitoring_continuity' ? 'no_findings' : 'coverage_unverified',
      counts: { total: 0 }, firstObservedAt: null, lastObservedAt: null })), coverage: { verified: ready } };
}

function jsonb(value) {
  if (Array.isArray(value)) return value.map(jsonb);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().reverse()
    .map(key => [key, jsonb(value[key])]));
  return value;
}

function database(transactionStarts = []) {
  const rows = [];
  const statements = [];
  let acquired = false;
  let transactionStart;
  let clockUs = BigInt(NOW) * 1000n;
  const pool = { rows, statements, busy: false, failRead: false, failWrite: false, failUpdate: false, clockMs: NOW };
  const query = async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql === 'BEGIN') transactionStart = transactionStarts.shift() ?? NOW;
    if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ acquired: !pool.busy }] };
    if (/INSERT INTO public.pbk_eval_runs/.test(sql)) {
      if (pool.failWrite) throw new Error('private-write-error');
      const wall = BigInt(pool.clockMs) * 1000n;
      const max = rows.reduce((v, row) => row.createdUs > v ? row.createdUs : v, 0n);
      clockUs = /GREATEST\(clock_timestamp\(\)/.test(sql) && /MAX\(created_at\)/.test(sql)
        ? (wall > max ? wall : max + 1n) : BigInt(transactionStart) * 1000n;
      rows.push({ id: values[0], tenant_id: values[1], suite_name: values[2], ok: values[3],
        total: values[4], passed: values[5], failed: values[6], report: jsonb(JSON.parse(values[7])),
        source: values[8], created_at: iso(Number(clockUs / 1000n)) });
      Object.defineProperty(rows.at(-1), 'createdUs', { value: clockUs });
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE public.pbk_eval_runs/.test(sql)) {
      if (pool.failUpdate) throw new Error('private-final-update-error');
      const row = rows.find(row => row.id === values[0] && row.tenant_id === values[1]
        && row.suite_name === values[2] && row.source === values[8]
        && canonicalJson(row.report) === canonicalJson(JSON.parse(values[9])));
      if (!row || pool.zeroUpdate) return { rows: [], rowCount: 0 };
      Object.assign(row, { ok: values[3], total: values[4], passed: values[5], failed: values[6],
        report: jsonb(JSON.parse(values[7])) });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM public.pbk_eval_runs/.test(sql)) {
      if (pool.failRead) throw new Error('private-read-error');
      const ordered = [...rows].sort((a, b) => a.createdUs === b.createdUs
        ? b.id.localeCompare(a.id) : a.createdUs > b.createdUs ? -1 : 1);
      // Return corrupt matching rows too: verification must not rely on SQL filtering for integrity.
      return { rows: JSON.parse(JSON.stringify(ordered.filter(row => values.length < 4 || row.id === values[3]).slice(0, 1))) };
    }
    return { rows: [] };
  };
  pool.query = async (...args) => { assert.equal(acquired, false, 'readback/collector must not hold the writer connection'); return query(...args); };
  pool.connect = async () => {
    assert.equal(acquired, false, 'single-connection pool cannot be acquired twice');
    acquired = true;
    return { query, release() { acquired = false; } };
  };
  return pool;
}

async function execute(pool = database(), overrides = {}) {
  const result = await api('executeOperationalAudit')({ pool, revision, secret,
    collect: async () => collection(), now: () => NOW, createId: () => 'operational-test-1', ...overrides });
  return { pool, result };
}
const read = (pool, overrides = {}) => api('readOperationalAudit')({ pool, revision, secret, now: NOW, ...overrides });

function resign(row, domain = 'pbk.operational-audit.signing-key.v1') {
  const { attestation: _ignored, ...unsigned } = row.report;
  const key = createHmac('sha256', secret).update(domain).digest();
  row.report.attestation = { version: SCHEMA,
    signature: createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex') };
}

test('exports an immutable fixed check set independently of the collector', () => {
  assert.deepEqual(store.OPERATIONAL_AUDIT_CHECK_IDS, IDS);
  assert.equal(Object.isFrozen(store.OPERATIONAL_AUDIT_CHECK_IDS), true);
});

test('JSONB readback verifies an incomplete audit without promoting it', async () => {
  const { pool, result } = await execute();
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.readbackVerified, true);
  assert.equal(result.source, 'postgres:pbk_eval_runs');
  assert.equal(result.audit.ready, false);
  assert.equal(result.audit.coverage.verified, false);
  assert.deepEqual(result.audit.checks.map(check => check.id), IDS);
  assert.deepEqual(result.evidence.silentErrors, { runId: result.runId, revision,
    executedAt: iso(NOW), executed: true, provenance: 'operational', scope: 'durable_operational_audit', passed: false });
  assert.equal(pool.rows[0].suite_name, SUITE);
  assert.equal(pool.rows[0].source, SOURCE);
  assert.equal(pool.rows[0].report.windowEnd, undefined, 'window belongs to the signed audit');
  assert.equal(pool.statements.filter(q => /FROM public.pbk_eval_runs/.test(q.sql) && !/INSERT/.test(q.sql)).length, 2);
  assert(pool.statements.some(q => /id = \$4/.test(q.sql)));
  assert(pool.statements.find(q => q.sql === 'COMMIT'));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual((await read(pool)).audit, result.audit);
});

test.each(['failed', 'unverified', 'coverage', 'continuity'])('readiness is derived, not caller supplied: %s', async kind => {
  const report = collection(NOW, true);
  report.ready = true;
  if (kind === 'coverage') report.coverage.verified = false;
  else report.checks[kind === 'continuity' ? 7 : 0].status = kind === 'failed' ? 'failed' : 'unverified';
  const { result } = await execute(database(), { collect: async () => report });
  assert.equal(result.verified, true);
  assert.equal(result.audit.ready, false);
  assert.equal(result.evidence.silentErrors.passed, false);
});

test('only all fixed checks plus verified coverage can derive ready', async () => {
  const { result } = await execute(database(), { collect: async () => collection(NOW, true) });
  assert.equal(result.audit.ready, true);
  assert.equal(result.evidence.silentErrors.passed, true);
});

test('collection holds no writer connection after durable admission, using the original execution window', async () => {
  const pool = database();
  let clock = NOW;
  const { result } = await execute(pool, { now: () => clock, collect: async () => {
    assert.equal(pool.statements.at(-1).sql, 'COMMIT');
    assert.equal(pool.rows[0].report.completedAt, null);
    assert.equal(pool.rows[0].ok, false);
    const signature = pool.rows[0].report.attestation.signature;
    resign(pool.rows[0]);
    assert.equal(pool.rows[0].report.attestation.signature, signature, 'pending admission is signed');
    assert.equal((await read(pool)).verified, false);
    await pool.query('SELECT 1');
    clock += 30_000;
    pool.clockMs = clock;
    return collection(NOW);
  } });
  assert.equal(result.verified, true);
  assert.equal(result.executedAt, iso(clock));
  assert.equal(result.audit.windowEnd, iso(NOW));
  assert.equal((await read(pool, { now: NOW + DAY - 1 })).verified, true);
  assert.equal((await read(pool, { now: NOW + DAY })).verified, false, 'TTL starts at observation end, not completion/read');
});

test('collector exceptions persist a newer sanitized unverified attempt instead of exposing an older pass', async () => {
  const { pool } = await execute(database(), { collect: async () => collection(NOW, true), createId: () => 'z-old-pass' });
  const { result } = await execute(pool, { collect: async () => { throw new Error('seller-private-error'); },
    createId: () => 'a-new-failure' });
  assert.equal(pool.rows.length, 2);
  assert.equal(result.verified, true);
  assert.equal(result.audit.ready, false);
  assert(result.audit.checks.every(check => check.status === 'unverified' && check.reason === 'collector_failed'));
  assert.equal(result.audit.windowEnd, iso(NOW));
  assert.equal((await read(pool)).runId, 'a-new-failure');
  assert.equal(JSON.stringify(pool.rows).includes('seller-private-error'), false);
});

test('query-failed collection remains verified but failed, with no raw errors persisted', async () => {
  const data = collection(NOW, true);
  Object.assign(data.checks[0], { status: 'unverified', reason: 'query_failed', error: 'seller-private-error' });
  const { pool, result } = await execute(database(), { collect: async () => data });
  assert.equal(result.verified, true);
  assert.equal(result.audit.ready, false);
  assert.equal(result.audit.checks[0].reason, 'query_failed');
  assert.equal(JSON.stringify(pool.rows).includes('seller-private-error'), false);
});

test('only whitelisted aggregate fields and bounded safe counts survive', async () => {
  const data = collection();
  data.transcript = 'private-seller'; data.coverage.notes = 'private-seller';
  Object.assign(data.checks[0], { payload: 'private-seller', reason: 'private-seller',
    counts: { total: 3, errors: 2, 'private-seller': 10, phone: 15555555555, notes: 'private-seller' } });
  const { pool, result } = await execute(database(), { collect: async () => data });
  assert.equal(result.verified, true);
  assert.equal(result.audit.checks[0].status, 'unverified');
  assert.deepEqual(result.audit.checks[0].counts, { total: 3, errors: 2 });
  assert.equal(JSON.stringify(pool.rows).includes('private-seller'), false);
  assert.equal(JSON.stringify(pool.rows).includes('15555555555'), false);
});

test('real collector contract retains every known aggregate through signed readback and drops raw fields', async () => {
  const { collectOperationalAudit } = await import('./operational-audit-collector.mjs');
  const keysByCheck = {
    runtime_archive: ['observations', 'errors', 'warnings', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    provider_dispatch: ['observations', 'completed', 'dispatching', 'reconciliationRequired', 'unknownStatuses',
      'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    dead_letters: ['observations', 'outstanding', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    conversation_projection: ['observations', 'events', 'dispatches', 'linkedDispatches', 'missingProjections',
      'unverifiableDispatches', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    safety_qa: ['observations', 'qaObservations', 'safetyObservations', 'qaFailures', 'qaSkipped',
      'blocked', 'excludedFixtures', 'futureTimestamps', 'missingTimestamps'],
    database_security: ['requiredTables', 'presentTables', 'missingTables', 'rlsDisabled', 'publicRoleGrants'],
  };
  const expected = Object.fromEntries(Object.entries(keysByCheck).map(([id, keys]) =>
    [id, Object.fromEntries(keys.map((key, index) => [key, index + 1]))]));
  expected.runtime_health = { checked: 7, unhealthy: 0 };
  expected.monitoring_continuity = {};
  const collectorPool = { connect: async () => ({ release() {}, async query({ text }) {
    const id = /operational_audit:([a-z_]+)/.exec(text)?.[1];
    return { rows: id ? [{ ...expected[id], firstObservedAt: id === 'database_security' ? null : iso(NOW - 1000),
      lastObservedAt: id === 'database_security' ? null : iso(NOW), payload: 'private-seller' }] : [] };
  } }) };
  const runtime = { authenticationConfigured: true, approvalMode: 'approval', bootstrapReady: true,
    archiveReady: true, providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true };
  const { pool, result } = await execute(database(), { collect: async ({ now }) => {
    const report = await collectOperationalAudit({ pool: collectorPool, now, runtime });
    report.raw = 'private-seller';
    for (const check of report.checks) {
      check.payload = 'private-seller'; check.counts.phone = 15555555555; check.counts.notes = 'private-seller';
    }
    return report;
  } });
  assert.equal(result.verified, true);
  assert.equal(result.audit.ready, false);
  for (const check of result.audit.checks) assert.deepEqual(check.counts, expected[check.id], check.id);
  assert.equal(JSON.stringify(pool.rows).includes('private-seller'), false);
  assert.equal(JSON.stringify(pool.rows).includes('15555555555'), false);
});

test.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null])('unsafe count %s cannot certify a check', async value => {
  const data = collection(NOW, true); data.checks[0].counts = { total: value };
  const { result } = await execute(database(), { collect: async () => data });
  assert.equal(result.verified, true);
  assert.equal(result.audit.ready, false);
  assert.equal(result.audit.checks[0].status, 'unverified');
  assert.deepEqual(result.audit.checks[0].counts, {});
});

test('maximum safe integer counts and valid observed bounds round trip', async () => {
  const data = collection(); data.checks[0].counts.total = Number.MAX_SAFE_INTEGER;
  data.checks[0].firstObservedAt = iso(NOW - DAY); data.checks[0].lastObservedAt = iso(NOW);
  const { result } = await execute(database(), { collect: async () => data });
  assert.deepEqual(result.audit.checks[0], data.checks[0]);
});

test.each(['missing', 'duplicate', 'extra', 'bad-status', 'bad-time', 'reversed-time', 'bad-window', 'shifted-window'])('%s collector shape cannot pass', async kind => {
  const data = collection(NOW, true);
  if (kind === 'missing') data.checks.pop();
  if (kind === 'duplicate') data.checks[7].id = IDS[0];
  if (kind === 'extra') data.checks.push({ ...data.checks[0], id: 'other' });
  if (kind === 'bad-status') data.checks[0].status = 'healthy';
  if (kind === 'bad-time') data.checks[0].firstObservedAt = 'private-seller';
  if (kind === 'reversed-time') Object.assign(data.checks[0], { firstObservedAt: iso(NOW), lastObservedAt: iso(NOW - 1) });
  if (kind === 'bad-window') data.windowStart = iso(NOW - DAY + 1);
  if (kind === 'shifted-window') { data.windowStart = iso(NOW - DAY - 1); data.windowEnd = iso(NOW - 1); }
  const { result } = await execute(database(), { collect: async () => data });
  assert.equal(result.verified, true, 'incomplete collection is still durably recorded');
  assert.equal(result.audit.ready, false);
  assert.deepEqual(result.audit.checks.map(check => check.id), IDS);
});

for (const [label, mutate] of [
  ['tampered count', row => { row.report.audit.checks[0].counts.total = 99; }],
  ['unsigned', row => { delete row.report.attestation; }],
  ['malformed signature', row => { row.report.attestation.signature = 'f'; }],
  ['tenant metadata', row => { row.tenant_id = 'other'; }],
  ['report tenant', row => { row.report.tenantId = 'other'; resign(row); }],
  ['suite metadata', row => { row.suite_name = 'release_qualification_v1'; }],
  ['source metadata', row => { row.source = 'server:release-qualification:v1'; }],
  ['run identity', row => { row.id = 'wrong-id'; }],
  ['ok metadata', row => { row.ok = true; }],
  ['total metadata', row => { row.total = 1; }],
  ['passed metadata', row => { row.passed = 8; }],
  ['failed metadata', row => { row.failed = 0; }],
  ['missing check even when signed', row => { row.report.audit.checks.pop(); resign(row); }],
  ['forged ready even when signed', row => { row.report.audit.ready = true; resign(row); }],
  ['future stored timestamp', row => { row.created_at = iso(NOW + 1); }],
  ['undated storage', row => { row.created_at = null; }],
  ['stale storage timestamp', row => { row.created_at = iso(NOW - 60_001); }],
  ['oversized signed report', row => { row.report.extra = 'x'.repeat(65_537); resign(row); }],
  ['unexpected signed field', row => { row.report.extra = 'private-seller'; resign(row); }],
  ['release qualification HMAC domain', row => { resign(row, 'pbk.release-qualification.signing-key.v1'); }],
  ['auth HMAC domain', row => { resign(row, 'pbk.auth.signing-key.v1'); }],
  ['signed short window', row => { row.report.audit.windowStart = iso(NOW - DAY + 1); resign(row); }],
  ['signed shifted window', row => { row.report.audit.windowStart = iso(NOW - DAY - 1); row.report.audit.windowEnd = iso(NOW - 1); resign(row); }],
  ['signed excessive duration', row => { row.report.startedAt = iso(NOW - 60_001); resign(row); }],
]) {
  test(`readback rejects ${label} without proof or older fallback`, async () => {
    const { pool } = await execute(); mutate(pool.rows[0]);
    const result = await read(pool);
    assert.equal(result.verified, false);
    assert.equal(result.audit.ready, false);
    assert.deepEqual(result.evidence, {});
    assert.equal(JSON.stringify(result).includes('private-seller'), false);
  });
}

test.each([
  ['wrong revision', { revision: 'b'.repeat(40) }], ['invalid revision', { revision: 'main' }],
  ['wrong secret', { secret: 'different-test-material' }], ['no secret', { secret: '' }],
  ['future', { now: NOW - 1 }], ['expired', { now: NOW + DAY }], ['invalid clock', { now: NaN }],
])('readback rejects %s', async (_name, overrides) => {
  const { pool } = await execute(); assert.equal((await read(pool, overrides)).verified, false);
});

test('writer ordering ignores out-of-order transaction starts and lexical identities', async () => {
  const { pool } = await execute(database([NOW + 1, NOW - 1000]), { createId: () => 'z-old-pass', collect: async () => collection(NOW, true) });
  await execute(pool, { createId: () => 'a-new-failure' });
  const result = await read(pool);
  assert.equal(result.runId, 'a-new-failure'); assert.equal(result.audit.ready, false);
  const insert = pool.statements.find(q => /INSERT/.test(q.sql)).sql;
  assert.match(insert, /GREATEST\(clock_timestamp\(\)/);
  assert.match(insert, /MAX\(created_at\)\s*\+\s*INTERVAL '1 microsecond'/);
  assert.doesNotMatch(insert, /\bNOW\(\)/i);
  assert(pool.statements.some(q => /pg_try_advisory_xact_lock/.test(q.sql) && q.values[0] === SOURCE));
  pool.rows[1].report.attestation.signature = '0'.repeat(64);
  assert.equal((await read(pool)).verified, false);
});

test('missing storage/schema, failed writer, failed readback and busy lock fail closed', async () => {
  assert.equal((await read(null)).verified, false);
  assert.equal((await read(database())).verified, false);
  for (const flag of ['failRead', 'failWrite', 'busy']) {
    const pool = database(); pool[flag] = true;
    const { result } = await execute(pool);
    assert.equal(result.verified, false);
    assert.equal(result.readbackVerified, false);
    assert.deepEqual(result.evidence, {});
    assert.equal(JSON.stringify(result).includes('private-'), false);
    if (flag === 'busy') assert.equal(result.result, 'operational_audit_in_progress');
  }
  const result = await read({ query: async () => { throw new Error('private-schema-error'); } });
  assert.equal(result.source, 'postgres_unavailable');
  assert.equal(JSON.stringify(result).includes('private-schema-error'), false);
});

test('failed independent readback never falls back to an in-memory signed result', async () => {
  const pool = database(); const query = pool.query;
  pool.query = async (...args) => { const result = await query(...args); result.rows = []; return result; };
  assert.equal((await execute(pool)).result.verified, false);
  assert.equal(pool.rows.length, 1);
});

test.each([{ revision: 'main' }, { secret: '' }, { collect: {} }, { createId: () => 'unsafe id' }])('bad runtime inputs never insert a receipt: %p', async overrides => {
  const { pool, result } = await execute(database(), overrides);
  assert.equal(result.verified, false); assert.equal(pool.rows.length, 0);
});

test.each(['timeout', 'invalid-clock', 'throwing-clock', 'reversed-clock', 'failed-final-update', 'zero-final-update'])
  ('prior pass stays blocked after newer admitted attempt: %s', async kind => {
    const { pool } = await execute(database(), { createId: () => 'old-pass', collect: async () => collection(NOW, true) });
    assert.equal((await read(pool)).audit.ready, true);
    let time = NOW;
    let throwClock = false;
    const { result } = await execute(pool, { createId: () => 'new-attempt', now: () => {
      if (throwClock) throw new Error('private-clock-error');
      return time;
    }, collect: async () => {
      assert.equal(pool.rows.length, 2, 'admission must commit before collector starts');
      assert.equal((await read(pool)).audit.ready, false, 'pending attempt already blocks the old pass');
      if (kind === 'timeout') time += 60_001;
      if (kind === 'invalid-clock') time = NaN;
      if (kind === 'throwing-clock') throwClock = true;
      if (kind === 'reversed-clock') time -= 1;
      if (kind === 'failed-final-update') pool.failUpdate = true;
      if (kind === 'zero-final-update') pool.zeroUpdate = true;
      return collection(NOW, true);
    } });
    assert.equal(result.verified, false);
    assert.equal(pool.rows[1].report.completedAt, null, 'never fabricate completion or replace pending after a failed write');
    assert.equal(pool.rows[1].ok, false);
    assert.equal(pool.rows[1].report.audit.ready, false);
    assert.equal(pool.rows[1].created_at, iso(NOW));
    assert.equal((await read(pool, { now: NOW + 60_001 })).verified, false);
    assert.equal((await read(pool, { now: NOW + 60_001 })).audit.ready, false);
    assert.equal(JSON.stringify(pool.rows).includes('private-'), false);
    if (kind === 'failed-final-update') {
      const commit = pool.statements.findIndex(q => q.sql === 'COMMIT');
      const update = pool.statements.findIndex((q, index) => index > commit && /UPDATE/.test(q.sql) && q.values[0] === 'new-attempt');
      assert(update > commit, 'failure injection must happen after pending commit, at final UPDATE');
    }
  });

test('failed initial admission never executes the collector or claims an admitted attempt', async () => {
  const { pool } = await execute(database(), { createId: () => 'old-pass', collect: async () => collection(NOW, true) });
  pool.failWrite = true;
  let collected = false;
  const { result } = await execute(pool, { createId: () => 'not-admitted', collect: async () => { collected = true; return collection(); } });
  assert.equal(collected, false);
  assert.equal(result.verified, false);
  assert.equal(pool.rows.length, 1);
});

test('late finalization preserves admission order and cannot promote an older pass over a newer failure', async () => {
  const pool = database();
  let oldCreatedUs;
  const old = await execute(pool, { createId: () => 'older-pass', collect: async () => {
    oldCreatedUs = pool.rows[0].createdUs;
    await execute(pool, { createId: () => 'newer-failure', collect: async () => { throw new Error('private-error'); } });
    return collection(NOW, true);
  } });
  assert.equal(pool.rows[0].createdUs, oldCreatedUs, 'UPDATE must preserve admission timestamp');
  assert.equal(pool.rows[0].report.audit.ready, true, 'old completion is stored but never selected as latest');
  assert.equal(old.result.verified, false, 'older execution response must not expose superseded passing proof');
  assert.equal(old.result.audit.ready, false);
  const latest = await read(pool);
  assert.equal(latest.runId, 'newer-failure');
  assert.equal(latest.audit.ready, false);
});

test('late older completion cannot bypass a newer pending attempt', async () => {
  const pool = database();
  const old = await execute(pool, { createId: () => 'older-pass', collect: async () => {
    await execute(pool, { createId: () => 'newer-pending', now: (() => { let calls = 0; return () => ++calls === 1 ? NOW : NaN; })() });
    return collection(NOW, true);
  } });
  assert.equal(old.result.verified, false);
  assert.equal((await read(pool)).verified, false);
  assert.equal((await read(pool)).audit.ready, false);
});

test('production store only inserts/finalizes its own receipt and never mutates schemas or admission order', async () => {
  const { pool } = await execute();
  for (const { sql } of pool.statements) {
    assert.match(sql.trim(), /^(SELECT|INSERT INTO public\.pbk_eval_runs|UPDATE public\.pbk_eval_runs|BEGIN|COMMIT|ROLLBACK)\b/);
    assert.doesNotMatch(sql, /\b(CREATE|ALTER|DELETE|TRUNCATE)\b/i);
    if (/^UPDATE/.test(sql.trim())) {
      assert.doesNotMatch(sql, /created_at\s*=/);
      assert.match(sql, /WHERE id = \$1 AND tenant_id = \$2 AND suite_name = \$3 AND source = \$9/);
      assert.match(sql, /report = \$10::jsonb/);
    }
  }
  const lookup = pool.statements.at(-1);
  assert.match(lookup.sql, /tenant_id = \$1 AND \(suite_name = \$2 OR source = \$3\)/);
  assert.match(lookup.sql, /ORDER BY created_at DESC, id DESC LIMIT 1/);
});

const postgresTest = process.env.PBK_TEST_DATABASE_URL ? test : test.skip;
postgresTest('disposable Postgres operational JSONB proof, tampering and latest failed attempt', async () => {
  assert.equal(process.env.PBK_TEST_DATABASE_URL, process.env.PBK_EVAL_DATABASE_URL,
    'Run only through the disposable evaluation harness');
  assert(new URL(process.env.PBK_TEST_DATABASE_URL).hostname.endsWith('.neon.tech'),
    'Integration is restricted to the disposable Neon lane');
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.PBK_TEST_DATABASE_URL,
    max: 2, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  const ids = Array.from({ length: 3 }, () => `operational-test-${randomUUID()}`);
  const run = (id, collect) => api('executeOperationalAudit')({ pool, revision, secret, createId: () => id, collect });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.pbk_eval_runs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'pbk', suite_name TEXT NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT FALSE, total INT NOT NULL DEFAULT 0, passed INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0, report JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const report = await run(ids[0], async ({ windowEnd }) => collection(Date.parse(windowEnd)));
    assert.equal(report.readbackVerified, true);
    assert.equal(report.audit.ready, false, 'synthetic unknown monitoring coverage never passes');
    assert.equal((await read(pool, { id: ids[0], now: Date.now() })).verified, true);
    await pool.query(`UPDATE public.pbk_eval_runs SET report = jsonb_set(report,
      '{audit,checks,0,counts,total}', '99'::jsonb) WHERE id = $1`, [ids[0]]);
    assert.equal((await read(pool, { id: ids[0], now: Date.now() })).verified, false);
    assert.equal((await run(ids[1], async ({ windowEnd }) => collection(Date.parse(windowEnd), true))).audit.ready, true);
    assert.equal((await run(ids[2], async () => { throw new Error('private-collector-error'); })).audit.ready, false);
    const latest = await read(pool, { now: Date.now() });
    assert.equal(latest.runId, ids[2]); assert.equal(latest.verified, true); assert.equal(latest.audit.ready, false);
  } finally {
    try { await pool.query('DELETE FROM public.pbk_eval_runs WHERE id = ANY($1::text[])', [ids]); }
    finally { await pool.end(); }
  }
}, 30_000);
