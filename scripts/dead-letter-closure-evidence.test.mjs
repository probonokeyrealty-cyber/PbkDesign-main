import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, beforeEach, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { closureBinding, createClosureIntent, validateClosureManifest } from './dead-letter-closure-protocol.mjs';
import { recordCallMemorySkip } from './call-memory-outcome-store.mjs';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const AT = '2026-11-17T10:00:00.000Z';
const PROOF = '2026-11-17T11:00:00.000Z';
const secret = randomBytes(32).toString('hex');
const revision = 'a'.repeat(40);
const TEXT = 'The seller described the property and requested another conversation. '.repeat(2).trim();
let mod = {};
let db;
let queries;
const tables = ['event_dead_letters', 'calls', 'pbk_call_qa_scores', 'call_embeddings', 'pbk_eval_runs'];

function fixture(text = TEXT) {
  return { original: { id: 'dead-private', tenant_id: 'pbk', event_id: 'event-private',
    event_type: 'call.completed', source: 'telnyx-deepgram-finalize',
    payload: { workspaceId: 'pbk', callId: 'call-private', transcript: text },
    error: 'private failure', stack: 'private stack', created_at: AT }, calls: [],
  qa: [{ id: 'call-qa-event-event-private', tenant_id: 'pbk', call_id: 'call-private',
    score: 54, grade: 'needs_coaching',
    breakdown: { painProbe: 8, objectionHandling: 18, offerPresentation: 7, nextStep: 6, toneRapport: 15 },
    transcript_snippet: text.trim(), metadata: {}, created_at: PROOF }],
  memory: [{ id: 'memory-private', workspace_id: 'pbk', call_id: 'call-private', source_text: text,
    transcript_hash: createHash('sha256').update(text).digest('hex'), synthetic: false,
    embedding_model: 'text-embedding-3-small', embedding: JSON.stringify([0.5, ...Array(1535).fill(0)]),
    metadata: {}, created_at: PROOF, updated_at: PROOF }], skipReceipt: null, secret, revision, now: NOW };
}
function api(name) { assert.equal(typeof mod[name], 'function', `${name} new evidence interface missing`); return mod[name]; }
function check(f = fixture()) { return api('verifyDeadLetterHandlerEvidence')(f); }
function guards(r) {
  assert.equal(r.noContact, true); assert.equal(r.providerWritesBlocked, true);
  assert.equal(r.deliveryRetries, false); assert.equal(r.providerDeliveryVerified, false);
  assert.equal(r.launchQualified, false);
  assert(!/private|seller described|failure|stack/.test(JSON.stringify(r)));
}
function denied(r, reason) {
  guards(r); assert.equal(r.eligible, false); assert.equal(r.manifest, null);
  if (reason) assert(r.reasons.includes(reason), JSON.stringify(r));
}
beforeAll(async () => {
  mod = await import('./dead-letter-closure-evidence.mjs').catch(e => {
    if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(e.code)) return {}; throw e;
  });
  db = new PGlite();
  await db.exec(readFileSync(new URL('../supabase/migrations/20260529014000_pbk_eval_safety.sql', import.meta.url), 'utf8'));
  await db.exec(`CREATE TABLE event_dead_letters(id text PRIMARY KEY,tenant_id text,event_id text,event_type text,
    source text,payload jsonb,error text,stack text,created_at timestamptz);
    CREATE TABLE calls(id text PRIMARY KEY,workspace_id text,provider text,telnyx_call_control_id text,
    telnyx_call_leg_id text,telnyx_call_session_id text,transcript jsonb,notes text,metadata jsonb,
    synthetic boolean,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE pbk_call_qa_scores(id text,tenant_id text,call_id text,score numeric,grade text,
    breakdown jsonb,transcript_snippet text,metadata jsonb,created_at timestamptz);
    CREATE TABLE call_embeddings(id text,workspace_id text,call_id text,source_text text,transcript_hash text,
    synthetic boolean,embedding_model text,embedding text,metadata jsonb,created_at timestamptz,updated_at timestamptz);`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec(`TRUNCATE ${tables.join(',')}`); queries = []; });
async function seed(f = fixture()) {
  for (const [table, rows] of [['event_dead_letters', [f.original]], ['calls', f.calls],
    ['pbk_call_qa_scores', f.qa], ['call_embeddings', f.memory]]) {
    for (const row of rows) {
      const keys = Object.keys(row);
      await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
        keys.map(k => row[k] && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]));
    }
  }
}
async function query(text, values) {
  queries.push({ text, values });
  assert.match(text, /^SELECT\b/);
  assert(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT|BEGIN|ROLLBACK)\b/i.test(text));
  assert.match(text, /LIMIT 65|SELECT EXISTS/);
  return db.query(text, values);
}
function collect(options = {}) {
  return api('collectDeadLetterClosureEvidence')({ query, secret, revision, now: NOW, ...options });
}
async function fingerprint() {
  const rows = [];
  for (const t of tables) rows.push((await db.query(`SELECT to_jsonb(t) AS row FROM ${t} t ORDER BY id`)).rows);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function signedSkip(f) {
  await seed(f);
  const pool = { connect: async () => ({ query: c => db.query(c.text, c.values), release() {} }) };
  const r = await recordCallMemorySkip({ pool, secret, revision, now: NOW, eventId: f.original.event_id,
    callId: f.original.payload.callId, sourceText: f.original.payload.transcript });
  assert.equal(r.verified, true);
  // Reload all JSON source rows exactly as the existing writer bound them.
  f.original = (await db.query('SELECT to_jsonb(d) AS row FROM event_dead_letters d')).rows[0].row;
  f.calls = (await db.query('SELECT to_jsonb(c) AS row FROM calls c')).rows.map(r => r.row);
  f.skipReceipt = (await db.query(`SELECT to_jsonb(r) || jsonb_build_object('created_at_exact',
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS row FROM pbk_eval_runs r`)).rows[0].row;
}

test('complete embedding evidence eligible, protocol signing accepts exact applicability binding', () => {
  const f = fixture(); const before = JSON.stringify(f); const r = check(f); guards(r);
  assert.equal(r.eligible, true); assert.equal(r.verified, true); assert.deepEqual(r.reasons, []);
  assert.equal(validateClosureManifest(r.manifest), true);
  assert.deepEqual(r.manifest.steps.map(s => [s.id, s.outcome, s.executedAt]),
    [['qa', 'completed', PROOF], ['memory', 'completed', PROOF], ['scriptOutcome', 'not_applicable', null]]);
  assert.equal(createClosureIntent({ approvalId: 'approval-test', action: 'close_internal', recordRef: r.recordRef,
    manifest: r.manifest, predecessor: null, secret, revision, createdAt: new Date(NOW).toISOString() }).recordRef, r.recordRef);
  assert.equal(JSON.stringify(f), before);
});
test('short source without executed skip blocked even with a claimed embedding', () => {
  const f = fixture('A short source.'); denied(check(f), 'memory_skip_unverified');
});
test('canonical longer than event rejects skip and requires current canonical embedding', async () => {
  const f = fixture('A short source.'); f.memory = []; await signedSkip(f);
  f.calls = [{ id: 'canonical-private', workspace_id: 'pbk', provider: 'telnyx',
    telnyx_call_control_id: 'call-private', transcript: [], notes: TEXT, metadata: {},
    created_at: AT, updated_at: AT }];
  denied(check(f), 'memory_unverified');
  f.memory = fixture().memory;
  assert.equal(check(f).eligible, true, 'QA remains bound to the short event, not canonical text');
});
test('genuine signed skip accepted then stale rejected, collection never mints evidence', async () => {
  const f = fixture('Please call back after lunch.'); f.memory = []; await signedSkip(f);
  const before = await fingerprint(); const r = check(f);
  assert.equal(r.eligible, true); assert.equal(r.manifest.steps[1].outcome, 'skipped_short_source');
  assert.equal(r.manifest.steps[1].executedAt, new Date(NOW).toISOString());
  const collected = await collect(); assert.equal(collected.cases[0].eligible, true);
  denied(check({ ...f, now: NOW + 86400000 }), 'memory_skip_unverified');
  assert.equal(await fingerprint(), before);
});
test.each([{ scriptId: 'script-one' }, { script_id: 'script-one' }, { contextAwareScript: { id: 'script-one' } },
  { scriptId: 0 }, { scriptId: false }, { contextAwareScript: [] },
  { scriptId: 'one', script_id: 'two' }])('script selector always blocks v1: %j', selectors => {
  const f = fixture(); Object.assign(f.original.payload, selectors); denied(check(f), 'script_proof_unsupported');
});
test.each([{ call_id: 'another' }, { workspace_id: 'other' }, { tenantId: 'other' },
  { transcriptText: 'different' }])('contradictory aliases blocked: %j', aliases => {
  const f = fixture(); Object.assign(f.original.payload, aliases); denied(check(f), 'source_unverified');
});
test('low valid QA is completion not quality pass', () => {
  const r = check(); assert.equal(r.eligible, true);
  assert.equal(r.manifest.steps[0].outcome, 'completed');
  assert(!/qualityPass|score|grade|fullRecovery/.test(JSON.stringify(r)));
});
test('event transcript alias feeds memory but never substitutes for the actual empty QA input', () => {
  const f = fixture(); f.original.payload.transcriptText = TEXT; delete f.original.payload.transcript;
  f.qa[0].transcript_snippet = '';
  assert.equal(check(f).eligible, true);
  f.qa[0].transcript_snippet = TEXT;
  denied(check(f), 'qa_unverified');
});
test.each(['original', 'qa', 'memory', 'precision', 'canonical'])('changed %s invalidates manifest binding', part => {
  const f = fixture(); const first = check(f).manifest;
  if (part === 'original') f.original.error = 'changed';
  if (part === 'qa') f.qa[0].metadata.note = 'changed';
  if (part === 'memory') f.memory[0].metadata.note = 'changed';
  if (part === 'precision') f.memory[0].updated_at = '2026-11-17T11:00:00.000001Z';
  if (part === 'canonical') f.calls = [{ id: 'call-private', workspace_id: 'pbk', provider: 'telnyx',
    notes: '', transcript: [], created_at: AT, updated_at: AT, metadata: {} }];
  const next = check(f); assert.equal(next.eligible, true);
  assert.notEqual(closureBinding(secret, 'manifest', first), closureBinding(secret, 'manifest', next.manifest));
  assert.equal(next.manifest.steps[1].executedAt, PROOF);
});
test.each(['zero', 'dimension', 'hash', 'synthetic', 'model', 'source', 'future', 'order', 'qa-grade', 'qa-input'])('invalid artifact denies: %s', mode => {
  const f = fixture(); const m = f.memory[0];
  if (mode === 'zero') m.embedding = JSON.stringify(Array(1536).fill(0));
  if (mode === 'dimension') m.embedding = '[0.5]';
  if (mode === 'hash') m.transcript_hash = 'a'.repeat(64);
  if (mode === 'synthetic') m.synthetic = true;
  if (mode === 'model') m.embedding_model = 'mock-model';
  if (mode === 'source') m.source_text = 'invented';
  if (mode === 'future') m.updated_at = '2026-11-17T12:00:00.000001Z';
  if (mode === 'order') m.updated_at = AT;
  if (mode === 'qa-grade') f.qa[0].grade = 'A';
  if (mode === 'qa-input') f.qa[0].transcript_snippet = 'wrong';
  denied(check(f));
});
test('ambiguous canonical aliases cannot arbitrarily pick a source', () => {
  const f = fixture(); const c = { id: 'call-private', workspace_id: 'pbk', provider: 'telnyx',
    notes: '', transcript: [], created_at: AT, updated_at: AT };
  f.calls = [c, { ...c, id: 'second-private', telnyx_call_leg_id: 'call-private' }];
  denied(check(f), 'source_ambiguous');
});
test('bounded SELECT collection preserves fixture fingerprint, keyed selection and raw privacy', async () => {
  await seed(); const before = await fingerprint(); const r = await collect(); guards(r);
  assert.equal(r.ok, true); assert.deepEqual(r.counts, { cases: 1, eligible: 1, blocked: 0 });
  assert.equal(r.cases[0].eligible, true);
  assert.equal((await collect({ recordRefs: [r.cases[0].recordRef] })).cases.length, 1);
  assert.equal((await collect({ recordRefs: ['f'.repeat(64)] })).cases.length, 0);
  assert.equal(await fingerprint(), before);
  assert(queries.every(q => !/private/.test(q.text)));
});
test.each(['original-count', 'original-bytes', 'calls', 'qa', 'memory', 'skip'])('65th row or oversize denies all: %s', async mode => {
  const f = fixture();
  if (mode === 'original-bytes') f.original.error = 'x'.repeat(65537);
  await seed(f);
  if (mode === 'original-count') for (let i = 0; i < 64; i++) {
    const f2 = fixture(); f2.original.id = `dead-${i}`; f2.original.event_id = `event-${i}`;
    f2.qa = []; f2.memory = []; await seed(f2);
  }
  const result = await collect({ query: async (text, values) => {
    const table = { calls: 'public.calls c WHERE', qa: 'public.pbk_call_qa_scores q WHERE',
      memory: 'public.call_embeddings e WHERE', skip: 'public.pbk_eval_runs r WHERE' }[mode];
    if (table && text.includes(table) && !text.startsWith('SELECT EXISTS')) {
      return { rows: Array.from({ length: 65 }, () => ({ bytes: 1, original: {} })) };
    }
    return query(text, values);
  } });
  assert.equal(result.ok, false); assert.equal(result.counts, null); assert.deepEqual(result.cases, []); guards(result);
});
test.each(['call', 'qa', 'memory', 'skip', 'original-event', 'duplicate-event'])('foreign collision or duplicate event unavailable: %s', async mode => {
  await seed();
  if (mode === 'call') await db.exec(`INSERT INTO calls(id,workspace_id) VALUES ('call-private','other')`);
  if (mode === 'qa') await db.exec(`INSERT INTO pbk_call_qa_scores(id,tenant_id) VALUES ('call-qa-event-event-private','other')`);
  if (mode === 'memory') await db.exec(`INSERT INTO call_embeddings(id,call_id,workspace_id) VALUES ('foreign','call-private','other')`);
  if (mode === 'original-event') {
    const f = fixture(); f.original.id = 'foreign-original'; f.original.tenant_id = 'other';
    f.qa = []; f.memory = []; await seed(f);
  }
  if (mode === 'skip') {
    const f = fixture('Please call back after lunch.'); f.memory = [];
    await db.exec(`TRUNCATE ${tables.join(',')}`); await signedSkip(f);
    await db.exec(`UPDATE pbk_eval_runs SET tenant_id='other'`);
  }
  if (mode === 'duplicate-event') {
    const f = fixture(); f.original.id = 'duplicate-private'; f.qa = []; f.memory = []; await seed(f);
  }
  const r = await collect(); assert.equal(r.ok, false); assert.equal(r.counts, null); guards(r);
});
test('original binding is independent of observation time; missing artifact stays an explicit blocked case', async () => {
  const f = fixture();
  const first = check(f);
  assert.deepEqual(check({ ...f, now: NOW + 1000 }).manifest, first.manifest);
  f.memory = []; await seed(f);
  const r = await collect();
  assert.equal(r.ok, true); assert.equal(r.verified, false);
  assert.deepEqual(r.counts, { cases: 1, eligible: 0, blocked: 1 });
  denied(r.cases[0], 'memory_unverified');
});
test.each(['leap-day', 'future-original', 'excluded', 'nested-fixture', 'qa-long-input', 'two-proofs'])('unsupported source cannot close: %s', mode => {
  const f = fixture();
  if (mode === 'leap-day') f.original.created_at = '2026-02-29T11:00:00.000Z';
  if (mode === 'future-original') f.original.created_at = '2026-11-17T12:00:00.000001Z';
  if (mode === 'excluded') f.original.payload.callId = 'call-diane-live';
  if (mode === 'nested-fixture') f.original.payload.metadata = { metadata: { fixture: true } };
  if (mode === 'qa-long-input') f.original.payload.transcript = 'x'.repeat(2001);
  if (mode === 'two-proofs') f.memory.push({ ...f.memory[0], id: 'second-memory-private' });
  denied(check(f));
});
test('transport/schema failure sanitized, no partial cases', async () => {
  for (const query of [async () => { throw new Error('private database URL'); }, async () => ({ rows: null })]) {
    const r = await collect({ query }); assert.equal(r.ok, false); assert.equal(r.counts, null); guards(r);
  }
});
test('query deadline stops collection and does not queue late reads', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  const scheduled = jest.spyOn(globalThis, 'setTimeout');
  const cleared = jest.spyOn(globalThis, 'clearTimeout');
  try {
    let calls = 0; let resume;
    const pending = collect({ query: () => { calls++; return new Promise(r => { resume = r; }); } });
    await jest.advanceTimersByTimeAsync(2001);
    const r = await pending; assert.equal(r.ok, false); assert.equal(r.counts, null);
    resume({ rows: [] }); await jest.advanceTimersByTimeAsync(1);
    assert.equal(calls, 1);
    const ownTimers = scheduled.mock.calls.flatMap((args, i) => args[1] === 2000 ? [scheduled.mock.results[i].value] : []);
    assert.equal(ownTimers.length, 1);
    assert(ownTimers.every(handle => cleared.mock.calls.some(args => args[0] === handle)));
  } finally { scheduled.mockRestore(); cleared.mockRestore(); jest.useRealTimers(); }
});
test('shared collection deadline includes synchronous source-processing time', async () => {
  await seed();
  const responses = [];
  await collect({ query: async (text, values) => {
    const r = await query(text, values); responses.push(r); return r;
  } });
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
  let clock;
  try {
    let reads = 0;
    const start = performance.now();
    const running = collect({ query: async () => {
      await new Promise(r => setTimeout(r, 1900));
      // Simulate synchronous work consuming the remaining budget, not a slow query.
      if (reads === 5) clock = jest.spyOn(performance, 'now').mockReturnValue(start + 15001);
      return responses[reads++];
    } });
    await jest.advanceTimersByTimeAsync(12000);
    const r = await running;
    assert.equal(r.ok, false); assert.equal(r.result, 'collection_timeout');
    assert.equal(r.counts, null); assert.deepEqual(r.cases, []);
    assert.equal(reads, 6);
  } finally { clock?.mockRestore(); jest.useRealTimers(); }
});
test('canonical provider alias SQL selects current source; a later source change blocks its embedding', async () => {
  const f = fixture('Short event.');
  f.calls = [{ id: 'canonical-private', workspace_id: 'pbk', provider: 'telnyx',
    telnyx_call_session_id: 'call-private', transcript: [], notes: TEXT, metadata: {}, synthetic: false,
    created_at: AT, updated_at: PROOF }];
  f.memory = fixture().memory;
  await seed(f);
  const before = await fingerprint();
  assert.equal((await collect()).cases[0].eligible, true);
  assert.equal(await fingerprint(), before);
  await db.query('UPDATE calls SET notes=$1', [TEXT + ' A changed note.']);
  denied((await collect()).cases[0], 'memory_unverified');
});
test.each(['calls', 'qa', 'memory', 'skip'])('oversize %s source denies whole collection', async table => {
  await seed();
  const result = await collect({ query: async (sql, values) => {
    const marker = { calls: 'public.calls c WHERE', qa: 'public.pbk_call_qa_scores q WHERE',
      memory: 'public.call_embeddings e WHERE', skip: 'public.pbk_eval_runs r WHERE' }[table];
    return sql.includes(marker) && !sql.startsWith('SELECT EXISTS')
      ? { rows: [{ bytes: 65537, original: null }] } : query(sql, values);
  } });
  assert.equal(result.ok, false); assert.equal(result.counts, null); assert.deepEqual(result.cases, []);
});
test('unselected 65th original still denies collection; recordRefs never bypass global boundary', async () => {
  const ref = check().recordRef;
  const r = await collect({ recordRefs: [ref], query: async () => ({ rows: Array(65).fill({}) }) });
  assert.equal(r.ok, false); assert.equal(r.result, 'source_overflow');
});
test('collection rejects missing schema fields rather than certifying a partial snapshot', async () => {
  await seed();
  const r = await collect({ query: async (sql, values) => {
    if (sql.includes('FROM public.call_embeddings e WHERE') && !sql.startsWith('SELECT EXISTS')) {
      return { rows: [{ bytes: 30, original: { id: 'memory-private', workspace_id: 'pbk', call_id: 'call-private' } }] };
    }
    return query(sql, values);
  } });
  assert.equal(r.ok, false); assert.equal(r.counts, null); assert.deepEqual(r.cases, []);
});
test('report byte overflow denies all 64 complete cases', async () => {
  for (let i = 0; i < 64; i++) {
    const f = fixture();
    f.original.id = `dead-${i}`; f.original.event_id = `event-${i}`;
    f.original.payload.callId = `call-${i}`;
    f.qa[0].id = `call-qa-event-event-${i}`; f.qa[0].call_id = `call-${i}`;
    f.memory[0].id = `memory-${i}`; f.memory[0].call_id = `call-${i}`;
    await seed(f);
  }
  const r = await collect();
  assert.equal(r.ok, false); assert.equal(r.result, 'report_overflow');
  assert.equal(r.counts, null); assert.deepEqual(r.cases, []);
});
test('hostile inputs are denied without getters/proxies executing', () => {
  let reads = 0; const f = fixture();
  Object.defineProperty(f.original, 'danger', { enumerable: true, get() { reads++; throw new Error('private'); } });
  denied(check(f)); assert.equal(reads, 0);
  f.original = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('private'); } });
  denied(check(f)); assert.equal(reads, 0);
});
test('runtime evidence import graph excludes writers, worker, startup, network and execution', async () => {
  const source = readFileSync(new URL('./dead-letter-closure-evidence.mjs', import.meta.url), 'utf8');
  const linked = [];
  const entry = new vm.SourceTextModule(source);
  await entry.link(async (specifier) => {
    linked.push(specifier);
    assert(!/worker|openclaw-local|backlog|child_process|https?|fetch/.test(specifier));
    const actual = await import(specifier.startsWith('.') ? new URL(specifier, import.meta.url).href : specifier);
    const exports = Object.keys(actual).filter(k => k !== 'recordCallMemorySkip');
    return new vm.SyntheticModule(exports, function () { for (const key of exports) this.setExport(key, actual[key]); });
  });
  await entry.evaluate();
  assert(linked.length > 0);
});
