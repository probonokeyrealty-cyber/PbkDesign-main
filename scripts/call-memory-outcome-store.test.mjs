import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { selectBestEpisodicTranscript } from './ava-episodic-memory.mjs';
import { canonicalJson } from './skill-governance-store.mjs';
import { collectBacklogReconciliation } from './backlog-reconciliation-collector.mjs';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const AT = '2026-11-15T10:00:00Z';
const DAY = 86400_000;
const secret = randomBytes(32).toString('hex');
const revision = 'a'.repeat(40);
const TEXT = 'Please call back after lunch.';
const SCHEMA = 'pbk-call-memory-skip-v1';
let module = {};
let db;
let queries;
let releases;

beforeAll(async () => {
  module = await import('./call-memory-outcome-store.mjs').catch(error => {
    if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) return {};
    throw error;
  });
  db = new PGlite();
  await db.exec(readFileSync(new URL('../supabase/migrations/20260529014000_pbk_eval_safety.sql', import.meta.url), 'utf8'));
  await db.exec(`CREATE TABLE event_dead_letters (id text PRIMARY KEY, tenant_id text DEFAULT 'pbk',
      event_id text, event_type text DEFAULT 'call.completed', source text DEFAULT 'telnyx-deepgram-finalize',
      payload jsonb DEFAULT '{}', error text DEFAULT '', stack text DEFAULT '', created_at timestamptz);
    CREATE TABLE calls (id text PRIMARY KEY, workspace_id text DEFAULT 'pbk', provider text DEFAULT 'telnyx',
      telnyx_call_control_id text DEFAULT '', telnyx_call_leg_id text DEFAULT '', telnyx_call_session_id text DEFAULT '',
      transcript jsonb DEFAULT '[]', notes text DEFAULT '', synthetic boolean DEFAULT false,
      metadata jsonb DEFAULT '{}', phone text DEFAULT '', created_at timestamptz, updated_at timestamptz);
    CREATE TABLE provider_action_dispatches (approval_id text, workspace_id text, status text);
    CREATE TABLE approvals (id text, workspace_id text);
    CREATE TABLE pbk_call_qa_scores (id text, tenant_id text, call_id text);
    CREATE TABLE call_embeddings (id text, workspace_id text, call_id text);`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('TRUNCATE event_dead_letters, calls, pbk_eval_runs');
  queries = [];
  releases = [];
});

function api(name) {
  assert.equal(typeof module[name], 'function', `${name} must implement source-bound memory outcomes`);
  return module[name];
}
function poolFor(intercept) {
  return { async connect() {
    let destroyed = false;
    return { async query(config) {
      const text = typeof config === 'string' ? config : config.text;
      const values = config.values || [];
      queries.push({ text, values, timeout: config.query_timeout });
      const result = await intercept?.(text, values);
      if (destroyed) throw new Error('client destroyed');
      return result ?? db.query(text, values);
    }, release(destroy) { destroyed ||= Boolean(destroy); releases.push(Boolean(destroy)); } };
  } };
}
function record(options = {}) {
  return api('recordCallMemorySkip')({ pool: poolFor(), secret, revision, eventId: 'event-private',
    callId: 'call-private', sourceText: TEXT, now: NOW, ...options });
}
function read(options = {}) {
  return api('readCallMemorySkipSummary')({ pool: poolFor(), secret, revision, now: NOW, ...options });
}
async function dead({ id = 'dead-private', eventId = 'event-private', callId = 'call-private', text = TEXT,
  tenant = 'pbk', source = 'telnyx-deepgram-finalize', eventType = 'call.completed',
  payload = { workspaceId: 'pbk', callId, transcript: text }, at = AT } = {}) {
  await db.query(`INSERT INTO event_dead_letters(id,tenant_id,event_id,event_type,source,payload,error,stack,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,'private worker error','private stack',$7)`,
  [id, tenant, eventId, eventType, source, JSON.stringify(payload), at]);
}
async function call({ id = 'call-private', workspace = 'pbk', transcript = [], notes = '',
  controlId = '', legId = '', sessionId = '', provider = 'telnyx', synthetic = false, metadata = {} } = {}) {
  await db.query(`INSERT INTO calls(id,workspace_id,transcript,notes,telnyx_call_control_id,
    telnyx_call_leg_id,telnyx_call_session_id,provider,synthetic,metadata,phone,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'+15555550199',$11,$11)`,
  [id, workspace, JSON.stringify(transcript), notes, controlId, legId, sessionId, provider, synthetic, JSON.stringify(metadata), AT]);
}
async function receipts() { return (await db.query('SELECT * FROM pbk_eval_runs ORDER BY id')).rows; }
function blocked(value) {
  assert.equal(value.verified, false);
  assert.equal(value.embeddingVerified, false);
  assert.equal(value.fullRecovery, false);
  assert.equal(value.launchQualified, false);
  assert(!/private|15555550199|Please call|worker error|stack/.test(JSON.stringify(value)));
}
function verified(value) {
  assert.equal(value.ok, true);
  assert.equal(value.verified, true);
  assert.equal(value.embeddingVerified, false);
  assert.equal(value.fullRecovery, false);
  assert.equal(value.providerDeliveryVerified, false);
  assert.equal(value.launchQualified, false);
}
async function mutate(change, { resign = false } = {}) {
  const row = (await receipts())[0];
  change(row);
  if (resign) {
    const { attestation: _ignored, ...unsigned } = row.report;
    const key = createHmac('sha256', secret).update('pbk.call-memory-skip.signing-key.v1').digest();
    row.report.attestation = { version: SCHEMA, signature: createHmac('sha256', key)
      .update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex') };
  }
  await db.query(`UPDATE pbk_eval_runs SET tenant_id=$2,suite_name=$3,source=$4,report=$5,
    ok=$6,total=$7,passed=$8,failed=$9,created_at=$10,id=$11 WHERE id=$1`, [row.id, row.tenant_id,
    row.suite_name, row.source, JSON.stringify(row.report), row.ok, row.total, row.passed, row.failed, row.created_at, row.newId || row.id]);
}

test('genuine invocation writes a bounded signed source-bound receipt into existing eval schema', async () => {
  await dead(); await call();
  const value = await record();
  verified(value);
  assert.match(value.recordRef, /^[a-f0-9]{64}$/);
  const rows = await receipts();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.suite_name, 'call_memory_skip_v1');
  assert.equal(row.tenant_id, 'pbk');
  assert.equal(row.source, 'server:call-memory-skip:v1');
  assert.equal(row.ok, false, 'policy skip must not turn generic evaluation success green');
  assert.deepEqual([row.total, row.passed, row.failed], [1, 0, 1]);
  const keyedSource = createHmac('sha256', secret).update('pbk:call-memory-skip:v1:normalized-source\0')
    .update(canonicalJson(TEXT)).digest('hex');
  assert.equal(row.report.sourceHash, keyedSource, 'short low-entropy text must not leave a plain dictionary-checkable digest');
  assert.deepEqual(row.report.policy, { version: 'episodic-short-source-v1', minimumChars: 80,
    normalization: 'selectBestEpisodicTranscript-v1' });
  assert.equal(row.report.executedAt, new Date(NOW).toISOString());
  assert.equal(row.report.outcome, 'skipped_short_source');
  assert.match(row.report.attestation.signature, /^[a-f0-9]{64}$/);
  assert(Buffer.byteLength(JSON.stringify(row.report)) <= 4096);
  assert(!/event-private|call-private|dead-private|15555550199|Please call|private worker/.test(JSON.stringify(rows)));
  const summary = await read();
  verified(summary);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.counts, { events: 1, verifiedSkips: 1, unverified: 0, notApplicable: 0 });
  assert.deepEqual(summary.issues, []);
});

test('pure skip adapter verifies genuine receipt without SQL and retains exact source/freshness checks', async () => {
  await dead(); await call(); verified(await record());
  const original = (await db.query('SELECT to_jsonb(d) AS row FROM event_dead_letters d')).rows[0].row;
  const calls = (await db.query('SELECT to_jsonb(c) AS row FROM calls c')).rows.map(r => r.row);
  const receipt = (await db.query(`SELECT to_jsonb(r) || jsonb_build_object('created_at_exact',
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS row FROM pbk_eval_runs r`)).rows[0].row;
  const input = { original, calls, receipt, secret, revision, now: NOW };
  const before = JSON.stringify(input);
  const check = options => api('verifyCallMemorySkipEvidence')({ ...input, ...options });
  const value = check();
  assert.equal(value.verified, true);
  assert.equal(value.executedAt, new Date(NOW).toISOString());
  assert.match(value.binding, /^[a-f0-9]{64}$/);
  assert.match(value.artifactRef, /^[a-f0-9]{64}$/);
  for (const options of [
    { now: NOW + DAY }, { now: NOW - 1 }, { revision: 'b'.repeat(40) },
    { secret: 'different-test-material' }, { receipt: null },
    { receipt: { ...receipt, created_at_exact: receipt.created_at_exact.replace('000Z', '001Z') } },
    { calls: [{ ...calls[0], notes: 'Long canonical transcript. '.repeat(8) }] },
    { original: { ...original, error: 'changed error' } },
  ]) assert.equal(check(options).verified, false);
  assert.equal(JSON.stringify(input), before);
  assert(!/private|Please call/.test(JSON.stringify(value)));
});

test('historical 34/35/44-character rows never become skips just by being read', async () => {
  for (const size of [34, 35, 44]) await dead({ id: `dead-${size}`, eventId: `event-${size}`, callId: `call-${size}`, text: 'x'.repeat(size) });
  const value = await read();
  blocked(value);
  assert.equal(value.ok, true);
  assert.deepEqual(value.counts, { events: 3, verifiedSkips: 0, unverified: 3, notApplicable: 0 });
  assert.deepEqual(value.issues, ['receipt_missing']);
  assert.equal((await receipts()).length, 0);
  assert(!queries.some(q => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(q.text)));
});

test('a genuine skip leaves exact backlog-v1 fingerprint/counts and full recovery unchanged', async () => {
  await dead();
  const collect = () => collectBacklogReconciliation({ pool: poolFor(), secret, now: NOW });
  const before = await collect();
  assert.equal(before.ok, true);
  verified(await record()); verified(await read());
  const after = await collect();
  assert.deepEqual(after, before);
  assert.equal(after.reconciliation.counts.memoryVerified, 0);
  assert.equal(after.reconciliation.counts.memoryUnverified, 1);
  assert.equal(after.reconciliation.deadLetters[0].fullRecovery, 'unverified');
});

test('idempotent replay leaves fresh identical receipt and execution time unchanged; new source replaces one slot', async () => {
  await dead();
  const first = await record(); verified(first);
  const original = await receipts();
  verified(await record({ now: NOW + 1000 }));
  assert.deepEqual(await receipts(), original);
  const next = 'A different short but authoritative final transcript.';
  await db.query(`UPDATE event_dead_letters SET payload=jsonb_set(payload,'{transcript}',$1::jsonb)`, [JSON.stringify(next)]);
  blocked(await read());
  verified(await record({ sourceText: next, now: NOW + 2000 }));
  const updated = await receipts();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, original[0].id);
  assert.notEqual(updated[0].report.sourceHash, original[0].report.sourceHash);
  verified(await read({ now: NOW + 2000 }));
});

test('exact existing selector handles turns, whitespace, notes and provider aliases', async () => {
  await dead({ text: '  Short\n  text.  ' });
  const transcript = [{ role: 'seller', text: '  Call\t me   tomorrow. ' }];
  const notes = ' A longer canonical   note with a callback preference. ';
  await call({ id: 'canonical-private', controlId: 'call-private', transcript, notes });
  const expected = selectBestEpisodicTranscript(['  Short\n  text.  ', transcript, notes]);
  blocked(await record({ sourceText: 'Short text.' }));
  verified(await record({ sourceText: expected }));
  verified(await read());
});

test.each([79, 80, 81])('only a nonempty normalized source below policy80 can be recorded: %s', async size => {
  const text = 'x'.repeat(size);
  await dead({ text });
  const value = await record({ sourceText: text });
  if (size < 80) verified(value); else blocked(value);
  assert.equal((await receipts()).length, size < 80 ? 1 : 0);
});

test('longer canonical context forbids skip even when original event is short', async () => {
  await dead(); await call({ notes: 'Long authoritative context. '.repeat(5) });
  blocked(await record());
  assert.equal((await receipts()).length, 0);
});

test.each(['missing', 'wrong-event', 'wrong-call', 'client-text', 'empty', 'unnormalized'])('rejects caller claims: %s', async mode => {
  if (mode !== 'missing') await dead();
  const options = mode === 'wrong-event' ? { eventId: 'invented-event' }
    : mode === 'wrong-call' ? { callId: 'invented-call' }
      : mode === 'client-text' ? { sourceText: 'Client claims this happened.' }
        : mode === 'empty' ? { sourceText: '' } : mode === 'unnormalized' ? { sourceText: ` ${TEXT} ` } : {};
  blocked(await record(options));
  assert.equal((await receipts()).length, 0);
});

test.each(['tenant', 'scope', 'tenant-alias', 'call-alias', 'no-scope', 'no-call', 'no-provider',
  'event-type', 'synthetic', 'nested-fixture', 'created-future', 'no-transcript'])('fails closed on unsupported provenance: %s', async mode => {
  const payload = { workspaceId: 'pbk', callId: 'call-private', transcript: TEXT };
  if (mode === 'scope') payload.workspace_id = 'other';
  if (mode === 'tenant-alias') payload.tenantId = 'other';
  if (mode === 'call-alias') payload.call_id = 'wrong-call';
  if (mode === 'no-scope') delete payload.workspaceId;
  if (mode === 'no-call') delete payload.callId;
  if (mode === 'synthetic') payload.synthetic = true;
  if (mode === 'nested-fixture') payload.metadata = { fixture: true };
  if (mode === 'no-transcript') delete payload.transcript;
  await dead({ payload, tenant: mode === 'tenant' ? 'other' : 'pbk',
    source: mode === 'no-provider' ? 'operator-claim' : 'telnyx-deepgram-finalize',
    eventType: mode === 'event-type' ? 'lead.imported' : 'call.completed',
    at: mode === 'created-future' ? new Date(NOW + 1).toISOString() : AT });
  blocked(await record());
  assert.equal((await receipts()).length, 0);
});

test.each(['synthetic', 'fixture', 'other-provider', 'ambiguous'])('canonical source validation: %s', async mode => {
  await dead();
  await call({ synthetic: mode === 'synthetic', metadata: mode === 'fixture' ? { controlled: true } : {},
    provider: mode === 'other-provider' ? 'mock' : 'telnyx' });
  if (mode === 'ambiguous') await call({ id: 'second-private', controlId: 'call-private' });
  blocked(await record());
  assert.equal((await receipts()).length, 0);
});

test('duplicate original event identity is ambiguous and cannot certify either row', async () => {
  await dead(); await dead({ id: 'second-private' });
  blocked(await record()); blocked(await read());
  assert.equal((await receipts()).length, 0);
});

test.each(['transcript', 'call-context', 'replacement-original', 'removed-original', 'new-canonical'])('current source changes invalidate receipt: %s', async mode => {
  await dead(); if (mode === 'call-context') await call();
  verified(await record());
  if (mode === 'transcript') await db.query(`UPDATE event_dead_letters SET payload=jsonb_set(payload,'{transcript}','"Changed but short."')`);
  if (mode === 'call-context') await db.query("UPDATE calls SET notes='New canonical source.'");
  if (mode === 'replacement-original') await db.query("UPDATE event_dead_letters SET id='replacement-private'");
  if (mode === 'removed-original') await db.exec('DELETE FROM event_dead_letters');
  if (mode === 'new-canonical') await call();
  const value = await read(); blocked(value);
  assert.equal(value.counts?.verifiedSkips ?? 0, 0);
});

test.each(['secret', 'revision', 'stale', 'future'])('key/revision/freshness checks fail closed: %s', async mode => {
  await dead(); verified(await record());
  const options = mode === 'secret' ? { secret: 'different-test-signing-material' }
    : mode === 'revision' ? { revision: 'b'.repeat(40) }
      : { now: mode === 'stale' ? NOW + DAY : NOW - 1 };
  const value = await read(options); blocked(value);
  assert.equal(value.counts.verifiedSkips, 0);
});

test.each(['signature', 'policy', 'version', 'sourceHash', 'callRef', 'sourceBinding', 'extra', 'outcome',
  'tenant', 'suite', 'source', 'ok', 'counts', 'created', 'id'])('tamper detection, including validly re-signed wrong contracts: %s', async mode => {
  await dead(); verified(await record());
  await mutate(row => {
    if (mode === 'signature') row.report.attestation.signature = 'f'.repeat(64);
    if (mode === 'policy') row.report.policy.minimumChars = 1;
    if (mode === 'version') row.report.schemaVersion = 'unknown';
    if (mode === 'sourceHash') row.report.sourceHash = '1'.repeat(64);
    if (mode === 'callRef') row.report.callRef = '2'.repeat(64);
    if (mode === 'sourceBinding') row.report.sourceBinding = '3'.repeat(64);
    if (mode === 'extra') row.report.rawTranscript = 'private malicious content';
    if (mode === 'outcome') row.report.outcome = 'embedded';
    if (mode === 'tenant') row.tenant_id = 'other';
    if (mode === 'suite') row.suite_name = 'other';
    if (mode === 'source') row.source = 'operator';
    if (mode === 'ok') row.ok = true;
    if (mode === 'counts') row.passed = 1;
    if (mode === 'created') row.created_at = new Date(NOW + 1);
    if (mode === 'id') row.newId = 'changed-slot-private';
  }, { resign: mode !== 'signature' });
  const value = await read(); blocked(value);
  assert.equal(value.counts.verifiedSkips, 0);
});

test('a stale receipt can only be renewed by another explicit actual-execution recorder call', async () => {
  await dead(); verified(await record());
  blocked(await read({ now: NOW + DAY }));
  verified(await record({ now: NOW + DAY }));
  verified(await read({ now: NOW + DAY }));
  assert.equal((await receipts()).length, 1);
});

test('PBK scoping excludes other tenants and cannot mint canonical-only receipts', async () => {
  await dead({ tenant: 'other' }); await call({ workspace: 'other' });
  blocked(await record());
  const summary = await read(); blocked(summary);
  assert.deepEqual(summary.counts, { events: 0, verifiedSkips: 0, unverified: 0, notApplicable: 0 });
  await db.exec('DELETE FROM event_dead_letters');
  await call({ id: 'canonical-only' });
  blocked(await record({ callId: 'canonical-only' }));
  assert.equal((await receipts()).length, 0);
});

test('PBK event cannot launder a canonical call owned by another tenant into a skip', async () => {
  await dead(); await call({ workspace: 'other' });
  blocked(await record());
  assert.equal((await receipts()).length, 0);
  const summary = await read(); blocked(summary);
  assert.equal(summary.counts, null, 'untrusted canonical scope makes the entire bounded snapshot unavailable');
});

test('canonical updated_at before created_at cannot certify a skip', async () => {
  await dead(); await call();
  await db.exec("UPDATE calls SET updated_at=created_at-interval '1 second'");
  blocked(await record());
  const summary = await read(); blocked(summary);
  assert.equal(summary.counts.verifiedSkips, 0);
  assert.equal((await receipts()).length, 0);
});

test('sub-millisecond stored execution-time mutation is not hidden by driver Date precision', async () => {
  await dead(); verified(await record());
  await db.exec("UPDATE pbk_eval_runs SET created_at=created_at+interval '0.000001 second'");
  const value = await read(); blocked(value);
  assert.equal(value.counts.verifiedSkips, 0);
});

test('137-character embedding-eligible source is not applicable beside an unverified 34-character original', async () => {
  await dead({ text: 'x'.repeat(34) });
  await dead({ id: 'long-private', eventId: 'long-event', callId: 'long-call', text: 'y'.repeat(137) });
  const value = await read(); blocked(value);
  assert.deepEqual(value.counts, { events: 2, verifiedSkips: 0, unverified: 1, notApplicable: 1 });
  assert.deepEqual(value.issues, ['receipt_missing']);
  assert.equal(value.outcomes.filter(row => row.outcome === 'not_applicable').length, 1);
  assert.equal((await receipts()).length, 0);
});

test('all not-applicable sources are not an empty skip verification pass', async () => {
  await dead({ text: 'x'.repeat(137) });
  const value = await read(); blocked(value);
  assert.deepEqual(value.counts, { events: 1, verifiedSkips: 0, unverified: 0, notApplicable: 1 });
  assert.deepEqual(value.issues, []);
});

test.each(['event-count', 'event-bytes', 'call-bytes', 'receipt-bytes'])('bounded source and receipt reads: %s', async mode => {
  if (mode === 'event-count') {
    for (let i = 0; i < 65; i++) await dead({ id: `dead-${i}`, eventId: `event-${i}` });
  } else {
    await dead();
    if (mode === 'receipt-bytes') {
      verified(await record());
      await mutate(row => { row.report.unbounded = 'x'.repeat(65537); });
    }
    if (mode === 'event-bytes') await db.query("UPDATE event_dead_letters SET error=$1", ['x'.repeat(65537)]);
    if (mode === 'call-bytes') await call({ notes: 'x'.repeat(65537) });
  }
  blocked(await read());
  if (mode !== 'receipt-bytes') blocked(await record());
});

test.each(['secret', 'revision', 'clock', 'controlled-pool'])('invalid authority or environment is rejected before SQL: %s', async mode => {
  const pool = poolFor();
  if (mode === 'controlled-pool') pool.controlled = true;
  const options = { pool, ...(mode === 'secret' ? { secret: '' }
    : mode === 'revision' ? { revision: 'main' } : mode === 'clock' ? { now: NaN } : {}) };
  blocked(await record(options)); blocked(await read(options));
  assert.equal(queries.length, 0);
});

test('queries use bounded parameters and only existing outcome table is written', async () => {
  await dead(); await call(); verified(await record());
  const written = queries.filter(q => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(q.text));
  assert.equal(written.length, 1);
  assert.match(written[0].text, /INSERT INTO public.pbk_eval_runs/);
  assert(!queries.some(q => /private|Please call|15555550199/.test(q.text)));
  for (const q of queries) assert(q.timeout > 0 && q.timeout <= 2000);
  queries = []; releases = [];
  verified(await read());
  assert.match(queries[0].text, /^BEGIN.*REPEATABLE READ.*READ ONLY$/i);
  assert.equal(queries.at(-1).text, 'ROLLBACK');
  assert.deepEqual(releases, [false]);
  assert(!queries.some(q => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT)\b/i.test(q.text)));
});

test.each(['read', 'record'])('bounded pool acquisition for %s destroys late clients', async mode => {
  let deliver;
  const pool = { connect: () => new Promise(resolve => { deliver = resolve; }) };
  jest.useFakeTimers();
  try {
    let settled = false;
    const running = (mode === 'read' ? read({ pool }) : record({ pool })).then(value => { settled = true; return value; });
    await jest.advanceTimersByTimeAsync(15001);
    assert.equal(settled, true);
    deliver({ release: destroy => releases.push(destroy) });
    await jest.advanceTimersByTimeAsync(1);
    blocked(await running);
    assert.deepEqual(releases, [true]);
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); }
});

test('query timeout fails closed, destroys connection and never queues a late commit', async () => {
  let resume;
  const pool = poolFor(async sql => {
    if (/FROM public.event_dead_letters/.test(sql)) await new Promise(resolve => { resume = resolve; });
  });
  jest.useFakeTimers();
  try {
    let settled = false;
    const running = record({ pool }).then(value => { settled = true; return value; });
    await jest.advanceTimersByTimeAsync(15001);
    assert.equal(settled, true);
    resume(); await jest.advanceTimersByTimeAsync(1);
    blocked(await running);
    assert.equal(releases.at(-1), true);
    assert(!queries.some(q => /INSERT|COMMIT|ROLLBACK/.test(q.text)));
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); await db.exec('ROLLBACK'); }
});
