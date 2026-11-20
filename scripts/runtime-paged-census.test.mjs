import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, test, jest } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';

let census = {};
try { census = await import('./runtime-paged-census.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const revision = 'a'.repeat(40), secret = 'local-paged-census-test-material';
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const api = name => {
  assert.equal(typeof census[name], 'function', `${name} must implement bounded authenticated census`);
  return census[name];
};
let db, client, now, fence, calls;
jest.setTimeout(120000);
const newFence = () => {
  const controller = new AbortController();
  return { deadlineAt: performance.now() + 15000, signal: controller.signal,
    onAbort: () => controller.abort() };
};
const input = extra => ({ client, secret, revision, now: () => now, fence, ...extra });
const prepare = extra => api('preparePagedCensusObservation')(input(extra));
async function insert(id, text = '') {
  await db.query(`INSERT INTO activity_log(id,workspace_id,source,status,category,text,metadata,created_at,updated_at)
    VALUES ($1,'pbk','runtime-event:fixture','success','EVENT',$2,'{}',$3,$3)`, [id, text, new Date(NOW).toISOString()]);
}
async function closeBaseline(limit = 100) {
  for (let n = 0; n < limit; n++) {
    fence = newFence();
    const result = await prepare();
    if (result.verified) return result;
    assert.equal(result.result, 'paged_census_incomplete', JSON.stringify({ result, last: calls.slice(-3) }));
    assert.equal(result.transactionPending, false);
    assert.equal(result.coverage, undefined);
  }
  assert.fail('baseline did not close');
}
async function snapshot(admission, extra = {}) {
  await client.query({ text: 'BEGIN ISOLATION LEVEL REPEATABLE READ' });
  try {
    const result = await api('collectPagedCensusSnapshotInTransaction')(input({ admission,
      windowStart: now, windowEnd: now, ...extra }));
    assert.equal(result.verified, true, JSON.stringify(result));
    await client.query({ text: 'COMMIT' });
    return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const readback = inventory => api('readPagedCensusInventory')(input({ inventory }));

beforeAll(async () => { if (census.preparePagedCensusObservation) db = new PGlite(); });
beforeEach(async () => {
  now = NOW; calls = [];
  if (!census.preparePagedCensusObservation) return;
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.exec(`
    CREATE TABLE activity_log(id text PRIMARY KEY,workspace_id text,source text,status text,category text,
      text text,metadata jsonb,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE conversation_events(id uuid PRIMARY KEY,workspace_id text,source_table text,source_id text,
      event_type text,channel text,direction text,status text,body text,payload jsonb,
      created_at timestamptz,updated_at timestamptz,occurred_at timestamptz);
    CREATE TABLE pbk_qa_audit(id text PRIMARY KEY,tenant_id text,tool_name text,passed boolean,skipped boolean,
      reason text,validator text,retry_count int,params jsonb,result jsonb,qa jsonb,source text,created_at timestamptz);
    CREATE TABLE pbk_safety_audit(id text PRIMARY KEY,tenant_id text,tool_name text,blocked boolean,
      approval_required boolean,params jsonb,validation jsonb,source text,created_at timestamptz);
  `);
  await db.exec(await readFile(new URL('./migrations/20261117-bounded-census.sql', import.meta.url), 'utf8'));
  client = { async query(config) {
    calls.push(config);
    try { return await db.query(config.text, config.values); }
    catch (error) { calls.push({ error: error.message }); throw error; }
  } };
  fence = newFence();
});
afterAll(async () => { await db?.close(); });

test('exports the four local paged-v2 APIs', () => {
  for (const name of ['preparePagedCensusObservation', 'collectPagedCensusSnapshotInTransaction',
    'readPagedCensusIntervalRoots', 'readPagedCensusInventory']) api(name);
});

test('bootstrap is resumable, opaque, bounded and never claims prior coverage or organic work', async () => {
  api('preparePagedCensusObservation');
  for (let i = 0; i < 150; i++) await insert(`private-seller-${i}`, 'private-body');
  const first = await prepare();
  assert.equal(first.verified, false); assert.equal(first.result, 'paged_census_incomplete');
  assert.ok(first.progress); assert.equal(first.coverage, undefined);
  const admitted = await closeBaseline();
  const observed = await snapshot(admitted.admission);
  assert.equal(observed.protocol, 'paged-v2'); assert.equal(observed.invalidReceipts, 0);
  assert.equal(observed.inventory.receiptCount, 150);
  assert.equal(observed.coverage.forwardOnlyFrom, new Date(NOW).toISOString());
  const source = observed.sources.find(s => s.sourceKind === 'runtime_archive');
  assert.equal(source.counts.present, 150); assert.equal(source.counts.inventoryUnknown, 150);
  assert.equal(source.counts.unknown, 0); assert.equal(source.counts.inWindow, 0);
  for (const k of ['operational', 'controlled', 'diagnostic', 'eligible']) assert.equal(source.counts[k], 0);
  assert.equal(source.rows, undefined); assert.equal(source.history, undefined);
  assert.deepEqual(await readback(observed.inventory), { verified: true, ...observed.inventory });
  const reports = (await db.query('SELECT report FROM pbk_runtime_census_proofs')).rows;
  assert.ok(reports.length > 1);
  for (const { report } of reports) assert.ok(Buffer.byteLength(JSON.stringify(report)) <= 8192);
  const stored = JSON.stringify(reports);
  assert.ok(!stored.includes('private-seller')); assert.ok(!stored.includes('private-body'));
  assert.ok(!stored.includes(secret));
});

test('catch-up handles insert behind cursor, deletion and primary-key changes', async () => {
  api('preparePagedCensusObservation');
  for (let i = 0; i < 600; i++) await insert(`row-${i}`);
  assert.equal((await prepare()).verified, false);
  const cursor = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report.cursor;
  let behind;
  for (let i = 0; !behind; i++) {
    const id = `behind-${i}`;
    if ((await db.query("SELECT pbk_census_identity('runtime_archive',$1) AS ref", [id])).rows[0].ref < cursor) behind = id;
  }
  await insert(behind);
  await db.query("DELETE FROM activity_log WHERE id='row-1'");
  await db.query("UPDATE activity_log SET id='changed-key',text='changed' WHERE id='row-2'");
  const observed = await snapshot((await closeBaseline()).admission);
  const counts = observed.sources.find(s => s.sourceKind === 'runtime_archive').counts;
  assert.equal(counts.present, 600); assert.ok(counts.deleted >= 2);
  assert.equal(counts.eligible, 0);
});

test('baseline observed-head version prevents older journal entries overwriting newer page state', async () => {
  api('preparePagedCensusObservation');
  await insert('versioned', 'old');
  await db.query("UPDATE activity_log SET text='new' WHERE id='versioned'");
  const observed = await snapshot((await closeBaseline()).admission);
  const projected = (await db.query("SELECT digest FROM pbk_census_page('runtime_archive')")).rows[0].digest;
  const leaf = (await db.query("SELECT report FROM pbk_runtime_census_entries WHERE report::text LIKE '%versioned%'")).rows;
  assert.equal(leaf.length, 0);
  assert.ok((await db.query('SELECT report FROM pbk_runtime_census_entries')).rows.some(r => JSON.stringify(r.report).includes(projected)));
  assert.equal(observed.inventory.receiptCount, 1);
});

test('rollback leaves no committed journal evidence and closure locks the head not max(sequence)', async () => {
  api('preparePagedCensusObservation');
  await db.exec('BEGIN'); await insert('rolled-back'); await db.exec('ROLLBACK');
  const observed = await snapshot((await closeBaseline()).admission);
  assert.equal(observed.inventory.receiptCount, 0);
  assert.ok(calls.some(c => /pbk_runtime_census_head[\s\S]*FOR UPDATE/i.test(c.text)));
  assert.ok(!calls.some(c => /max\s*\(\s*sequence/i.test(c.text)));
});

test('one-use admission rejects substitution and replay', async () => {
  api('preparePagedCensusObservation');
  const admitted = await closeBaseline();
  await snapshot(admitted.admission);
  await db.exec('BEGIN');
  const replay = await api('collectPagedCensusSnapshotInTransaction')(input({ admission: admitted.admission,
    windowStart: now, windowEnd: now }));
  await db.exec('ROLLBACK');
  assert.equal(replay.verified, false);
  await db.exec('BEGIN');
  const fake = await api('collectPagedCensusSnapshotInTransaction')(input({ admission: {}, windowStart: now, windowEnd: now }));
  await db.exec('ROLLBACK'); assert.equal(fake.verified, false);
});

test('signed cursor tampering and revision substitution fail closed', async () => {
  api('preparePagedCensusObservation');
  await prepare();
  await db.query("UPDATE pbk_runtime_census_state SET report=jsonb_set(report,'{cursor}','\"ffffffff\"')");
  fence = newFence(); assert.equal((await prepare()).verified, false);
  const other = 'b'.repeat(40);
  await db.query(`INSERT INTO pbk_runtime_census_state(id,report)
    SELECT $1,report FROM pbk_runtime_census_state LIMIT 1`, [`pbk:paged-v2:${other}`]);
  assert.notEqual((await prepare({ revision: other })).result, 'paged_census_incomplete');
});

test('a legitimate new revision bootstraps a new generation and retains old immutable manifests', async () => {
  api('preparePagedCensusObservation'); await insert('revisioned');
  const old = await snapshot((await closeBaseline()).admission);
  const other = 'b'.repeat(40);
  now += 60000;
  let admitted;
  for (let n = 0; n < 12; n++) {
    fence = newFence();
    const result = await prepare({ revision: other });
    if (result.verified) { admitted = result; break; }
    assert.equal(result.result, 'paged_census_incomplete');
  }
  assert.ok(admitted);
  const next = await snapshot(admitted.admission, { revision: other });
  assert.notEqual(next.inventory.generation, old.inventory.generation);
  assert.equal(next.coverage.forwardOnlyFrom, new Date(now).toISOString());
  assert.deepEqual(await readback(old.inventory), { verified: true, ...old.inventory });
});

test('authenticated journal activity populates interval diagnostics without promoting organic success', async () => {
  api('preparePagedCensusObservation'); await insert('activity');
  await snapshot((await closeBaseline()).admission);
  now += 60000; fence = newFence();
  await db.query("UPDATE activity_log SET text='next' WHERE id='activity'");
  const observed = await snapshot((await closeBaseline()).admission, { windowStart: NOW });
  const counts = observed.sources.find(s => s.sourceKind === 'runtime_archive').counts;
  assert.equal(counts.inWindow, 1); assert.equal(counts.unknown, 1);
  assert.equal(counts.inventoryUnknown, 1); assert.equal(counts.history, 1);
  assert.equal(counts.operational, 0); assert.equal(counts.eligible, 0);
});

test('an abandoned admission records a durable gap before the next successful snapshot', async () => {
  api('preparePagedCensusObservation');
  await closeBaseline();
  now += 60000; fence = newFence();
  const observed = await snapshot((await closeBaseline()).admission, { windowStart: NOW });
  assert.equal(observed.coverage.continuous, false);
  assert.equal(observed.coverage.intersectingGaps, 1);
  assert.equal(observed.coverage.gaps.length, 1);
});

test('mutable leaf cache poisoning blocks update instead of changing authoritative counts', async () => {
  api('preparePagedCensusObservation'); await insert('cached');
  await snapshot((await closeBaseline()).admission);
  await db.query("UPDATE pbk_runtime_census_entries SET report=jsonb_set(report,'{poison}','true')");
  await db.query("UPDATE activity_log SET text='mutated' WHERE id='cached'");
  fence = newFence(); const result = await prepare();
  assert.equal(result.verified, false); assert.notEqual(result.result, 'paged_census_incomplete');
});

test('missing immutable historical dependency denies exact readback and cannot fall back to latest', async () => {
  api('preparePagedCensusObservation'); await insert('historical');
  const old = await snapshot((await closeBaseline()).admission);
  now += 60000; fence = newFence();
  await db.query("UPDATE activity_log SET text='next' WHERE id='historical'");
  const next = await snapshot((await closeBaseline()).admission);
  assert.notDeepEqual(old.inventory.reference, next.inventory.reference);
  assert.deepEqual(await readback(old.inventory), { verified: true, ...old.inventory });
  await db.exec('ALTER TABLE pbk_runtime_census_proofs DISABLE TRIGGER USER');
  await db.query('DELETE FROM pbk_runtime_census_proofs WHERE id=$1', [old.inventory.reference.id]);
  await db.exec('ALTER TABLE pbk_runtime_census_proofs ENABLE TRIGGER USER');
  await assert.rejects(() => readback(old.inventory));
});

test('retained interval witnesses reconstruct old roots, reject supplied roots and journal holes', async () => {
  api('preparePagedCensusObservation'); await insert('witness');
  const first = await snapshot((await closeBaseline()).admission);
  const report = { intervalStart: new Date(NOW).toISOString(), cutoff: new Date(NOW).toISOString() };
  const roots = await api('readPagedCensusIntervalRoots')(input({ reports: [report], snapshot: first }));
  assert.match(roots[0], /^[a-f0-9]{64}$/);
  now += 60000; fence = newFence(); await insert('later');
  const next = await snapshot((await closeBaseline()).admission);
  const retained = { ...report, source: { inventory: first.inventory, intervalRoot: roots[0] } };
  assert.deepEqual(await api('readPagedCensusIntervalRoots')(input({ reports: [retained], snapshot: next })), roots);
  await assert.rejects(() => api('readPagedCensusIntervalRoots')(input({ reports: [{ ...retained,
    source: { ...retained.source, intervalRoot: '0'.repeat(64) } }], snapshot: next })));
  await db.exec('ALTER TABLE pbk_runtime_census_journal DISABLE TRIGGER USER');
  await db.query('DELETE FROM pbk_runtime_census_journal WHERE sequence=1');
  await db.exec('ALTER TABLE pbk_runtime_census_journal ENABLE TRIGGER USER');
  fence = newFence(); assert.equal((await prepare()).verified, false);
});

test('oversized row and shared cumulative budget across calls block without widening limits', async () => {
  api('preparePagedCensusObservation'); await insert('oversized', 'x'.repeat(16777217));
  const result = await prepare();
  assert.equal(result.verified, false); assert.notEqual(result.result, 'paged_census_incomplete');
  assert.equal((await db.query('SELECT count(*) AS n FROM pbk_runtime_census_state')).rows[0].n, 0);
});

test('poisoned shared fence forbids queries and no late continuation can persist state', async () => {
  api('preparePagedCensusObservation');
  fence.onAbort(); const result = await prepare();
  assert.equal(result.verified, false); assert.equal(calls.length, 0);
});

test('old journal witness segments are retained but not loaded into every future interval', async () => {
  api('preparePagedCensusObservation'); await insert('retained');
  await snapshot((await closeBaseline()).admission);
  now += 60000; fence = newFence();
  await db.query("UPDATE activity_log SET text='old-event' WHERE id='retained'");
  const old = await snapshot((await closeBaseline()).admission, { windowStart: NOW });
  const oldReport = { intervalStart: new Date(NOW).toISOString(), cutoff: new Date(now).toISOString() };
  const roots = await api('readPagedCensusIntervalRoots')(input({ reports: [oldReport], snapshot: old }));
  const before = (await db.query('SELECT count(*) AS n FROM pbk_runtime_census_proofs')).rows[0].n;
  now += 3 * 86400000; fence = newFence();
  const current = await snapshot((await closeBaseline()).admission);
  assert.ok(current.historyCompleteFrom > old.historyCompleteFrom);
  const root = (await db.query('SELECT report FROM pbk_runtime_census_proofs WHERE id=$1', [current.inventory.reference.id])).rows[0].report;
  assert.equal(root.witness, null);
  assert.ok((await db.query('SELECT count(*) AS n FROM pbk_runtime_census_proofs')).rows[0].n >= before);
  const historical = { ...oldReport, source: { inventory: old.inventory, intervalRoot: roots[0] } };
  assert.deepEqual(await api('readPagedCensusIntervalRoots')(input({ reports: [historical], snapshot: current })), roots);
});

test('physical query observations charge the inherited operation budget', async () => {
  api('preparePagedCensusObservation'); await insert('budget');
  const observed = await snapshot((await closeBaseline()).admission);
  fence = newFence();
  const charges = [];
  fence.consume = charge => {
    charges.push(charge);
    if (charge.rows) { fence.onAbort(); throw new Error('fixture budget exhausted'); }
  };
  const query = client.query;
  client.query = async config => {
    const result = await query(config);
    fence.consume({ rows: result.rows.length, bytes: Buffer.byteLength(JSON.stringify(result.rows)) });
    return result;
  };
  await assert.rejects(() => readback(observed.inventory));
  assert.ok(charges.some(c => c.rows > 0 && c.bytes > 0));
  assert.equal(fence.signal.aborted, true);
});

test('projected bytes accumulate across pages in the same fence and abort cannot advance the cursor', async () => {
  api('preparePagedCensusObservation');
  for (let i = 0; i < 150; i++) await insert(`bytes-${i}`, 'x'.repeat(120000));
  const first = await prepare();
  assert.equal(first.result, 'paged_census_incomplete');
  let before = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report;
  for (let i = 0; i < 30 && !fence.signal.aborted; i++) {
    const result = await prepare();
    assert.equal(result.verified, false);
    if (!fence.signal.aborted) before = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report;
  }
  assert.equal(fence.signal.aborted, true);
  const after = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report;
  assert.deepEqual(after, before);
  const n = calls.length;
  assert.equal((await prepare()).verified, false); assert.equal(calls.length, n);
  await db.exec('ROLLBACK');
});

test('late query completion after deadline cannot resume the operation or write progress', async () => {
  api('preparePagedCensusObservation');
  let finish, queries = 0;
  client = { query: async () => { queries++; return new Promise(resolve => { finish = resolve; }); } };
  fence.deadlineAt = performance.now() + 20;
  const result = await prepare();
  assert.equal(result.verified, false); assert.equal(fence.signal.aborted, true);
  finish({ rows: [] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(queries, 1);
  assert.equal((await db.query('SELECT count(*) AS n FROM pbk_runtime_census_state')).rows[0].n, 0);
});

test.each(['resolved', 'rejected'])('a %s query exceeding its monotonic deadline poisons the fence even when its timer cannot run', async outcome => {
  api('preparePagedCensusObservation'); await insert('blocked-query');
  const query = client.query, destroyed = [];
  let blockedIndex = -1, queryMs, blockedMs;
  client.release = destroy => { destroyed.push(destroy); };
  client.query = async config => {
    const result = await query(config);
    if (config.text.includes('SELECT * FROM public.pbk_census_page(')) {
      blockedIndex = calls.length - 1; queryMs = config.query_timeout;
      const started = performance.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, queryMs + 50);
      blockedMs = performance.now() - started;
      if (outcome === 'rejected') throw new Error('fixture late query rejection');
    }
    return result;
  };
  try {
    const result = await prepare();
    assert.ok(queryMs > 0 && queryMs <= 2000); assert.ok(blockedMs >= queryMs);
    assert.ok(performance.now() < fence.deadlineAt, 'only the query deadline has expired');
    assert.equal(result.result, 'paged_census_unverified');
    assert.equal(result.progressRecorded, undefined); assert.equal(fence.signal.aborted, true);
    assert.ok(destroyed.includes(true));
    assert.equal(calls.length, blockedIndex + 1, 'no write, COMMIT or queued ROLLBACK after late query');
    const count = calls.length;
    assert.equal((await prepare()).result, 'paged_census_unverified'); assert.equal(calls.length, count);
  } finally { client.query = query; await db.exec('ROLLBACK'); }
  assert.equal((await db.query('SELECT count(*) AS n FROM pbk_runtime_census_state')).rows[0].n, 0);
  assert.equal((await db.query('SELECT count(*) AS n FROM pbk_runtime_census_proofs')).rows[0].n, 0);
});

test('deleted non-root proof and forged generation cannot survive metadata-only independent readback', async () => {
  api('preparePagedCensusObservation'); await insert('dependency');
  const observed = await snapshot((await closeBaseline()).admission);
  await assert.rejects(() => readback({ ...observed.inventory, generation: 'f'.repeat(64) }));
  const root = (await db.query('SELECT report FROM pbk_runtime_census_proofs WHERE id=$1', [observed.inventory.reference.id])).rows[0].report;
  await db.exec('ALTER TABLE pbk_runtime_census_proofs DISABLE TRIGGER USER');
  await db.query('DELETE FROM pbk_runtime_census_proofs WHERE id=$1', [root.tree[0]]);
  await db.exec('ALTER TABLE pbk_runtime_census_proofs ENABLE TRIGGER USER');
  await assert.rejects(() => readback(observed.inventory));
});

test('a missing mutable cache bucket is rebuilt from sealed leaf authority', async () => {
  api('preparePagedCensusObservation'); await insert('rebuildable');
  await snapshot((await closeBaseline()).admission);
  await db.query('DELETE FROM pbk_runtime_census_entries');
  now += 60000; fence = newFence();
  await db.query("UPDATE activity_log SET text='rebuilt' WHERE id='rebuildable'");
  const observed = await snapshot((await closeBaseline()).admission);
  assert.equal(observed.inventory.receiptCount, 1);
});

test('each baseline page has a retained signed predecessor and cannot be omitted at readback', async () => {
  api('preparePagedCensusObservation'); await insert('page-proof');
  const observed = await snapshot((await closeBaseline()).admission);
  const pages = (await db.query("SELECT id,body_digest,report FROM pbk_runtime_census_proofs WHERE report->>'type'='page' ORDER BY (report->>'page')::int")).rows;
  assert.equal(pages.length, 4);
  assert.equal(pages[0].report.predecessor, null);
  for (let i = 1; i < pages.length; i++) assert.deepEqual(pages[i].report.predecessor,
    { id: pages[i - 1].id, digest: pages[i - 1].body_digest });
  await db.exec('ALTER TABLE pbk_runtime_census_proofs DISABLE TRIGGER USER');
  await db.query('DELETE FROM pbk_runtime_census_proofs WHERE id=$1', [pages[0].id]);
  await db.exec('ALTER TABLE pbk_runtime_census_proofs ENABLE TRIGGER USER');
  await assert.rejects(() => readback(observed.inventory));
});

test('an individually valid multi-row batch over 16 MiB advances by admitted ordered prefixes', async () => {
  api('preparePagedCensusObservation');
  await db.query(`INSERT INTO activity_log(id,workspace_id,source,status,category,text,metadata,created_at,updated_at)
    SELECT 'adaptive-'||n,'pbk','runtime-event:fixture','success','EVENT',repeat('x',140000),'{}',$1,$1
    FROM generate_series(1,140) n`, [new Date(NOW).toISOString()]);
  const first = await prepare();
  assert.equal(first.result, 'paged_census_incomplete');
  const s = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report;
  assert.ok(s.scannedCount > 0 && s.scannedCount < 140);
  const observed = await snapshot((await closeBaseline()).admission);
  assert.equal(observed.inventory.receiptCount, 140);
});

test('historical manifests share authenticated metadata only within one repeatable-read transaction', async () => {
  api('preparePagedCensusObservation');
  await db.query(`INSERT INTO activity_log(id,workspace_id,source,status,category,text,metadata,created_at,updated_at)
    SELECT 'shared-'||n,'pbk','runtime-event:fixture','success','EVENT','','{}',$1,$1
    FROM generate_series(1,1000) n`, [new Date(NOW).toISOString()]);
  const reports = [];
  let observed = await snapshot((await closeBaseline()).admission);
  for (let i = 0; i < 4; i++) {
    now += 60000; fence = newFence();
    await db.query("UPDATE activity_log SET text=$1 WHERE id='shared-1'", [String(i)]);
    observed = await snapshot((await closeBaseline()).admission);
    reports.push({ intervalStart: new Date(now).toISOString(), cutoff: new Date(now).toISOString(),
      source: { inventory: observed.inventory } });
  }
  fence = newFence(); let metadataRows = 0, metadataQueries = 0;
  const query = client.query;
  client.query = async config => {
    const result = await query(config);
    if (config.text.includes('AS census_metadata')) { metadataRows += result.rows.length; metadataQueries++; }
    return result;
  };
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: false }));
  const first = metadataRows;
  await api('readPagedCensusIntervalRoots')(input({ reports, snapshot: observed }));
  const added = metadataRows - first;
  assert.ok(added < first * 2, `shared graph reloaded ${added} dependency observations after ${first}`);
  const beforeReadback = metadataQueries;
  await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: false }));
  assert.equal(metadataQueries, beforeReadback, 'same-RR exact graph can be reused precommit');
  await db.exec('COMMIT');
  await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: true }));
  assert.ok(metadataQueries > beforeReadback, 'postcommit independent readback must not reuse cache');
});

test('a large individually admissible projection is not permanently excluded by the bulk write reserve', async () => {
  api('preparePagedCensusObservation'); await insert('large-valid', 'x'.repeat(15800000));
  assert.equal((await prepare()).result, 'paged_census_incomplete');
  const observed = await snapshot((await closeBaseline()).admission);
  assert.equal(observed.inventory.receiptCount, 1);
});

test('unchanged equal-head source content survives a clock-validity transition without losing conflict checks', async () => {
  api('preparePagedCensusObservation');
  assert.equal((await prepare()).result, 'paged_census_incomplete');
  await db.query(`INSERT INTO pbk_qa_audit(id,tenant_id,tool_name,passed,skipped,source,created_at)
    VALUES ('clock-transition','pbk','fixture',true,false,'fixture',clock_timestamp()+interval '2 seconds')`);
  const journal = (await db.query('SELECT sequence,digest,clock_valid FROM pbk_runtime_census_journal')).rows[0];
  assert.equal(journal.clock_valid, false);
  fence = newFence();
  assert.equal((await prepare()).result, 'paged_census_incomplete');
  const before = (await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report;
  assert.equal(before.kind, 2); assert.equal(before.journalSequence, 1);
  let projected;
  const until = performance.now() + 5000;
  do {
    projected = (await db.query("SELECT * FROM pbk_census_page('qa')")).rows[0];
    if (!projected.clock_valid) await new Promise(resolve => setTimeout(resolve, 25));
  } while (!projected.clock_valid && performance.now() < until);
  assert.equal(projected.clock_valid, true); assert.equal(projected.digest, journal.digest);

  const query = client.query;
  client.query = async config => {
    const result = await query(config);
    if (config.text.includes('SELECT * FROM public.pbk_census_page(') && config.values[0] === 'qa') {
      return { ...result, rows: result.rows.map(row => ({ ...row,
        digest: row.digest === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64) })) };
    }
    return result;
  };
  try { fence = newFence(); assert.equal((await prepare()).result, 'paged_census_unverified'); }
  finally { client.query = query; }
  assert.deepEqual((await db.query('SELECT report FROM pbk_runtime_census_state')).rows[0].report, before);

  fence = newFence();
  assert.equal((await prepare()).result, 'paged_census_incomplete');
  const observed = await snapshot((await closeBaseline()).admission);
  assert.equal(observed.inventory.receiptCount, 1);
  const counts = observed.sources.find(source => source.sourceKind === 'qa').counts;
  assert.equal(counts.inventoryUnknown, 1); assert.equal(counts.operational, 0); assert.equal(counts.eligible, 0);
  assert.equal(Number((await db.query('SELECT sequence FROM pbk_runtime_census_head WHERE id')).rows[0].sequence), 1);
  const entries = (await db.query('SELECT report FROM pbk_runtime_census_entries')).rows.flatMap(row => row.report.entries);
  assert.ok(entries.length > 0); assert.ok(entries.every(entry => entry[5] === false));
});

test('bounded BFS verifies every unique metadata row physically once without aggregate double charges', async () => {
  api('preparePagedCensusObservation');
  await db.query(`INSERT INTO activity_log(id,workspace_id,source,status,category,text,metadata,created_at,updated_at)
    SELECT 'bfs-'||n,'pbk','runtime-event:fixture','success','EVENT','','{}',$1,$1
    FROM generate_series(1,1000) n`, [new Date(NOW).toISOString()]);
  const observed = await snapshot((await closeBaseline()).admission);
  const expected = new Set((await db.query(`WITH RECURSIVE fixture_graph(id) AS (
    SELECT $1::text UNION SELECT e->>0 FROM fixture_graph g JOIN pbk_runtime_census_proofs p ON p.id=g.id
    CROSS JOIN LATERAL jsonb_array_elements(p.report->'children') e) SELECT id FROM fixture_graph`,
  [observed.inventory.reference.id])).rows.map(r => r.id));
  expected.delete(observed.inventory.reference.id);
  fence = newFence(); let rows = 0, bytes = 0, physical = false;
  const query = client.query, batches = [];
  fence.consume = charge => {
    assert.ok(physical || charge.rows === 0, 'metadata must use physical result accounting, not aggregate row charges');
    rows += charge.rows || 0; bytes += charge.bytes || 0;
    assert.ok(rows <= 10000 && bytes <= 16777216);
  };
  fence.remainingBudget = () => ({ rows: 10000 - rows, bytes: 16777216 - bytes });
  client.query = async config => {
    const started = performance.now(), result = await query(config);
    physical = true;
    try { fence.consume({ rows: result.rows.length, bytes: Buffer.byteLength(JSON.stringify(result.rows)) }); }
    finally { physical = false; }
    if (config.text.includes('AS census_metadata')) batches.push({ ids: result.rows.map(r => r.id), ms: performance.now() - started });
    return result;
  };
  try {
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
    assert.equal((await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: false }))).verified, true);
    assert.ok(batches.length > 1); assert.ok(batches.every(b => b.ids.length <= 512 && b.ms < 2000));
    const ids = batches.flatMap(b => b.ids);
    assert.equal(ids.length, new Set(ids).size); assert.deepEqual(new Set(ids), expected);
    const count = batches.length;
    await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: false }));
    assert.equal(batches.length, count);
    await db.exec('COMMIT');
    await api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: true }));
    assert.deepEqual(new Set(batches.slice(count).flatMap(b => b.ids)), expected);
    assert.ok(!calls.some(call => call.text?.includes('WITH RECURSIVE walk')));
    console.info(JSON.stringify({ fixture: 'owned-bfs-metadata', inventoryRows: 1000,
      metadataNodesPerRead: expected.size, metadataQueries: batches.length,
      peakMetadataQueryMs: Math.max(...batches.map(b => b.ms)), physicalRows: rows, physicalBytes: bytes }));
  } finally { client.query = query; await db.exec('ROLLBACK'); }
});

test.each(['metadata', 'journal'])('failed partial %s validation cannot seed a reusable root cache on same-RR retry', async failure => {
  api('preparePagedCensusObservation'); await insert('partial-cache');
  await snapshot((await closeBaseline()).admission);
  now += 60000; fence = newFence();
  await db.query("UPDATE activity_log SET text='changed' WHERE id='partial-cache'");
  const observed = await snapshot((await closeBaseline()).admission);
  fence = newFence(); const query = client.query; let metadataQueries = 0, interfere = true;
  client.query = async config => {
    const result = await query(config);
    if (config.text.includes('AS census_metadata')) {
      metadataQueries++;
      if (interfere && failure === 'metadata') return { ...result, rows: result.rows.slice(1) };
    }
    if (interfere && failure === 'journal' && config.text.includes('paged-census:journal-metadata')) {
      return { ...result, rows: result.rows.filter(row => Number(row.sequence) !== 2) };
    }
    return result;
  };
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const read = () => api('readPagedCensusInventory')(input({ inventory: observed.inventory, independent: false }));
    await assert.rejects(read);
    const afterFailure = metadataQueries;
    assert.ok(afterFailure > 0);
    await assert.rejects(read);
    assert.ok(metadataQueries > afterFailure, 'a failed traversal must not authorize root reuse');
    interfere = false;
    assert.equal((await read()).verified, true);
  } finally { client.query = query; await db.exec('ROLLBACK'); }
});

test('BFS preflights the remaining row budget before loading a metadata batch', async () => {
  api('preparePagedCensusObservation'); await insert('preflight');
  const observed = await snapshot((await closeBaseline()).admission);
  fence = newFence(); fence.remainingBudget = () => ({ rows: 0, bytes: 16777216 });
  const query = client.query; let metadataQueries = 0;
  client.query = async config => {
    if (config.text.includes('AS census_metadata')) metadataQueries++;
    return query(config);
  };
  await assert.rejects(() => readback(observed.inventory));
  assert.equal(metadataQueries, 0);
});
