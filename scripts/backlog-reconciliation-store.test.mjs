import assert from 'node:assert/strict';
import { test, jest } from '@jest/globals';
import { createHmac, randomUUID } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';

let store = {};
try { store = await import('./backlog-reconciliation-store.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }

const revision = 'a'.repeat(40);
const secret = 'backlog-reconciliation-test-signing-material';
const NOW = Date.parse('2026-11-16T12:00:00.000Z');
const DAY = 24 * 3600_000;
const SOURCE = 'server:backlog-reconciliation:v1';
const SUITE = 'backlog_reconciliation_v1';
const SCHEMA = 'pbk-backlog-reconciliation-v1';
const iso = ms => new Date(ms).toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const isoUs = us => `${iso(Number(us / 1000n)).slice(0, -1)}${String(us % 1000n).padStart(3, '0')}Z`;

function api(name) {
  assert.equal(typeof store[name], 'function', `${name} must implement durable reconciliation receipts`);
  return store[name];
}

function collection() {
  return { ok: true, result: 'backlog_reconciliation_collected', reconciliation: {
    sourceFingerprint: '1'.repeat(64), complete: true, noContact: true, providerWritesBlocked: true,
    counts: { dispatchesLocked: 1, deadLettersOpen: 1, qaRecovered: 1, qaUnverified: 0,
      memoryVerified: 0, memoryUnverified: 1 },
    dispatches: [{ recordRef: '2'.repeat(64), sourceBinding: '3'.repeat(64),
      status: 'manual_review_locked', deliveryProof: 'unverified', binding: 'present', approval: 'pending' }],
    deadLetters: [{ recordRef: '4'.repeat(64), sourceBinding: '5'.repeat(64),
      status: 'review_required', qa: 'verified', memory: 'unverified', fullRecovery: 'unverified' }],
  } };
}
const collect = async () => collection();

// JSONB key order and microsecond admission order deliberately differ from JS object/id ordering.
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
  let before;
  const pool = { rows, statements, clockMs: NOW, releases: [] };
  let transaction = false;
  const query = async (config, args = [], connection) => {
    const sql = typeof config === 'string' ? config : config.text;
    const values = typeof config === 'string' ? args : config.values || [];
    statements.push({ sql, values, config });
    const intercepted = await pool.beforeQuery?.({ sql, values, config });
    if (connection?.destroyed) throw new Error('private-destroyed-connection');
    if (intercepted) return intercepted;
    if (sql === 'BEGIN') {
      transaction = true; transactionStart = transactionStarts.shift() ?? NOW;
      before = rows.map(row => ({ ...row }));
    }
    if (sql === 'ROLLBACK') { rows.splice(0, rows.length, ...before); transaction = false; }
    if (sql === 'COMMIT') transaction = false;
    if (/pg_try_advisory_xact_lock/.test(sql)) return { rows: [{ acquired: !pool.busy }] };
    if (/^SELECT.*to_char\(GREATEST/s.test(sql)) {
      const wall = BigInt(pool.clockMs) * 1000n;
      const max = rows.reduce((v, row) => row.createdUs > v ? row.createdUs : v, 0n);
      return { rows: [{ admitted_at: isoUs(wall > max ? wall : max + 1n) }] };
    }
    if (/INSERT INTO public.pbk_eval_runs/.test(sql)) {
      if (pool.failWrite) throw new Error('private-write-error');
      if (rows.some(row => row.id === values[0])) throw new Error('private-duplicate-id');
      const wall = BigInt(pool.clockMs) * 1000n;
      const max = rows.reduce((v, row) => row.createdUs > v ? row.createdUs : v, 0n);
      const createdUs = values[9] ? BigInt(Date.parse(values[9])) * 1000n + BigInt(values[9].slice(-4, -1))
        : /GREATEST\(clock_timestamp\(\)/.test(sql) && /MAX\(created_at\)/.test(sql)
          ? (wall > max ? wall : max + 1n) : BigInt(transactionStart) * 1000n;
      rows.push({ id: values[0], tenant_id: values[1], suite_name: values[2], ok: values[3],
        total: values[4], passed: values[5], failed: values[6], report: jsonb(JSON.parse(values[7])),
        source: values[8], created_at: iso(Number(createdUs / 1000n)), createdUs });
      return { rows: [], rowCount: pool.zeroInsert ? 0 : 1 };
    }
    if (/UPDATE public.pbk_eval_runs/.test(sql)) {
      if (pool.failUpdate) throw new Error('private-final-update-error');
      const row = rows.find(row => row.id === values[0] && row.tenant_id === values[1]
        && row.suite_name === values[2] && row.source === values[8]
        && canonicalJson(row.report) === canonicalJson(JSON.parse(values[9]))
        && (values[10] === undefined || isoUs(row.createdUs) === values[10]));
      if (!row || pool.zeroUpdate) return { rows: [], rowCount: 0 };
      Object.assign(row, { ok: values[3], total: values[4], passed: values[5], failed: values[6],
        report: jsonb(JSON.parse(values[7])) });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM public.pbk_eval_runs/.test(sql)) {
      if (pool.failRead) throw new Error('private-read-error');
      const ordered = [...rows].sort((a, b) => a.createdUs === b.createdUs
        ? b.id.localeCompare(a.id) : a.createdUs > b.createdUs ? -1 : 1);
      const selected = ordered.filter(row => values.length < 4 || row.id === values[3]).slice(0, 1);
      return { rows: selected.map(({ createdUs, ...row }) => clone({ ...row, created_at_exact: isoUs(createdUs) })) };
    }
    return { rows: [] };
  };
  pool.query = async (...args) => {
    assert.equal(acquired, false, 'reader/collector must not hold the writer connection');
    return query(...args);
  };
  pool.connect = async () => {
    assert.equal(acquired, false, 'single-client pool cannot be acquired twice');
    acquired = true;
    const connection = { destroyed: false };
    return { query: (config, values) => query(config, values, connection), release(destroy) {
      assert.equal(acquired, true, 'release exactly once');
      pool.releases.push(Boolean(destroy));
      if (destroy) {
        connection.destroyed = true;
        if (transaction) { rows.splice(0, rows.length, ...before); transaction = false; }
      }
      acquired = false;
    } };
  };
  return pool;
}

async function execute(pool = database(), overrides = {}) {
  const result = await api('executeBacklogReconciliation')({ pool, revision, secret, collect,
    now: () => NOW, createId: () => 'reconciliation-test-1', ...overrides });
  return { pool, result };
}
const read = (pool, overrides = {}) => api('readBacklogReconciliation')({ pool, revision, secret,
  collect, now: NOW, ...overrides });

function resign(row, domain = 'pbk.backlog-reconciliation.signing-key.v1') {
  const { attestation: _ignored, ...unsigned } = row.report;
  const key = createHmac('sha256', secret).update(domain).digest();
  row.report.attestation = { version: SCHEMA,
    signature: createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex') };
}

function blocked(result) {
  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.equal(result.readbackVerified, false);
  assert.equal(result.launchQualified, false);
  assert.equal(result.reconciliation, null);
  assert.equal(JSON.stringify(result).includes('private-'), false);
}

test('signed JSONB readback is diagnostic only and never certifies delivery or launch', async () => {
  const { pool, result } = await execute();
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.readbackVerified, true);
  assert.equal(result.launchQualified, false);
  assert.equal(result.source, 'postgres:pbk_eval_runs');
  assert.deepEqual(result.reconciliation, collection().reconciliation);
  assert.equal(Object.hasOwn(result.reconciliation, 'ready'), false);
  assert.equal(Object.hasOwn(result.reconciliation, 'launchReady'), false);
  const row = pool.rows[0];
  assert.equal(row.suite_name, SUITE);
  assert.equal(row.source, SOURCE);
  assert.equal(row.report.schemaVersion, SCHEMA);
  assert.equal(row.report.tenantId, 'pbk');
  assert.equal(row.ok, false);
  assert.equal(row.passed, 0);
  assert.equal(row.total, 2);
  assert.equal(row.failed, 2);
  const signature = row.report.attestation.signature;
  resign(row);
  assert.equal(row.report.attestation.signature, signature, 'exact domain-separated canonical HMAC');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual((await read(pool)).reconciliation, result.reconciliation);
});

test('empty source snapshot still has false ok, zero passed and no launch claim', async () => {
  const empty = collection();
  empty.reconciliation.dispatches = []; empty.reconciliation.deadLetters = [];
  for (const key of Object.keys(empty.reconciliation.counts)) empty.reconciliation.counts[key] = 0;
  const { pool, result } = await execute(database(), { collect: async () => empty });
  assert.equal(result.verified, true);
  assert.equal(pool.rows[0].ok, false);
  assert.equal(pool.rows[0].total, 0);
  assert.equal(pool.rows[0].failed, 0);
});

test('commits signed pending before collection and releases writer for a pool of one', async () => {
  const pool = database();
  let calls = 0;
  const { result } = await execute(pool, { collect: async args => {
    assert.deepEqual(args, { now: NOW });
    if (++calls === 1) {
      assert.equal(pool.statements.at(-1).sql, 'COMMIT');
      assert.equal(pool.rows[0].report.completedAt, null);
      assert.equal(pool.rows[0].report.reconciliation, null);
      assert.equal(pool.rows[0].ok, false);
      const signature = pool.rows[0].report.attestation.signature;
      resign(pool.rows[0]);
      assert.equal(pool.rows[0].report.attestation.signature, signature);
      blocked(await read(pool));
    }
    await pool.query('SELECT 1');
    return collection();
  } });
  assert.equal(result.verified, true);
  assert.equal(calls, 3, 'initial collection plus independent own and latest source-current readbacks');
  assert(pool.statements.some(q => /id = \$4/.test(q.sql)), 'own receipt is independently fetched');
});

test('read collects at its current clock and canonical equality tolerates JSONB key ordering', async () => {
  const { pool } = await execute();
  const result = await read(pool, { now: NOW + 1000, collect: async args => {
    assert.deepEqual(args, { now: NOW + 1000 });
    return jsonb(collection());
  } });
  assert.equal(result.verified, true);
});

test.each(['absent', 'throw', 'not-ok', 'missing', 'changed-fingerprint', 'changed-row', 'changed-counts'])
  ('fresh source failure blocks an otherwise valid stored signature: %s', async kind => {
    const { pool } = await execute();
    const fresh = collection();
    if (kind === 'not-ok') fresh.ok = false;
    if (kind === 'missing') delete fresh.reconciliation;
    if (kind === 'changed-fingerprint') fresh.reconciliation.sourceFingerprint = 'f'.repeat(64);
    if (kind === 'changed-row') fresh.reconciliation.dispatches[0].approval = 'approved';
    if (kind === 'changed-counts') {
      fresh.reconciliation.deadLetters[0].qa = 'unverified';
      fresh.reconciliation.counts.qaRecovered = 0; fresh.reconciliation.counts.qaUnverified = 1;
    }
    blocked(await read(pool, { collect: kind === 'absent' ? undefined : async () => {
      if (kind === 'throw') throw new Error('private-source-error');
      return fresh;
    } }));
  });

test.each(['throw', 'not-ok', 'null', 'raw-shape', 'unsafe-count', 'extra-field'])
  ('source error leaves newest pending, redacted and blocking older reports: %s', async kind => {
    const { pool } = await execute(database(), { createId: () => 'z-old' });
    const { result } = await execute(pool, { createId: () => 'a-new', collect: async () => {
      blocked(await read(pool));
      const data = collection();
      if (kind === 'throw') throw new Error('private-source-error');
      if (kind === 'not-ok') data.ok = false;
      if (kind === 'null') return null;
      if (kind === 'raw-shape') data.reconciliation = { transcript: 'private-seller' };
      if (kind === 'unsafe-count') data.reconciliation.counts.qaRecovered = -1;
      if (kind === 'extra-field') data.reconciliation.transcript = 'private-seller';
      return data;
    } });
    blocked(result);
    assert.equal(pool.rows[1].report.completedAt, null);
    assert.equal(pool.rows[1].report.reconciliation, null);
    blocked(await read(pool));
    blocked(await read(pool, { id: 'z-old' }));
    assert.equal(JSON.stringify(pool.rows.map(row => row.report)).includes('private-'), false);
  });

for (const [label, mutate] of [
  ['unsigned', row => { delete row.report.attestation; }],
  ['tampered source', row => { row.report.reconciliation.sourceFingerprint = 'f'.repeat(64); }],
  ['bad signature', row => { row.report.attestation.signature = 'x'; }],
  ['attestation extra', row => { row.report.attestation.extra = true; }],
  ['tenant metadata', row => { row.tenant_id = 'other'; }],
  ['report tenant', row => { row.report.tenantId = 'other'; resign(row); }],
  ['suite', row => { row.suite_name = 'operational_audit_v1'; }],
  ['source', row => { row.source = 'server:operational-audit:v1'; }],
  ['id', row => { row.id = 'wrong-id'; }],
  ['report id', row => { row.report.runId = 'unsafe id'; resign(row); }],
  ['schema', row => { row.report.schemaVersion = 'other'; resign(row); }],
  ['provenance', row => { row.report.provenance = 'synthetic'; resign(row); }],
  ['revision', row => { row.report.revision = 'b'.repeat(40); resign(row); }],
  ['guard', row => { row.report.guard.providerWritesBlocked = false; resign(row); }],
  ['signed extra', row => { row.report.extra = 'private-seller'; resign(row); }],
  ['signed oversized', row => { row.report.extra = 'x'.repeat(65_537); resign(row); }],
  ['ok', row => { row.ok = true; }],
  ['passed', row => { row.passed = 1; }],
  ['failed', row => { row.failed = 0; }],
  ['total', row => { row.total = '2'; }],
  ['signed invalid shape', row => { row.report.reconciliation.complete = false; resign(row); }],
  ['signed count mismatch', row => { row.report.reconciliation.counts.dispatchesLocked = 2; resign(row); }],
  ['signed false delivery proof', row => { row.report.reconciliation.dispatches[0].deliveryProof = 'verified'; resign(row); }],
  ['signed false recovery', row => { row.report.reconciliation.deadLetters[0].fullRecovery = 'verified'; resign(row); }],
  ['signed contact field', row => { row.report.reconciliation.deadLetters[0].contact = 'private-seller'; resign(row); }],
  ['future storage', row => { row.created_at = iso(NOW + 1); }],
  ['missing storage date', row => { row.created_at = null; }],
  ['stale storage', row => { row.created_at = iso(NOW - 60_001); }],
  ['invalid started', row => { row.report.startedAt = 'not-a-date'; resign(row); }],
  ['reversed time', row => { row.report.startedAt = iso(NOW + 1); resign(row); }],
  ['future completion', row => { row.report.completedAt = iso(NOW + 1); resign(row); }],
  ['overlong duration', row => { row.report.startedAt = iso(NOW - 60_001); resign(row); }],
  ['audit domain', row => { resign(row, 'pbk.operational-audit.signing-key.v1'); }],
  ['release domain', row => { resign(row, 'pbk.release-qualification.signing-key.v1'); }],
]) {
  test(`strict readback rejects ${label} without leaking a usable snapshot`, async () => {
    const { pool } = await execute(); mutate(pool.rows[0]);
    blocked(await read(pool));
  });
}

test.each([
  ['wrong revision', { revision: 'b'.repeat(40) }], ['invalid revision', { revision: 'main' }],
  ['wrong secret', { secret: 'different-test-material' }], ['empty secret', { secret: '' }],
  ['future', { now: NOW - 1 }], ['expired', { now: NOW + DAY }], ['clock', { now: NaN }],
  ['bad id', { id: 'unsafe id' }], ['missing id', { id: 'missing' }],
])('reader fails closed for %s', async (_label, overrides) => {
  const { pool } = await execute(); blocked(await read(pool, overrides));
});

test('duration accepts 60s exactly; TTL starts at start, not completion or read', async () => {
  // A one-millisecond TTL boundary must not depend on time spent running the test itself.
  jest.useFakeTimers();
  try {
    let clock = NOW;
    let calls = 0;
    const { pool, result } = await execute(database(), { now: () => clock, collect: async () => {
      if (++calls === 1) clock += 60_000;
      return collection();
    } });
    assert.equal(result.verified, true);
    assert.equal(result.executedAt, iso(NOW + 60_000));
    assert.equal((await read(pool, { now: NOW + DAY - 1 })).verified, true);
    blocked(await read(pool, { now: NOW + DAY }));
  } finally { jest.useRealTimers(); }
});

test.each(['timeout', 'invalid-clock', 'throwing-clock', 'reversed-clock', 'failUpdate', 'zeroUpdate', 'cas-change'])
  ('new pending blocks older evidence after finalization failure: %s', async kind => {
    const { pool } = await execute(database(), { createId: () => 'old' });
    let clock = NOW;
    let throws = false;
    const { result } = await execute(pool, { createId: () => 'new', now: () => {
      if (throws) throw new Error('private-clock-error');
      return clock;
    }, collect: async () => {
      if (kind === 'timeout') clock += 60_001;
      if (kind === 'invalid-clock') clock = NaN;
      if (kind === 'throwing-clock') throws = true;
      if (kind === 'reversed-clock') clock -= 1;
      if (['failUpdate', 'zeroUpdate'].includes(kind)) pool[kind] = true;
      if (kind === 'cas-change') pool.rows[1].report.attestation.signature = '0'.repeat(64);
      return collection();
    } });
    blocked(result);
    assert.equal(pool.rows[1].report.completedAt, null);
    blocked(await read(pool, { now: NOW + 60_001 }));
  });

test.each(['failWrite', 'zeroInsert', 'busy'])('failed admission never invokes collection: %s', async flag => {
  const pool = database(); pool[flag] = true;
  let calls = 0;
  const { result } = await execute(pool, { collect: async () => { calls++; return collection(); } });
  blocked(result);
  if (flag === 'busy') assert.equal(result.result, 'backlog_reconciliation_in_progress');
  assert.equal(calls, 0);
  assert.equal(pool.rows.length, 0);
});

test.each([{ revision: 'main' }, { secret: '' }, { collect: undefined }, { now: NOW },
  { now: () => NaN }, { createId: () => 'unsafe id' }, { createId: null }])
  ('invalid runtime inserts nothing: %p', async overrides => {
    const { pool, result } = await execute(database(), overrides);
    blocked(result); assert.equal(pool.rows.length, 0);
  });

test('missing storage and failed independent readback never use an in-memory report', async () => {
  blocked(await read(null)); blocked(await read(database()));
  blocked((await execute(null)).result);
  const pool = database();
  pool.beforeQuery = async ({ sql }) => /^SELECT id/.test(sql.trim()) ? { rows: [] } : undefined;
  blocked((await execute(pool)).result);
  assert.equal(pool.rows[0].report.completedAt, iso(NOW));
  const broken = database(); broken.failRead = true;
  blocked((await execute(broken)).result);
});

test('each independent readback requires fresh source equality', async () => {
  for (const changedAt of [2, 3]) {
    let calls = 0;
    const { result } = await execute(database(), { collect: async () => {
      const data = collection();
      if (++calls === changedAt) data.reconciliation.sourceFingerprint = 'f'.repeat(64);
      return data;
    } });
    blocked(result);
    assert.equal(calls, changedAt);
  }
});

test.each(['pending', 'invalid'])('latest reader catches a newer %s admitted during fresh collection', async kind => {
  const { pool } = await execute(database(), { createId: () => 'old' });
  blocked(await read(pool, { collect: async () => {
    await execute(pool, { createId: () => 'new', collect: async () => {
      throw new Error('private-source-error');
    } });
    if (kind === 'invalid') {
      pool.rows[1].report.completedAt = iso(NOW);
      pool.rows[1].report.attestation.signature = '0'.repeat(64);
    }
    return collection();
  } }));
});

test('monotonic admission beats lexical ids and out-of-order transaction starts', async () => {
  const { pool } = await execute(database([NOW + 1, NOW - 1000]), { createId: () => 'z-old' });
  await execute(pool, { createId: () => 'a-new', revision: 'b'.repeat(40) });
  blocked(await read(pool));
  assert.equal((await read(pool, { revision: 'b'.repeat(40) })).runId, 'a-new');
  pool.rows[1].report.attestation.signature = '0'.repeat(64);
  blocked(await read(pool));
  const admission = pool.statements.find(q => /GREATEST\(clock_timestamp\(\)/.test(q.sql)).sql;
  assert.match(admission, /MAX\(created_at\)\s*\+\s*INTERVAL '1 microsecond'/);
  assert.doesNotMatch(admission, /\bNOW\(\)/i);
});

test.each(['pending', 'failed', 'complete'])('late old completion cannot supersede newer %s', async kind => {
  const pool = database();
  const { result } = await execute(pool, { createId: () => 'z-old', collect: async () => {
    if (pool.rows.length === 1) await execute(pool, { createId: () => 'a-new',
      now: kind === 'pending' ? (() => { let calls = 0; return () => ++calls === 1 ? NOW : NaN; })() : () => NOW,
      collect: kind === 'failed' ? async () => { throw new Error('private-source-error'); } : collect });
    return collection();
  } });
  blocked(result);
  assert.equal(pool.rows[0].report.completedAt, iso(NOW));
  assert.equal(pool.rows[0].createdUs, BigInt(NOW) * 1000n);
  if (kind === 'complete') assert.equal((await read(pool)).runId, 'a-new');
  else blocked(await read(pool));
  blocked(await read(pool, { id: 'z-old' }));
});

test('a hanging injected collector times out without finalizing or leaking the writer', async () => {
  jest.useFakeTimers();
  try {
    const pool = database();
    const running = execute(pool, { collect: () => new Promise(() => {}) });
    await jest.advanceTimersByTimeAsync(60_001);
    blocked((await running).result);
    assert.equal(pool.rows[0].report.completedAt, null);
    await pool.query('SELECT 1');
  } finally { jest.useRealTimers(); }
});

test('only own evaluation receipt writes; no schema, source writes or latest-success filtering', async () => {
  const { pool } = await execute();
  for (const { sql, values } of pool.statements) {
    assert.match(sql.trim(), /^(SELECT|INSERT INTO public\.pbk_eval_runs|UPDATE public\.pbk_eval_runs|BEGIN|COMMIT|ROLLBACK)\b/);
    assert.doesNotMatch(sql, /\b(CREATE|ALTER|DELETE|TRUNCATE)\b/i);
    if (/pg_try_advisory_xact_lock/.test(sql)) assert.equal(values[0], SOURCE);
    if (/^UPDATE/.test(sql.trim())) {
      const setClause = /\bSET\b([\s\S]*?)\bWHERE\b/.exec(sql)?.[1];
      assert(setClause, 'UPDATE has an explicit bounded SET clause');
      assert.doesNotMatch(setClause, /created_at\s*=/);
      assert.match(sql, /WHERE id = \$1 AND tenant_id = \$2 AND suite_name = \$3 AND source = \$9/);
      assert.match(sql, /report = \$10::jsonb/);
    }
    if (/^SELECT id/.test(sql.trim())) {
      assert.match(sql, /tenant_id = \$1 AND \(suite_name = \$2 OR source = \$3\)/);
      assert.match(sql, /ORDER BY created_at DESC, id DESC LIMIT 1/);
      assert.doesNotMatch(sql, /AND\s+(ok|revision|report\s*->)/i);
    }
  }
});

test.each([1n, 1000n])('review regression: moving old admission by %s microseconds cannot resurrect it above pending', async shift => {
  const { pool } = await execute(database(), { createId: () => 'z-old' });
  await execute(pool, { createId: () => 'a-pending', collect: async () => null });
  pool.rows[0].createdUs = pool.rows[1].createdUs + shift;
  pool.rows[0].created_at = iso(Number(pool.rows[0].createdUs / 1000n));
  blocked(await read(pool, { now: NOW + 2 }));
});

test('review regression: exact microsecond admission is signed in pending and final and preserved by CAS', async () => {
  const pool = database();
  pool.clockMs = NOW;
  await execute(pool, { createId: () => 'old' });
  let pending;
  const { result } = await execute(pool, { createId: () => 'new', collect: async () => {
    pending ??= clone(pool.rows[1].report);
    return collection();
  } });
  assert.equal(result.verified, true);
  assert.equal(pending.admittedAt, '2026-11-16T12:00:00.000001Z');
  assert.equal(pool.rows[1].report.admittedAt, pending.admittedAt);
  const update = pool.statements.find(q => /UPDATE/.test(q.sql) && q.values[0] === 'new');
  assert.match(update.sql, /created_at = \$11::timestamptz/);
  assert.equal(update.values[10], pending.admittedAt);
  const signature = pending.attestation.signature;
  const row = { report: pending };
  resign(row);
  assert.equal(row.report.attestation.signature, signature);
  pending.admittedAt = '2026-11-16T12:00:00.000002Z';
  resign(row);
  assert.notEqual(row.report.attestation.signature, signature);
});

test('review regression: changed pending ordering timestamp prevents finalization', async () => {
  const pool = database();
  const { result } = await execute(pool, { collect: async () => {
    pool.rows[0].createdUs += 1n;
    return collection();
  } });
  blocked(result);
  assert.equal(pool.rows[0].report.completedAt, null);
});

test('review regression: three injected 40s collections cannot return verified after 120s', async () => {
  let clock = NOW;
  const { result } = await execute(database(), { now: () => clock, collect: async () => {
    clock += 40_000;
    return collection();
  } });
  blocked(result);
});

test('review regression: three monotonic 40s collections share one 60s budget despite frozen injected time', async () => {
  jest.useFakeTimers();
  try {
    let settledAt;
    let calls = 0;
    const running = execute(database(), { collect: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 40_000));
      return collection();
    } }).then(value => { settledAt = performance.now(); return value; });
    await jest.advanceTimersByTimeAsync(180_001);
    blocked((await running).result);
    assert(settledAt <= 60_000, `settled at ${settledAt}ms`);
    assert.equal(calls, 2, 'latest readback must never start after the shared deadline');
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); }
});

test.each(['execute', 'read'])('review regression: %s bounds pool acquisition and destroys a late client', async mode => {
  const pool = database();
  if (mode === 'read') await execute(pool);
  const connect = pool.connect;
  let deliver;
  pool.connect = () => new Promise(resolve => { deliver = async () => resolve(await connect()); });
  jest.useFakeTimers();
  try {
    let settled = false;
    const running = (mode === 'execute' ? execute(pool) : read(pool)).then(value => { settled = true; return value; });
    await jest.advanceTimersByTimeAsync(60_001);
    const settledByDeadline = settled;
    pool.connect = connect;
    if (deliver) await deliver();
    await jest.advanceTimersByTimeAsync(1);
    const value = await running;
    assert.equal(settledByDeadline, true, 'pool acquisition must have its own bounded race');
    blocked(mode === 'execute' ? value.result : value);
    assert.equal(pool.releases.at(-1), true, 'late clients are destroyed instead of leaked');
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); }
});

test.each(['BEGIN', 'lock', 'timestamp', 'INSERT', 'UPDATE', 'admission COMMIT', 'final COMMIT', 'own read', 'latest read'])
  ('review regression: deadline during %s destroys connection and never late-commits', async stage => {
    const pool = database();
    let resume;
    let gate;
    let commits = 0;
    let selects = 0;
    pool.beforeQuery = async ({ sql }) => {
      if (sql === 'COMMIT') commits++;
      if (/^SELECT id/.test(sql.trim())) selects++;
      const target = stage === 'BEGIN' ? sql === 'BEGIN'
        : stage === 'lock' ? /pg_try_advisory_xact_lock/.test(sql)
          : stage === 'timestamp' ? /^SELECT.*to_char\(GREATEST/s.test(sql)
            : stage === 'INSERT' ? /^INSERT/.test(sql.trim())
              : stage === 'UPDATE' ? /^UPDATE/.test(sql.trim())
                : stage === 'admission COMMIT' ? sql === 'COMMIT' && commits === 1
                  : stage === 'final COMMIT' ? sql === 'COMMIT' && commits === 2
                    : stage === 'own read' ? /^SELECT id/.test(sql.trim()) && selects === 1
                      : /^SELECT id/.test(sql.trim()) && selects === 3;
      if (target && !gate) {
        gate = sql;
        await new Promise(resolve => { resume = resolve; });
      }
    };
    jest.useFakeTimers();
    try {
      let settled = false;
      const running = execute(pool).then(value => { settled = true; return value; });
      await jest.advanceTimersByTimeAsync(60_001);
      const settledByDeadline = settled;
      resume?.();
      await jest.advanceTimersByTimeAsync(1);
      const { result } = await running;
      assert(gate, `must actually exercise ${stage}`);
      assert.equal(settledByDeadline, true);
      blocked(result);
      assert.equal(pool.releases.at(-1), true);
      if (['BEGIN', 'lock', 'timestamp', 'INSERT', 'admission COMMIT'].includes(stage)) assert.equal(pool.rows.length, 0);
      if (['UPDATE', 'final COMMIT'].includes(stage)) assert.equal(pool.rows[0].report.completedAt, null);
      assert.equal(commits, ['BEGIN', 'lock', 'timestamp', 'INSERT'].includes(stage) ? 0
        : ['admission COMMIT', 'UPDATE'].includes(stage) ? 1 : 2);
      assert.equal(jest.getTimerCount(), 0);
    } finally { jest.useRealTimers(); }
  });

test('review regression: public reader shares 60s between DB wait and fresh collection', async () => {
  const { pool } = await execute();
  jest.useFakeTimers();
  try {
    let selects = 0;
    let settledAt;
    pool.beforeQuery = async ({ sql }) => {
      if (/^SELECT id/.test(sql.trim()) && ++selects === 1) await new Promise(resolve => setTimeout(resolve, 40_000));
    };
    const running = read(pool, { collect: async () => {
      await new Promise(resolve => setTimeout(resolve, 40_000));
      return collection();
    } }).then(value => { settledAt = performance.now(); return value; });
    await jest.advanceTimersByTimeAsync(120_001);
    blocked(await running);
    assert(settledAt <= 60_000);
    assert.equal(selects, 1, 'no latest query after collection deadline');
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); }
});

const postgresTest = process.env.PBK_TEST_DATABASE_URL ? test : test.skip;
postgresTest('disposable Postgres JSONB/CAS, pool one, tampering and pending latest', async () => {
  const url = process.env.PBK_TEST_DATABASE_URL;
  assert.equal(url, process.env.PBK_EVAL_DATABASE_URL, 'Only use the disposable evaluation harness');
  assert(new URL(url).hostname.endsWith('.neon.tech'), 'Only the disposable Neon test lane');
  for (const name of ['PBK_DATABASE_URL', 'DATABASE_URL', 'PBK_MIGRATION_DATABASE_URL']) {
    assert(!process.env[name] || process.env[name] === url, 'Never inherit a different runtime database');
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 1,
    connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  const ids = Array.from({ length: 3 }, () => `reconciliation-test-${randomUUID()}`);
  const run = (id, callback = collect) => api('executeBacklogReconciliation')({ pool, revision, secret,
    createId: () => id, collect: async args => { await pool.query('SELECT 1'); return callback(args); } });
  try {
    // Test-only setup in the explicitly isolated harness; production store never creates schemas.
    await pool.query(`CREATE TABLE IF NOT EXISTS public.pbk_eval_runs (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'pbk', suite_name TEXT NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT FALSE, total INT NOT NULL DEFAULT 0, passed INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0, report JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    assert.equal((await run(ids[0])).verified, true);
    await pool.query(`UPDATE public.pbk_eval_runs SET report = jsonb_set(report,
      '{reconciliation,sourceFingerprint}', $2::jsonb) WHERE id = $1`, [ids[0], JSON.stringify('f'.repeat(64))]);
    blocked(await read(pool, { now: Date.now() }));
    assert.equal((await run(ids[1])).verified, true);
    blocked(await run(ids[2], async () => { throw new Error('private-source-error'); }));
    blocked(await read(pool, { now: Date.now() }));
    blocked(await read(pool, { now: Date.now(), id: ids[1] }));
  } finally {
    try { await pool.query('DELETE FROM public.pbk_eval_runs WHERE id = ANY($1::text[])', [ids]); }
    finally { await pool.end(); }
  }
}, 30_000);
