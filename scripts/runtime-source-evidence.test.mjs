import assert from 'node:assert/strict';
import { beforeAll, afterAll, beforeEach, test, jest } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { controlledExecution } from './controlled-execution-scope.mjs';

let evidence = {}, context = {};
try { evidence = await import('./runtime-source-evidence.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
try { context = await import('./runtime-evidence-context.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const api = name => {
  assert.equal(typeof evidence[name], 'function', `${name} must implement authoritative source observation`);
  return evidence[name];
};
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const DAY = 86400000;
let fixtureNumber = 0;
let secret = 'explicit-local-runtime-source-test-material';
const freshSecret = () => { secret = `explicit-local-runtime-source-test-material-${++fixtureNumber}`; };
const revision = 'a'.repeat(40);
const iso = n => new Date(n).toISOString();
const SUITE = 'runtime_source_evidence_v1';
let db;
const client = { query: (config, values) => db.query(typeof config === 'string' ? config : config.text,
  typeof config === 'string' ? values : config.values) };
const pool = { connect: async () => ({ ...client, release() {} }) };
const record = async (extra = {}) => {
  const sourceKind = extra.sourceKind || 'runtime_archive';
  const sourceId = extra.sourceId || 'private-source-id';
  let writeBinding = extra.writeBinding;
  if (!Object.hasOwn(extra, 'writeBinding') && ['runtime_archive', 'conversation_projection', 'qa', 'safety'].includes(sourceKind)) {
    const table = { runtime_archive: 'activity_log', conversation_projection: 'conversation_events',
      qa: 'pbk_qa_audit', safety: 'pbk_safety_audit' }[sourceKind];
    const row = (await db.query(`UPDATE ${table} SET id=id WHERE id::text=$1
      RETURNING ${api('runtimeSourceWriteReturning')(sourceKind)}`, [sourceId])).rows[0]?.runtime_source_row;
    writeBinding = api('captureRuntimeSourceWriteBinding')({ secret, revision, sourceKind, row });
  }
  return api('recordRuntimeSourceEvidence')({ pool, secret, revision, sourceKind, sourceId,
    now: NOW, writeBinding, ...extra });
};
const collect = (extra = {}) => api('collectRuntimeSourceSnapshot')({ client, secret, revision,
  windowStart: NOW - DAY, windowEnd: NOW, now: NOW, ...extra });
const run = (origin, fn) => {
  assert.equal(typeof context.withRuntimeEvidenceContext, 'function');
  return context.withRuntimeEvidenceContext(origin, fn);
};
const source = snapshot => snapshot.sources.find(s => s.sourceKind === 'runtime_archive');

async function capturedWrite(extra = {}) {
  const projection = api('runtimeSourceWriteReturning')('runtime_archive');
  const row = (await db.query(`UPDATE activity_log SET id=id WHERE id='private-source-id'
    RETURNING ${projection}`)).rows[0].runtime_source_row;
  return api('captureRuntimeSourceWriteBinding')({ secret, revision,
    sourceKind: 'runtime_archive', row, ...extra });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE activity_log(id text PRIMARY KEY, workspace_id text DEFAULT 'pbk',
      source text DEFAULT 'runtime-event:pbk', status text DEFAULT 'success',
      category text DEFAULT 'EVENT', metadata jsonb DEFAULT '{}', text text DEFAULT '',
      created_at timestamptz, updated_at timestamptz);
    CREATE TABLE conversation_events(id uuid PRIMARY KEY, workspace_id text DEFAULT 'pbk',
      source_table text, source_id text, event_type text, channel text, direction text,
      status text, payload jsonb DEFAULT '{}', body text DEFAULT '',
      created_at timestamptz, updated_at timestamptz, occurred_at timestamptz);
    CREATE TABLE pbk_qa_audit(id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', tool_name text,
      passed boolean, skipped boolean, reason text, validator text, retry_count int,
      params jsonb DEFAULT '{}', result jsonb DEFAULT '{}', qa jsonb DEFAULT '{}', source text,
      created_at timestamptz);
    CREATE TABLE pbk_safety_audit(id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', tool_name text,
      blocked boolean, approval_required boolean, params jsonb DEFAULT '{}',
      validation jsonb DEFAULT '{}', source text, created_at timestamptz);
    CREATE TABLE pbk_eval_runs(id text PRIMARY KEY, tenant_id text, suite_name text,
      ok boolean, total int, passed int, failed int, report jsonb, source text, created_at timestamptz);
  `);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  freshSecret();
  await db.exec('TRUNCATE activity_log, conversation_events, pbk_qa_audit, pbk_safety_audit, pbk_eval_runs');
  await db.query(`INSERT INTO activity_log(id,text,metadata,created_at,updated_at)
    VALUES ('private-source-id','private seller answer', $1::jsonb,$2,$2)`,
  [JSON.stringify({ phone: 'private-contact', origin: 'operator_chat' }), iso(NOW - 1000)]);
});

test.each(['missing', 'copied', 'replayed', 'namespace', 'revision', 'context', 'overwritten', 'identity', 'kind'])
('persisted-write binding rejects %s before operational attestation', async mode => {
  await run('operator_chat', async () => {
    const writeBinding = await capturedWrite();
    if (mode === 'overwritten') await db.exec(`UPDATE activity_log SET text='another writer version'`);
    const input = { pool, secret, revision, sourceKind: 'runtime_archive',
      sourceId: 'private-source-id', now: NOW, writeBinding };
    if (mode === 'missing') delete input.writeBinding;
    if (mode === 'copied') input.writeBinding = { ...writeBinding };
    if (mode === 'namespace') input.secret = 'different-explicit-fixture-material';
    if (mode === 'revision') input.revision = 'b'.repeat(40);
    if (mode === 'identity') input.sourceId = 'another-source';
    if (mode === 'kind') input.sourceKind = 'qa';
    if (mode === 'replayed') assert.equal((await api('recordRuntimeSourceEvidence')(input)).verified, true);
    const result = mode === 'context'
      ? await run('diagnostic', () => api('recordRuntimeSourceEvidence')(input))
      : await api('recordRuntimeSourceEvidence')(input);
    assert.equal(result.verified, false);
    if (mode !== 'replayed') assert.equal((await db.query(`SELECT COUNT(*) AS n FROM pbk_eval_runs
      WHERE report->>'classification'='operational'`)).rows[0].n, 0);
  });
});

test('write bindings are detached and retain exact UTC microseconds, not just updatedAt milliseconds', async () => {
  await run('operator_chat', async () => {
    const projection = api('runtimeSourceWriteReturning')('runtime_archive');
    const row = (await db.query(`UPDATE activity_log SET updated_at=$1 RETURNING ${projection}`,
      ['2026-11-17T11:59:59.000123Z'])).rows[0].runtime_source_row;
    assert.equal(row.updated_at, '2026-11-17T11:59:59.000123Z');
    const writeBinding = api('captureRuntimeSourceWriteBinding')({ secret, revision, sourceKind: 'runtime_archive', row });
    row.text = 'application-side mutation must not mutate private binding';
    assert.equal((await record({ writeBinding })).verified, true);
    const next = await capturedWrite();
    await db.exec(`UPDATE activity_log SET updated_at=updated_at + interval '0.000001 seconds'`);
    assert.equal((await record({ writeBinding: next })).verified, false);
  });
  assert.throws(() => api('runtimeSourceWriteReturning')('constructor'));
});

test('a distinct same-origin execution cannot consume another execution write binding', async () => {
  const writeBinding = await run('operator_chat', () => capturedWrite());
  const result = await run('operator_chat', () => record({ writeBinding }));
  assert.equal(result.verified, false);
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pbk_eval_runs')).rows[0].n, 0);
});

test('an identical-value overwrite still cannot be attested as the first durable write', async () => {
  await run('operator_chat', async () => {
    const writeBinding = await capturedWrite();
    await db.exec('UPDATE activity_log SET id=id');
    assert.equal((await record({ writeBinding })).verified, false);
    assert.equal((await db.query(`SELECT COUNT(*) AS n FROM pbk_eval_runs
      WHERE report->>'classification'='operational'`)).rows[0].n, 0);
  });
});

test('capture in unknown or controlled scope cannot be upgraded by a later operator context', async () => {
  const unknown = await capturedWrite();
  const controlled = await controlledExecution.run({}, () => capturedWrite());
  for (const writeBinding of [unknown, controlled]) {
    const result = await run('operator_chat', () => record({ writeBinding }));
    assert.equal(result.verified, false);
  }
  assert.equal((await db.query('SELECT COUNT(*) AS n FROM pbk_eval_runs')).rows[0].n, 0);
});

test('trusted persisted binding is opaque, read back, idempotent and never a passed evaluation', async () => {
  const result = await run('operator_chat', () => record({ row: { status: 'success' } }));
  assert.equal(result.verified, true);
  assert.equal(result.classification, 'operational');
  await run('operator_chat', () => record());
  const allProof = (await db.query('SELECT * FROM pbk_eval_runs')).rows;
  const proof = allProof.filter(row => row.report.recordRef);
  assert.equal(proof.length, 1);
  assert.equal(allProof.length, 2, 'one source history and one signed inventory');
  assert.equal(proof[0].ok, false);
  assert.equal(proof[0].passed, 0);
  assert.equal(proof[0].suite_name, SUITE);
  assert.ok(Buffer.byteLength(JSON.stringify(proof[0].report)) <= 8192);
  const snapshot = await collect();
  assert.equal(snapshot.verified, true);
  assert.equal(snapshot.eligible, true);
  assert.equal(source(snapshot).counts.operational, 1);
  assert.equal(source(snapshot).rows[0].eligible, true);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW));
  assert.match(source(snapshot).fingerprint, /^[a-f0-9]{64}$/);
  for (const privateValue of ['private-source-id', 'private seller answer', 'private-contact', secret]) {
    assert.equal(JSON.stringify([allProof, snapshot, result]).includes(privateValue), false);
  }
});

test('caller labels and a context-free writer never establish business provenance', async () => {
  const result = await record({ origin: 'operator_chat', provenance: 'operational', success: true });
  assert.equal(result.verified, false);
  const snapshot = await collect();
  assert.equal(snapshot.eligible, false);
  assert.equal(source(snapshot).counts.unknown, 1);
  assert.equal(source(snapshot).rows[0].classification, 'unknown');
});

test('controlled ALS and diagnostics are bound but cannot become organic or hide failures', async () => {
  await controlledExecution.run({}, () => run('operator_chat', () => record()));
  let snapshot = await collect();
  assert.equal(source(snapshot).counts.controlled, 1);
  assert.equal(source(snapshot).rows[0].eligible, false);
  await db.exec('TRUNCATE pbk_eval_runs');
  await run('diagnostic', () => record());
  snapshot = await collect();
  assert.equal(source(snapshot).counts.diagnostic, 1);
  await db.query(`UPDATE activity_log SET status='error',source='runtime-event:controlled-qualification'`);
  snapshot = await collect();
  assert.equal(source(snapshot).counts.unknown, 1);
  assert.equal(source(snapshot).counts.failed, 1);
  assert.equal(snapshot.eligible, false);
});

test('unknown first observation uses actual current time, ages only unchanged, and resets on mutation/deletion', async () => {
  await db.query('UPDATE activity_log SET created_at=$1,updated_at=$1', [iso(NOW - 10 * DAY)]);
  let snapshot = await collect();
  const first = source(snapshot).rows[0];
  assert.equal(first.observedAt, iso(NOW));
  assert.equal(first.inWindow, true);
  snapshot = await collect({ now: NOW + 2 * DAY, windowStart: NOW + DAY, windowEnd: NOW + 2 * DAY });
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW));
  assert.equal(source(snapshot).rows[0].inWindow, false);
  assert.equal(source(snapshot).counts.unknown, 0);
  await db.query(`UPDATE activity_log SET metadata='{"new":"private mutation"}'`);
  snapshot = await collect({ now: NOW + 2 * DAY, windowStart: NOW + DAY, windowEnd: NOW + 2 * DAY });
  assert.equal(source(snapshot).counts.unknown, 1);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 2 * DAY));
  await db.exec('DELETE FROM activity_log');
  snapshot = await collect({ now: NOW + 3 * DAY, windowStart: NOW + 2 * DAY, windowEnd: NOW + 3 * DAY });
  assert.equal(source(snapshot).rows[0].presence, 'deleted');
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 3 * DAY));
  snapshot = await collect({ now: NOW + 4 * DAY, windowStart: NOW + 3 * DAY, windowEnd: NOW + 4 * DAY });
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 3 * DAY));
});

test('a fresh backdated row does not inherit another row old first observation', async () => {
  await collect();
  await db.query(`INSERT INTO activity_log(id,created_at,updated_at) VALUES ('new-backdated',$1,$1)`,
    [iso(NOW - 10 * DAY)]);
  const snapshot = await collect({ now: NOW + 2 * DAY, windowStart: NOW + DAY, windowEnd: NOW + 2 * DAY });
  assert.equal(source(snapshot).counts.unknown, 1);
});

test('edits, deleted/missing proof, and restored rows invalidate old operational evidence', async () => {
  await run('phone_turn', () => record());
  await db.query(`UPDATE activity_log SET text='edited private answer'`);
  assert.equal(source(await collect()).counts.unknown, 1);
  await db.exec('DELETE FROM pbk_eval_runs');
  assert.equal(source(await collect()).counts.unknown, 1);
  await db.exec('DELETE FROM activity_log');
  assert.equal(source(await collect()).rows[0].presence, 'deleted');
  await db.query(`INSERT INTO activity_log(id,created_at,updated_at) VALUES ('private-source-id',$1,$1)`, [iso(NOW - 1000)]);
  assert.equal(source(await collect()).rows[0].classification, 'unknown');
});

test.each(['signature', 'tenant', 'kind', 'revision', 'id', 'extra', 'replay'])('tampered/cross-bound proof fails closed: %s', async mode => {
  await run('operator_chat', () => record());
  if (mode === 'signature') await db.exec(`UPDATE pbk_eval_runs SET report=jsonb_set(report,'{signature}','"bad"')`);
  if (mode === 'tenant') await db.exec(`UPDATE pbk_eval_runs SET tenant_id='foreign'`);
  if (mode === 'kind') await db.exec(`UPDATE pbk_eval_runs SET report=jsonb_set(report,'{sourceKind}','"qa"')`);
  if (mode === 'revision') await db.exec(`UPDATE pbk_eval_runs SET report=jsonb_set(report,'{revision}','"wrong"')`);
  if (mode === 'id') await db.exec(`UPDATE pbk_eval_runs SET id='transplanted' WHERE report->>'recordRef' IS NOT NULL`);
  if (mode === 'extra') await db.exec(`UPDATE pbk_eval_runs SET report=report || '{"private":"forbidden"}'::jsonb`);
  if (mode === 'replay') await db.exec(`UPDATE activity_log SET id='different-row'`);
  const snapshot = await collect();
  assert.equal(snapshot.eligible, false);
  assert.equal(snapshot.sources?.find(s => s.sourceKind === 'runtime_archive').rows.some(row =>
    row.classification === 'operational' && row.eligible) ?? false, false);
});

test.each(['future', 'missing', 'reversed', 'status'])('invalid source clock/outcome cannot qualify: %s', async mode => {
  if (mode === 'future') await db.query('UPDATE activity_log SET updated_at=$1', [iso(NOW + 1)]);
  if (mode === 'missing') await db.exec('UPDATE activity_log SET created_at=NULL');
  if (mode === 'reversed') await db.query('UPDATE activity_log SET updated_at=$1', [iso(NOW - DAY)]);
  if (mode === 'status') await db.exec(`UPDATE activity_log SET status='caller-says-organic-success'`);
  assert.equal((await run('operator_chat', () => record())).verified, false);
  assert.equal((await collect()).eligible, false);
});

test('foreign workspace and source mismatch cannot obtain a receipt', async () => {
  await db.exec(`UPDATE activity_log SET workspace_id='foreign'`);
  assert.equal((await run('operator_chat', () => record())).verified, false);
  freshSecret();
  await db.exec('TRUNCATE pbk_eval_runs');
  await db.exec(`UPDATE activity_log SET workspace_id='pbk',source='not-runtime'`);
  assert.equal((await run('operator_chat', () => record())).verified, false);
  assert.equal((await record({ sourceKind: 'caller_table' })).verified, false);
});

test('actual projection, QA and safety schemas bind payload and outcomes, not invented columns', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  await db.query(`INSERT INTO conversation_events(id,source_table,source_id,event_type,channel,direction,
    status,body,payload,created_at,updated_at,occurred_at)
    VALUES ($1,'approvals','private-approval','system','system','internal','completed','private-body',
    '{"origin":"operator_chat"}',$2,$2,$2)`, [id, iso(NOW - 1000)]);
  await db.query(`INSERT INTO pbk_qa_audit(id,tool_name,passed,skipped,retry_count,created_at)
    VALUES ('qa1','private-tool',false,false,0,$1)`, [iso(NOW - 1000)]);
  await db.query(`INSERT INTO pbk_safety_audit(id,tool_name,blocked,approval_required,created_at)
    VALUES ('safety1','private-tool',true,true,$1)`, [iso(NOW - 1000)]);
  for (const [sourceKind, sourceId] of [['conversation_projection', id], ['qa', 'qa1'], ['safety', 'safety1']]) {
    await run('registered_business', () => record({ sourceKind, sourceId }));
  }
  const snapshot = await collect();
  assert.equal(snapshot.sources.find(s => s.sourceKind === 'qa').counts.failed, 1);
  assert.equal(snapshot.sources.find(s => s.sourceKind === 'safety').rows[0].outcome, 'blocked');
  assert.equal(snapshot.eligible, false);
  await db.exec(`UPDATE conversation_events SET payload='{"changed":true}'`);
  assert.equal((await collect()).sources.find(s => s.sourceKind === 'conversation_projection').counts.unknown, 1);
});

test('whole-source census rejects row/byte overflow instead of trusting old timestamps', async () => {
  await db.query(`INSERT INTO activity_log(id,created_at,updated_at)
    SELECT 'overflow-' || n, $1::timestamptz, $1::timestamptz FROM generate_series(1,10000) n`, [iso(NOW - 10 * DAY)]);
  assert.equal((await collect()).verified, false);
  await db.exec('DELETE FROM activity_log');
  await db.query(`INSERT INTO activity_log(id,text,created_at,updated_at)
    VALUES ('huge',repeat('x',16777217),$1,$1)`, [iso(NOW - 1000)]);
  assert.equal((await collect()).verified, false);
}, 30000);

test('invalid window and reversed observation clocks fail closed without raw error text', async () => {
  assert.equal((await collect({ windowStart: NOW + 1 })).verified, false);
  assert.equal((await collect({ now: NaN, windowEnd: NOW + DAY })).verified, false);
  let ticks = 0;
  assert.equal((await run('operator_chat', () => record({ now: () => NOW - ticks++ }))).verified, false);
  const result = await collect({ client: { query: async () => { throw Error('private database URL'); } } });
  assert.equal(result.verified, false);
  assert.equal(JSON.stringify(result).includes('private database URL'), false);
});

test('late client acquisition releases once and never begins or commits after timeout', async () => {
  jest.useFakeTimers();
  try {
    const statements = [], releases = [];
    const late = { query: async config => { statements.push(config.text || config); return { rows: [] }; },
      release: destroy => releases.push(destroy) };
    const result = run('operator_chat', () => record({ pool: { connect: () => new Promise(resolve => setTimeout(() => resolve(late), 31000)) } }));
    await jest.advanceTimersByTimeAsync(30001);
    assert.equal((await result).verified, false);
    await jest.advanceTimersByTimeAsync(2000);
    assert.deepEqual(statements, []);
    assert.deepEqual(releases, [true]);
  } finally { jest.useRealTimers(); }
});

test('a timed-out transaction destroys its client without queuing a late COMMIT', async () => {
  jest.useFakeTimers();
  try {
    const statements = [], releases = [];
    const result = run('operator_chat', () => record({ pool: { connect: async () => ({
      query: async config => {
        const sql = config.text || config; statements.push(sql);
        if (sql.startsWith('BEGIN')) return { rows: [] };
        return new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 31000));
      }, release: destroy => releases.push(destroy),
    }) } }));
    await jest.advanceTimersByTimeAsync(30001);
    assert.equal((await result).verified, false);
    await jest.advanceTimersByTimeAsync(31000);
    assert.equal(statements.some(sql => sql === 'COMMIT'), false);
    assert.deepEqual(releases, [true]);
  } finally { jest.useRealTimers(); }
});

test('controlled retries never persist or return an existing organic receipt as their own', async () => {
  await run('operator_chat', () => record());
  const writes = [];
  const guardedPool = { connect: async () => ({ release() {}, query: (config, values) => {
    if (/INSERT INTO public.pbk_eval_runs/.test(config.text || config)
      && JSON.parse(config.values[2]).recordRef) writes.push(config);
    return client.query(config, values);
  } }) };
  const result = await controlledExecution.run({}, () => run('operator_chat', () => record({ pool: guardedPool })));
  assert.equal(result.verified, false);
  assert.equal(writes.length, 0);
});

test('receipt write/readback failures remain gaps without changing the business row', async () => {
  const before = (await db.query('SELECT * FROM activity_log')).rows;
  for (const failReadback of [false, true]) {
    freshSecret();
    await db.exec('TRUNCATE pbk_eval_runs');
    const brokenPool = { connect: async () => ({ release() {}, query: (config, values) => {
      const sql = config.text || config;
      if (!failReadback && /INSERT INTO public.pbk_eval_runs/.test(sql)) throw Error('private persistence failure');
      if (failReadback && /FROM public.pbk_eval_runs WHERE id/.test(sql)) return { rows: [] };
      return client.query(config, values);
    } }) };
    assert.equal((await run('operator_chat', () => record({ pool: brokenPool }))).verified, false);
    assert.deepEqual((await db.query('SELECT * FROM activity_log')).rows, before);
    const stored = (await db.query('SELECT * FROM pbk_eval_runs')).rows;
    assert.equal(stored.some(row => row.report.recordRef), false);
    if (failReadback) assert.ok(stored[0].report.admission, 'committed pending survives receipt readback failure');
    else assert.equal(stored.length, 0, 'no source inspection is allowed when admission persistence failed');
  }
});

test('unknown observation failure rolls back monitoring writes and does not claim a verified census', async () => {
  const brokenClient = { query: (config, values) => {
    if (/INSERT INTO public.pbk_eval_runs/.test(config.text || config)) throw Error('private observation failure');
    return client.query(config, values);
  } };
  assert.equal((await collect({ client: brokenClient })).verified, false);
  assert.equal((await db.query('SELECT * FROM pbk_eval_runs')).rows.length, 0);
});

test('signed receipt namespace, envelope time and excessive reports are not trusted', async () => {
  for (const mutation of [
    `UPDATE pbk_eval_runs SET suite_name='timing_suite'`,
    `UPDATE pbk_eval_runs SET source='server:operational-audit:v1'`,
    `UPDATE pbk_eval_runs SET ok=true,passed=1`,
    `UPDATE pbk_eval_runs SET created_at=created_at + interval '1 second'`,
    `UPDATE pbk_eval_runs SET report=report || jsonb_build_object('extra',repeat('x',8193))`,
  ]) {
    freshSecret();
    await db.exec('TRUNCATE pbk_eval_runs');
    await run('operator_chat', () => record());
    await db.exec(mutation);
    const snapshot = await collect();
    assert.equal(snapshot.eligible, false);
    assert.equal(snapshot.sources?.find(s => s.sourceKind === 'runtime_archive').counts.operational ?? 0, 0);
  }
});

test('revision rollover does not accumulate permanent stale proof or refresh unchanged unknown observations', async () => {
  await collect();
  const next = { revision: 'b'.repeat(40), now: NOW + DAY, windowStart: NOW, windowEnd: NOW + DAY };
  let snapshot = await collect(next);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW));
  snapshot = await collect(next);
  assert.equal(snapshot.invalidReceipts, 0);
  assert.equal((await db.query('SELECT * FROM pbk_eval_runs')).rows.length, 2);
});

test('an abandoned monitoring insert is rolled back by client destruction, never late committed', async () => {
  jest.useFakeTimers();
  try {
    const statements = [], releases = [];
    const slowPool = { connect: async () => ({ query: config => {
      statements.push(config.text);
      if (/INSERT INTO public.pbk_eval_runs/.test(config.text)) {
        return new Promise(resolve => setTimeout(() => resolve({ rowCount: 1, rows: [] }), 31000));
      }
      return client.query(config);
    }, release: destroy => { releases.push(destroy); if (destroy) void db.query('ROLLBACK'); } }) };
    const result = run('operator_chat', () => record({ pool: slowPool }));
    // Allow the real in-memory SQL work to settle before advancing the deadline.
    for (let i = 0; i < 100 && !statements.some(sql => /INSERT INTO/.test(sql)); i++) {
      await jest.advanceTimersByTimeAsync(1);
    }
    await jest.advanceTimersByTimeAsync(30001);
    assert.equal((await result).verified, false);
    await jest.advanceTimersByTimeAsync(31000);
    assert.equal(statements.includes('COMMIT'), false);
    assert.deepEqual(releases, [true]);
  } finally { jest.useRealTimers(); }
});

test('observation clocks cannot reverse after collection even when still later than start', async () => {
  for (const operation of [record, collect]) {
    freshSecret();
    await db.exec('TRUNCATE pbk_eval_runs');
    const ticks = [NOW, NOW + 2, NOW + 1];
    const result = await run('operator_chat', () => operation({ now: () => ticks.shift() ?? NOW + 1 }));
    assert.equal(result.verified, false);
  }
});

test('new unknown observations after a historical window cannot silently qualify that window', async () => {
  await run('operator_chat', () => record({ now: NOW - 500 }));
  await db.query(`INSERT INTO activity_log(id,created_at,updated_at)
    VALUES ('late-backdated',$1,$1)`, [iso(NOW - 10 * DAY)]);
  const snapshot = await collect({ windowEnd: NOW - 1 });
  assert.equal(snapshot.eligible, false);
  assert.equal(source(snapshot).counts.lateUnknown, 1);
});

test('incomplete census, unavailable schema and nonnumeric bounds never qualify', async () => {
  for (const fault of ['count', 'rows', 'schema']) {
    freshSecret();
    await db.exec('TRUNCATE pbk_eval_runs');
    const faulty = { query: (config, values) => {
      if (config.text.includes('FROM public.activity_log')) {
        if (fault === 'schema') throw Error('private missing schema');
        if (fault === 'count' && config.text.includes('COUNT(*)')) return { rows: [{ count: 'not-a-number', bytes: 0 }] };
        if (fault === 'rows' && !config.text.includes('COUNT(*)')) return { rows: [] };
      }
      return client.query(config, values);
    } };
    assert.equal((await collect({ client: faulty })).verified, false);
  }
});

test('unchanged invalid clocks never refresh first observation just because wall time catches up', async () => {
  await db.query('UPDATE activity_log SET updated_at=$1', [iso(NOW + 1000)]);
  const first = source(await collect()).rows[0];
  assert.equal(first.clockValid, false);
  const snapshot = await collect({ now: NOW + DAY, windowStart: NOW, windowEnd: NOW + DAY });
  assert.equal(source(snapshot).rows[0].observedAt, first.observedAt);
  assert.equal(source(snapshot).rows[0].clockValid, false);
  assert.equal(snapshot.eligible, false);
});

test('trusted controlled failures remain explicit and never count as completed organic work', async () => {
  await db.exec(`UPDATE activity_log SET status='error',source='runtime-event:controlled-qualification'`);
  await controlledExecution.run({}, () => record());
  const snapshot = await collect();
  assert.equal(source(snapshot).counts.controlled, 1);
  assert.equal(source(snapshot).counts.failed, 1);
  assert.equal(source(snapshot).counts.eligible, 0);
  assert.equal(snapshot.eligible, false);
});

test('a throwing release hook cannot turn missing monitoring proof into a business exception', async () => {
  const brokenPool = { connect: async () => ({
    query() { throw Error('private failed query'); }, release() { throw Error('private release failure'); },
  }) };
  const result = await run('operator_chat', () => record({ pool: brokenPool }));
  assert.equal(result.verified, false);
});

test('coverage windows cannot exceed the approved day and outcome aggregates retain non-completions', async () => {
  assert.equal((await collect({ windowStart: NOW - DAY - 1 })).verified, false);
  await db.exec(`UPDATE activity_log SET status='warning'`);
  await run('runtime_circuit', () => record());
  const snapshot = await collect();
  assert.equal(source(snapshot).counts.warning, 1);
  assert.equal(source(snapshot).counts.success, 0);
  assert.equal(source(snapshot).counts.eligible, 0);
});

test('recorded failure followed by recorded success between samples retains the active failure', async () => {
  await db.exec(`UPDATE activity_log SET status='error'`);
  await run('operator_chat', () => record());
  await db.exec(`UPDATE activity_log SET status='success'`);
  await run('operator_chat', () => record({ now: NOW + 1 }));
  const snapshot = await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 });
  assert.equal(source(snapshot).rows[0].outcome, 'success');
  assert.equal(source(snapshot).counts.failed, 1);
  assert.equal(source(snapshot).history[0].outcome, 'failed');
  assert.equal(snapshot.eligible, false);
});

test('an observed tombstone survives recorded reappearance before the next sample', async () => {
  await run('operator_chat', () => record());
  await db.exec('DELETE FROM activity_log');
  await collect();
  await db.query(`INSERT INTO activity_log(id,created_at,updated_at) VALUES ('private-source-id',$1,$1)`, [iso(NOW - 1000)]);
  await run('operator_chat', () => record({ now: NOW + 1 }));
  const snapshot = await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 });
  assert.equal(source(snapshot).rows[0].presence, 'present');
  assert.equal(source(snapshot).history.some(row => row.presence === 'deleted'), true);
  assert.equal(source(snapshot).counts.unknown, 1);
  assert.equal(snapshot.eligible, false);
});

test('observed mutation and reversion retain separate transitions and unchanged anchors', async () => {
  const initial = source(await collect()).rows[0];
  await db.exec(`UPDATE activity_log SET text='private mutation'`);
  await collect({ now: NOW + 1, windowStart: NOW - 10000, windowEnd: NOW + 1 });
  await db.exec(`UPDATE activity_log SET text='private seller answer'`);
  let snapshot = await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 });
  assert.equal(source(snapshot).history.length, 2);
  assert.equal(source(snapshot).rows[0].sequence, 3);
  assert.equal(source(snapshot).rows[0].sourceBinding, initial.sourceBinding);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 2));
  snapshot = await collect({ now: NOW + 3, windowStart: NOW - 10000, windowEnd: NOW + 3 });
  assert.equal(source(snapshot).history.length, 2);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 2));
});

test('deleting an identity proof or rolling back its history breaks authenticated inventory completeness', async () => {
  await db.exec(`UPDATE activity_log SET status='error'`);
  await run('operator_chat', () => record());
  const old = (await db.query(`SELECT * FROM pbk_eval_runs WHERE report->>'recordRef' IS NOT NULL`)).rows[0];
  await db.exec(`UPDATE activity_log SET status='success'`);
  await run('operator_chat', () => record({ now: NOW + 1 }));
  assert.equal((await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 })).verified, true);
  await db.query('UPDATE pbk_eval_runs SET report=$1::jsonb,created_at=$2 WHERE id=$3',
    [JSON.stringify(old.report), old.created_at, old.id]);
  assert.equal((await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 })).verified, false);
  await db.query('DELETE FROM pbk_eval_runs WHERE id=$1', [old.id]);
  assert.equal((await collect({ now: NOW + 2, windowStart: NOW - 10000, windowEnd: NOW + 2 })).verified, false);
});

test('active history overflow is unverified without discarding earlier transitions', async () => {
  let overflow = false;
  for (let n = 0; n < 40; n++) {
    await db.query('UPDATE activity_log SET text=$1', [`private transition ${n}`]);
    const result = await run('operator_chat', () => record({ now: NOW + n }));
    if (!result.verified) { overflow = true; break; }
  }
  assert.equal(overflow, true);
  const stored = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'recordRef' IS NOT NULL`)).rows;
  assert.equal(stored.length, 1);
  assert.ok(stored[0].report.history.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(stored[0].report)) <= 8192);
  assert.equal((await collect({ now: NOW + 100, windowStart: NOW - 10000, windowEnd: NOW + 100 })).verified, false);
});

function inheritedFence(extra = {}) {
  return { deadlineAt: performance.now() + 15000, signal: new AbortController().signal,
    onAbort() {}, ...extra };
}
const collectInTransaction = (extra = {}) => api('collectRuntimeSourceSnapshotInTransaction')({
  client, secret, revision, windowStart: NOW - DAY, windowEnd: NOW, now: NOW,
  fence: inheritedFence(), ...extra,
});
async function prepare(extra = {}) {
  const fence = extra.fence || inheritedFence();
  const prepared = await api('prepareRuntimeSourceObservation')({ client, secret, revision, now: NOW, ...extra, fence });
  assert.equal(prepared.verified, true);
  return { admission: prepared.admission, fence };
}

test('transaction-aware core leaves all writes pending in the actual caller PGlite transaction', async () => {
  const sql = [];
  const trackedClient = { query: config => { sql.push(config); return client.query(config); } };
  const prepared = await prepare();
  await db.query('BEGIN');
  try {
    const result = await collectInTransaction({ ...prepared, client: trackedClient });
    assert.equal(result.verified, true);
    assert.equal(result.transactionPending, true);
    assert.equal(sql.some(c => /^(BEGIN|COMMIT|ROLLBACK)/.test(c.text)), false);
    assert.ok(sql.every(c => c.query_timeout > 0 && c.query_timeout <= 2000));
    assert.ok((await db.query('SELECT * FROM pbk_eval_runs')).rows.length > 0);
  } finally { await db.query('ROLLBACK'); }
  const stored = (await db.query('SELECT * FROM pbk_eval_runs')).rows;
  assert.equal(stored.length, 1);
  assert.ok(stored[0].report.admission, 'outer rollback cannot undo precommitted pending admission');
});

test('inherited cancellation of a deferred read fences continuation instead of merely racing it', async () => {
  const abort = new AbortController(), sql = [], aborted = [];
  let resume, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { resume = resolve; });
  const trackedClient = { query: async config => {
    sql.push(config.text);
    if (config.text.includes('FROM public.activity_log')) { entered(); await paused; }
    return client.query(config);
  } };
  const prepared = await prepare({ fence: inheritedFence({ signal: abort.signal, onAbort: () => aborted.push(true) }) });
  await db.query('BEGIN');
  try {
    const work = collectInTransaction({ ...prepared, client: trackedClient });
    await enteredPromise;
    abort.abort();
    const result = await work;
    assert.equal(result.verified, false);
    resume();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sql.some(s => /INSERT|COMMIT|ROLLBACK|^BEGIN/.test(s)), false);
    assert.deepEqual(aborted, [true]);
  } finally { resume(); await db.query('ROLLBACK'); }
  assert.ok((await db.query('SELECT * FROM pbk_eval_runs')).rows[0].report.admission);
});

test('expired inherited deadline never submits SQL and deferred query timeout is at most two seconds', async () => {
  const sql = [], aborted = [];
  const expired = await collectInTransaction({ client: { query: config => { sql.push(config); } },
    fence: inheritedFence({ deadlineAt: performance.now() - 1, onAbort: () => aborted.push(true) }) });
  assert.equal(expired.verified, false);
  assert.equal(sql.length, 0);
  assert.deepEqual(aborted, [true]);
  const prepared = await prepare();
  jest.useFakeTimers();
  try {
    let resume;
    const delayed = new Promise(resolve => { resume = resolve; });
    const work = collectInTransaction({ admission: prepared.admission, client: { query: config => { sql.push(config); return delayed; } },
      fence: inheritedFence() });
    await jest.advanceTimersByTimeAsync(2001);
    assert.equal((await work).verified, false);
    resume({ rows: [] });
    await jest.advanceTimersByTimeAsync(15000);
    assert.equal(sql.length, 1);
    assert.ok(sql[0].query_timeout <= 2000);
  } finally { jest.useRealTimers(); }
});

test('cancellation after an actual pending insert prevents readback/commit and caller rollback removes it', async () => {
  const abort = new AbortController(), sql = [];
  let resume, entered, poisoned = false;
  const pending = new Promise(resolve => { resume = resolve; });
  const inserted = new Promise(resolve => { entered = resolve; });
  const tracked = { query: async config => {
    sql.push(config.text);
    const result = await client.query(config);
    if (/INSERT INTO public.pbk_eval_runs/.test(config.text)) { entered(); await pending; }
    return result;
  } };
  const prepared = await prepare({ fence: inheritedFence({ signal: abort.signal, onAbort: () => { poisoned = true; } }) });
  await db.query('BEGIN');
  try {
    const work = collectInTransaction({ ...prepared, client: tracked });
    await inserted;
    assert.ok((await db.query('SELECT * FROM pbk_eval_runs')).rows.length > 0);
    const beforeAbort = sql.length;
    abort.abort();
    assert.equal((await work).verified, false);
    assert.equal(poisoned, true);
    await db.query('ROLLBACK');
    resume();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sql.length, beforeAbort, 'no readback, inventory write or commit can follow the abandoned insert');
    const stored = (await db.query('SELECT * FROM pbk_eval_runs')).rows;
    assert.equal(stored.length, 1);
    assert.ok(stored[0].report.admission);
  } finally { resume(); await db.query('ROLLBACK'); }
});

test('expired history is compacted without refreshing current first observation or pretending old windows are complete', async () => {
  await db.exec(`UPDATE activity_log SET updated_at=NULL`);
  await collect();
  await db.query('UPDATE activity_log SET updated_at=$1', [iso(NOW - 1000)]);
  await run('operator_chat', () => record({ now: NOW + 1 }));
  const later = { now: NOW + 3 * DAY, windowStart: NOW + 2 * DAY, windowEnd: NOW + 3 * DAY };
  const snapshot = await collect(later);
  assert.equal(snapshot.verified, true);
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW + 1));
  assert.equal(source(snapshot).history.length, 0);
  assert.equal(source(snapshot).counts.invalidClock, 0);
  assert.equal((await collect({ ...later, windowStart: NOW, windowEnd: NOW + DAY })).verified, false);
});

test('removing only the signed inventory cannot turn retained source histories into a complete census', async () => {
  await run('operator_chat', () => record());
  await db.exec(`DELETE FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`);
  assert.equal((await collect()).verified, false);
});

test('the inherited deadline is shared across queries rather than renewed per query', async () => {
  const prepared = await prepare();
  jest.useFakeTimers();
  try {
    const statements = [], aborted = [];
    const client = { query: config => {
      statements.push(config);
      return new Promise(resolve => setTimeout(() => resolve({ rows: [{ acquired: true }] }), 600));
    } };
    const work = collectInTransaction({ admission: prepared.admission, client,
      fence: inheritedFence({ deadlineAt: performance.now() + 1000, onAbort: () => aborted.push(true) }) });
    await jest.advanceTimersByTimeAsync(1001);
    assert.equal((await work).verified, false);
    await jest.advanceTimersByTimeAsync(3000);
    assert.equal(statements.length, 2);
    assert.ok(statements[0].query_timeout <= 1000);
    assert.ok(statements[1].query_timeout <= 400);
    assert.equal(statements.some(c => /INSERT|COMMIT/.test(c.text)), false);
    assert.deepEqual(aborted, [true]);
  } finally { jest.useRealTimers(); }
});

test('mutating the supplied fence cannot extend the deadline captured by the core', async () => {
  const prepared = await prepare();
  jest.useFakeTimers();
  const abort = new AbortController();
  let work;
  try {
    let settled = false;
    const fence = inheritedFence({ deadlineAt: performance.now() + 1000, signal: abort.signal });
    const client = { query: () => new Promise(resolve =>
      setTimeout(() => resolve({ rows: [{ acquired: true }] }), 600)) };
    work = collectInTransaction({ admission: prepared.admission, client, fence }).then(result => { settled = true; return result; });
    await jest.advanceTimersByTimeAsync(400);
    fence.deadlineAt = performance.now() + 15000;
    await jest.advanceTimersByTimeAsync(601);
    assert.equal(settled, true);
    assert.equal((await work).verified, false);
  } finally {
    abort.abort();
    await jest.advanceTimersByTimeAsync(2000);
    await work;
    jest.useRealTimers();
  }
});

test('inventory readback must detect a history receipt disappearing during persistence', async () => {
  const brokenPool = { connect: async () => ({ release() {}, query: async config => {
    const result = await client.query(config);
    if (/INSERT INTO public.pbk_eval_runs/.test(config.text)
      && config.values[0].startsWith('runtime-source-inventory-')) {
      await db.exec(`DELETE FROM pbk_eval_runs WHERE report->>'recordRef' IS NOT NULL`);
    }
    return result;
  } }) };
  const result = await run('operator_chat', () => record({ pool: brokenPool }));
  assert.equal(result.verified, false);
  const stored = (await db.query('SELECT * FROM pbk_eval_runs')).rows;
  assert.equal(stored.length, 1);
  assert.ok(stored[0].report.admission, 'failed readback rolls back receipts, not the precommitted pending admission');
  assert.equal((await db.query('SELECT * FROM activity_log')).rows.length, 1);
});

test('a still-fresh earlier 24h audit window retains its history after a sample 23h later', async () => {
  await db.query('UPDATE activity_log SET created_at=$1,updated_at=$1', [iso(NOW - 2 * DAY)]);
  await run('diagnostic', () => record({ now: NOW - 23 * 3600000 }));
  await db.exec(`UPDATE activity_log SET text='private new operational binding'`);
  await run('operator_chat', () => record({ now: NOW - 22 * 3600000 }));
  const original = await collect();
  assert.equal(original.verified, true);
  assert.equal(original.eligible, true);
  assert.equal(source(original).history.length, 1);
  const laterNow = NOW + 23 * 3600000;
  assert.equal((await collect({ now: laterNow, windowStart: laterNow - DAY, windowEnd: laterNow })).verified, true);
  const reread = await collect({ now: laterNow });
  assert.equal(reread.verified, true);
  assert.equal(reread.eligible, true);
  assert.equal(source(reread).history.length, 1);
  assert.equal(source(reread).rows[0].observedAt, source(original).rows[0].observedAt);
  assert.equal(reread.fingerprint, original.fingerprint);
});

test('48h retention does not expand the 24h window blockers for superseded invalid-clock history', async () => {
  await db.query('UPDATE activity_log SET created_at=$1,updated_at=NULL', [iso(NOW - 2 * DAY)]);
  const early = NOW - 36 * 3600000;
  assert.equal((await collect({ now: early, windowStart: early - DAY, windowEnd: early })).verified, true);
  await db.query('UPDATE activity_log SET updated_at=$1', [iso(NOW - 2 * DAY)]);
  assert.equal((await run('operator_chat', () => record({ now: NOW - 12 * 3600000 }))).verified, true);
  const snapshot = await collect();
  assert.equal(snapshot.verified, true);
  assert.equal(source(snapshot).history.length, 1, '36h-old evidence remains available for earlier fresh audits');
  assert.equal(source(snapshot).counts.invalidClock, 0, 'superseded evidence outside this window is not a 48h blocker');
  assert.equal(snapshot.eligible, true);
});

async function fillSuccessfulHistory() {
  for (let n = 0; n < 100; n++) {
    await db.query('UPDATE activity_log SET text=$1', [`private successful transition ${n}`]);
    assert.equal((await run('operator_chat', () => record({ now: NOW + n }))).verified, true);
    const r = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'recordRef' IS NOT NULL`)).rows[0].report;
    const { revision, sourceBinding, presence, receiptKind, origin, classification, outcome, clockValid, observedAt, sequence } = r;
    const next = { ...r, outcome: 'failed', observedAt: iso(NOW + 100), sequence: sequence + 1,
      history: [...r.history, { revision, sourceBinding, presence, receiptKind, origin,
        classification, outcome, clockValid, observedAt, sequence }] };
    if (Buffer.byteLength(JSON.stringify(next)) > 8192) {
      return (await db.query('SELECT * FROM activity_log')).rows[0];
    }
  }
  assert.fail('fixture must reach the unchanged 8192-byte report bound');
}

test.each(['recorder', 'standalone'])('overflow followed by exact reversion retains a durable unknown gap: %s', async lane => {
  const last = await fillSuccessfulHistory();
  await db.exec(`UPDATE activity_log SET status='error'`);
  const failure = lane === 'recorder'
    ? await run('operator_chat', () => record({ now: NOW + 100 }))
    : await collect({ now: NOW + 100, windowStart: NOW - 1000, windowEnd: NOW + 100 });
  assert.equal(failure.verified, false);
  await db.query('UPDATE activity_log SET status=$1,text=$2', [last.status, last.text]);
  const result = await collect({ now: NOW + 101, windowStart: NOW - 1000, windowEnd: NOW + 101 });
  assert.equal(result.verified, false, 'rollback must not allow the unchanged-binding shortcut to certify the prior success');
  assert.equal(result.eligible, false);
  const inventory = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report;
  assert.ok(inventory.admission, 'the unknown gap must be authenticated durable state, not a timer or process flag');
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) <= 8192);
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('./runtime-source-evidence.mjs');
    const reread = await fresh.collectRuntimeSourceSnapshot({ client, secret, revision,
      now: NOW + 102, windowStart: NOW - 1000, windowEnd: NOW + 102 });
    assert.equal(reread.verified, false, 'fresh module state must still see the durable gap');
  });
  const resumed = await collect({ now: NOW + 60000, windowStart: NOW + 60000 - DAY, windowEnd: NOW + 60000 });
  assert.equal(resumed.verified, true, 'lease expiry admits a new observation even after the actual overflow repro');
  assert.equal(resumed.eligible, false, 'exact reversion cannot retrospectively cover the lost transition');
  assert.equal(resumed.coverage.intersectingGaps, 1);
  assert.equal(resumed.coverage.gaps[0].classification, 'unknown');
}, 30000);

test('failure to write any later gap/finalization marker cannot clear a separately committed pending admission', async () => {
  const last = await fillSuccessfulHistory();
  let admitted = false;
  const blockedPool = { connect: async () => ({ release() {}, query: async config => {
    if (admitted && /INSERT|UPDATE|DELETE/.test(config.text)) throw Error('private post-admission write outage');
    const result = await client.query(config);
    if (config.text === 'COMMIT') admitted = true;
    return result;
  } }) };
  await db.exec(`UPDATE activity_log SET status='error'`);
  assert.equal((await run('operator_chat', () => record({ pool: blockedPool, now: NOW + 100 }))).verified, false);
  assert.equal(admitted, true);
  await db.query('UPDATE activity_log SET status=$1,text=$2', [last.status, last.text]);
  assert.equal((await collect({ now: NOW + 101, windowStart: NOW - 1000, windowEnd: NOW + 101 })).verified, false);
  assert.ok((await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report.admission);
}, 30000);

test('the transaction-aware core refuses fabricated admissions without observing sources or committing', async () => {
  const sql = [];
  const result = await collectInTransaction({ admission: { tokenRef: 'a'.repeat(64) },
    client: { query: config => { sql.push(config.text); return client.query(config); } } });
  assert.equal(result.verified, false);
  assert.deepEqual(sql, []);
});

test('caller rollback leaves an independently committed admission and a consumed handle cannot be reused', async () => {
  const fence = inheritedFence();
  const prepared = await api('prepareRuntimeSourceObservation')({ client, secret, revision, now: NOW,
    fence });
  assert.equal(prepared.verified, true);
  assert.equal(prepared.transactionPending, false);
  await db.query('BEGIN');
  try {
    const result = await collectInTransaction({ admission: prepared.admission, fence });
    assert.equal(result.verified, true);
    assert.equal(result.transactionPending, true);
  } finally { await db.query('ROLLBACK'); }
  assert.ok((await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report.admission);
  assert.equal((await collectInTransaction({ admission: prepared.admission })).verified, false);
  assert.equal((await collect()).verified, false);
});

test('an admission outage resumes collection with a durable unknown interval instead of permanent disablement', async () => {
  await run('operator_chat', () => record());
  await db.exec(`UPDATE activity_log SET status='error'`);
  const inspected = [];
  const unavailable = { connect: async () => ({ release() {}, query: config => {
    if (/FROM public.activity_log/.test(config.text)) inspected.push(config.text);
    if (/INSERT INTO public.pbk_eval_runs/.test(config.text)) throw Error('private admission outage');
    return client.query(config);
  } }) };
  assert.equal((await run('operator_chat', () => record({ pool: unavailable }))).verified, false);
  assert.deepEqual(inspected, [], 'source observations require a committed admission first');
  await db.exec(`UPDATE activity_log SET status='success'`);
  const recoveredClient = { query: config => {
    if (/FROM public.activity_log/.test(config.text)) inspected.push(config.text);
    return client.query(config);
  } };
  const recovered = await collect({ client: recoveredClient });
  assert.equal(recovered.verified, true);
  assert.equal(recovered.eligible, false);
  assert.ok(inspected.length > 0, 'new collection can inspect current state without retrospectively covering the outage');
  assert.equal(recovered.coverage.intersectingGaps, 1);
  assert.equal(recovered.coverage.gaps[0].reason, 'storage_unverified');
  assert.equal((await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report.admission, null);
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('./runtime-source-evidence.mjs');
    const reread = await fresh.collectRuntimeSourceSnapshot({ client, secret, revision,
      now: NOW, windowStart: NOW - DAY, windowEnd: NOW });
    assert.equal(reread.verified, true);
    assert.equal(reread.eligible, false);
    assert.equal(reread.coverage.intersectingGaps, 1);
  });
});

test('only the owner can settle a committed admission, and its original deadline cannot be renewed', async () => {
  const prepared = await prepare();
  const extended = inheritedFence({ deadlineAt: prepared.fence.deadlineAt + 1 });
  assert.equal((await collectInTransaction({ admission: prepared.admission, fence: extended })).verified, false);
  assert.ok((await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report.admission);
  const sql = [];
  const copied = { ...prepared.admission };
  assert.equal((await collectInTransaction({ admission: copied, fence: prepared.fence,
    client: { query: config => { sql.push(config.text); return client.query(config); } } })).verified, false);
  assert.deepEqual(sql, []);
});

test('a branded handle is insufficient if its durable admission disappears before source inspection', async () => {
  const prepared = await prepare();
  await db.exec('DELETE FROM pbk_eval_runs');
  const sql = [];
  await db.query('BEGIN');
  try {
    const result = await collectInTransaction({ ...prepared,
      client: { query: config => { sql.push(config.text); return client.query(config); } } });
    assert.equal(result.verified, false);
    assert.equal(sql.some(text => /FROM public.activity_log/.test(text)), false);
    assert.equal(sql.some(text => /INSERT|COMMIT/.test(text)), false);
  } finally { await db.query('ROLLBACK'); }
});

test('a second real client contends without poisoning the healthy prepared owner', async () => {
  const a = { query: config => client.query(config) };
  const bSql = [], releases = [];
  const b = { query: config => { bSql.push(config.text); return client.query(config); }, release: flag => releases.push(flag) };
  const fence = inheritedFence();
  const owner = await api('prepareRuntimeSourceObservation')({ client: a, secret, revision, now: NOW, fence });
  assert.equal(owner.verified, true);
  const bAborts = [];
  const competingPreparation = await api('prepareRuntimeSourceObservation')({ client: b, secret, revision, now: NOW,
    fence: inheritedFence({ onAbort: () => bAborts.push(true) }) });
  assert.equal(competingPreparation.result, 'source_observation_busy');
  assert.deepEqual(bAborts, [], 'a busy preparation does not abandon an owner or destroy a healthy client');
  const competing = await run('operator_chat', () => record({ pool: { connect: async () => b } }));
  assert.equal(bSql.some(sql => /FROM public.activity_log/.test(sql)), false);
  await db.query('BEGIN');
  try {
    const result = await collectInTransaction({ client: a, admission: owner.admission, fence });
    assert.equal(result.verified, true, 'contention is not monitoring abandonment and must not poison A');
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  assert.equal(competing.result, 'source_observation_busy');
  assert.deepEqual(releases, [false]);
  const inventory = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report;
  assert.equal(inventory.admission, null);
  assert.deepEqual(inventory.gaps, []);
});

test('abandoned observation permits new forward work without retrospectively covering its signed gap', async () => {
  await run('operator_chat', () => record());
  const original = (await db.query('SELECT * FROM activity_log')).rows[0];
  const prepared = await prepare({ now: NOW + 1 });
  await db.exec(`UPDATE activity_log SET status='error'`);
  await db.query('BEGIN');
  try {
    const failed = await collectInTransaction({ ...prepared, now: NOW + 1, windowStart: NOW - 1000, windowEnd: NOW + 1,
      client: { query: config => {
        if (/INSERT INTO public.pbk_eval_runs/.test(config.text)) throw Error('private lost observation');
        return client.query(config);
      } } });
    assert.equal(failed.verified, false);
  } finally { await db.query('ROLLBACK'); }
  await db.query('UPDATE activity_log SET status=$1,text=$2', [original.status, original.text]);
  const resume = NOW + 60000;
  const snapshot = await collect({ now: resume, windowStart: resume - DAY, windowEnd: resume });
  assert.equal(snapshot.verified, true, 'a gap must not disable all later collection');
  assert.equal(snapshot.eligible, false);
  assert.equal(snapshot.coverage.intersectingGaps, 1);
  assert.equal(snapshot.coverage.gaps[0].classification, 'unknown');
  assert.equal(snapshot.coverage.gaps[0].startedAt, iso(NOW + 1));
  assert.equal(snapshot.coverage.gaps[0].endedAt, iso(resume));
  assert.equal(snapshot.coverage.forwardOnlyFrom, iso(resume));
  assert.equal(source(snapshot).rows[0].observedAt, iso(NOW), 'exact reversion does not refresh the old anchor');
  assert.equal(source(snapshot).counts.failed, 0, 'an unknown observation gap is not an invented business failure');
  await db.exec(`UPDATE activity_log SET text='private genuinely new forward business'`);
  assert.equal((await run('operator_chat', () => record({ now: resume + 1 }))).verified, true);
  const covered = await collect({ now: resume + 2, windowStart: resume - DAY + 2, windowEnd: resume + 2 });
  assert.equal(covered.verified, true);
  assert.equal(covered.eligible, false, 'new success cannot bridge a window that intersects the gap');
  const future = resume + DAY + 10;
  await db.exec(`UPDATE activity_log SET text='private future business'`);
  assert.equal((await run('operator_chat', () => record({ now: future }))).verified, true);
  const healthy = await collect({ now: future, windowStart: future - DAY, windowEnd: future });
  assert.equal(healthy.verified, true);
  assert.equal(healthy.eligible, true);
  assert.equal(healthy.coverage.intersectingGaps, 0);
  assert.equal(healthy.coverage.gaps.length, 1, 'the gap remains available to earlier still-fresh audits');
});

test('an expired old owner cannot read sources or settle a fresh owner admission', async () => {
  const a = { query: config => client.query(config) }, b = { query: config => client.query(config) };
  const oldFence = inheritedFence();
  const old = await api('prepareRuntimeSourceObservation')({ client: a, secret, revision, now: NOW, fence: oldFence });
  const newFence = inheritedFence();
  const fresh = await api('prepareRuntimeSourceObservation')({ client: b, secret, revision,
    now: NOW + 60000, fence: newFence });
  assert.equal(fresh.verified, true);
  const sql = [];
  await db.query('BEGIN');
  try {
    const late = await collectInTransaction({ admission: old.admission, fence: oldFence, now: NOW + 60000,
      windowStart: NOW - 1000, windowEnd: NOW + 60000,
      client: { query: config => { sql.push(config.text); return client.query(config); } } });
    assert.equal(late.verified, false);
    assert.equal(sql.some(text => /FROM public.activity_log|INSERT|COMMIT/.test(text)), false);
  } finally { await db.query('ROLLBACK'); }
  await db.query('BEGIN');
  try {
    const result = await collectInTransaction({ client: b, admission: fresh.admission, fence: newFence,
      now: NOW + 60000, windowStart: NOW - 1000, windowEnd: NOW + 60000 });
    assert.equal(result.verified, true);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
});

test('signed gaps survive earlier cutoffs for 48h and pruned windows never regain retrospective credit', async () => {
  await run('operator_chat', () => record());
  await prepare({ now: NOW + 1 });
  const resumed = NOW + 60000;
  assert.equal((await collect({ now: resumed, windowStart: resumed - DAY, windowEnd: resumed })).verified, true);
  const boundary = resumed + 2 * DAY;
  const earlier = await collect({ now: boundary, windowStart: resumed, windowEnd: resumed + DAY });
  assert.equal(earlier.verified, true);
  assert.equal(earlier.eligible, false);
  assert.equal(earlier.coverage.intersectingGaps, 1);
  assert.equal(earlier.coverage.gaps[0].endedAt, iso(resumed));
  const later = await collect({ now: boundary + 1, windowStart: resumed + DAY + 1, windowEnd: boundary + 1 });
  assert.equal(later.verified, true);
  assert.equal(later.coverage.gaps.length, 0);
  assert.equal(later.coverage.gapFloor, iso(resumed + 1));
  assert.equal((await collect({ now: boundary + 1, windowStart: resumed, windowEnd: resumed + DAY })).verified, false);
});

test('fresh process state and a new revision can collect after lease abandonment while retaining the gap', async () => {
  await prepare();
  await jest.isolateModulesAsync(async () => {
    const fresh = await import('./runtime-source-evidence.mjs');
    const nextRevision = 'b'.repeat(40), resume = NOW + 60000;
    const snapshot = await fresh.collectRuntimeSourceSnapshot({ client, secret, revision: nextRevision,
      now: resume, windowStart: resume - DAY, windowEnd: resume });
    assert.equal(snapshot.verified, true);
    assert.equal(snapshot.eligible, false);
    assert.equal(snapshot.coverage.intersectingGaps, 1);
    assert.equal(snapshot.coverage.forwardOnlyFrom, iso(resume));
    const next = await fresh.collectRuntimeSourceSnapshot({ client, secret, revision: nextRevision,
      now: resume + 1, windowStart: resume - DAY + 1, windowEnd: resume + 1 });
    assert.equal(next.verified, true);
    assert.equal(next.coverage.segmentRef, snapshot.coverage.segmentRef);
    assert.equal(next.coverage.gaps.length, 1, 'successful new collection does not erase or duplicate the old gap');
  });
});

test('active gap-history overflow fails closed and cannot trim gaps to fit the inventory report', async () => {
  let now = NOW, last, overflow = false;
  for (let n = 0; n < 80; n++) {
    const result = await api('prepareRuntimeSourceObservation')({ client, secret, revision, now, fence: inheritedFence() });
    if (!result.verified) { overflow = true; break; }
    last = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report;
    now += 60000;
  }
  assert.equal(overflow, true);
  const stored = (await db.query(`SELECT report FROM pbk_eval_runs WHERE report->>'ledgerKind'='inventory'`)).rows[0].report;
  assert.deepEqual(stored.gaps, last.gaps);
  assert.deepEqual(stored.admission, last.admission);
  assert.ok(stored.gaps.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= 8192);
  const future = now + 3 * DAY;
  const resumed = await collect({ now: future, windowStart: future - DAY, windowEnd: future });
  assert.equal(resumed.verified, true, 'expiry of old history may permit a bounded new forward segment');
  assert.equal(resumed.eligible, false);
  assert.equal(resumed.coverage.gaps.length, 1);
  assert.equal(resumed.coverage.intersectingGaps, 1, 'the abandoned interval through the new start is not lost');
}, 30000);
