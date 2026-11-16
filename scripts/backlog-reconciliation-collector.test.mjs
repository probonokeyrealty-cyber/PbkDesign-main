import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const AT = '2026-11-16T10:00:00Z';
const LATER = '2026-11-16T11:00:00Z';
const SECRET = randomBytes(32).toString('hex');
const TEXT = 'Seller private transcript: roof repairs and a callback after reviewing the cash offer. '.repeat(3).trim();
const QA_BREAKDOWN = Object.freeze({ painProbe: 8, objectionHandling: 18, offerPresentation: 20,
  nextStep: 6, toneRapport: 15 });
const VECTOR = JSON.stringify(Array.from({ length: 1536 }, (_, i) => i === 0 ? 0.5 : 0));
const TABLES = ['provider_action_dispatches', 'approvals', 'event_dead_letters', 'pbk_call_qa_scores', 'call_embeddings'];
let db;
let module;
let queries;
let releases;

beforeAll(async () => {
  module = await import('./backlog-reconciliation-collector.mjs').catch(error => {
    if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) return {};
    throw error;
  });
  db = new PGlite();
  // PGlite has no vector extension installed: text mirrors pgvector's to_jsonb wire value.
  await db.exec(`CREATE TABLE provider_action_dispatches (
      approval_id text PRIMARY KEY, workspace_id text DEFAULT 'pbk', tool_name text DEFAULT 'sendSms',
      binding_hash text DEFAULT '', attempt_token uuid DEFAULT '00000000-0000-4000-8000-000000000001',
      status text DEFAULT 'reconciliation_required', result jsonb DEFAULT '{}', error text DEFAULT '',
      dispatch_started_at timestamptz, completed_at timestamptz, reconciliation_required_at timestamptz,
      created_at timestamptz, updated_at timestamptz);
    CREATE TABLE approvals (id text PRIMARY KEY, workspace_id text DEFAULT 'pbk', type text DEFAULT 'offer',
      status text DEFAULT 'pending', lead_id text, contract_id text, requested_by text DEFAULT 'Rex',
      summary text DEFAULT '', risk text DEFAULT 'medium', payload jsonb DEFAULT '{}',
      decided_at timestamptz, created_at timestamptz, updated_at timestamptz);
    CREATE TABLE event_dead_letters (id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', event_id text,
      event_type text DEFAULT 'call.completed', source text DEFAULT 'telnyx-deepgram-finalize',
      payload jsonb DEFAULT '{}', error text DEFAULT '', stack text DEFAULT '', created_at timestamptz);
    CREATE TABLE pbk_call_qa_scores (id text PRIMARY KEY, tenant_id text DEFAULT 'pbk', lead_id text DEFAULT '',
      call_id text DEFAULT '', agent_name text DEFAULT 'Ava', score numeric DEFAULT 75, grade text DEFAULT 'B',
      breakdown jsonb DEFAULT '{}', weaknesses jsonb DEFAULT '[]', next_actions jsonb DEFAULT '[]',
      transcript_snippet text DEFAULT '', metadata jsonb DEFAULT '{}', created_at timestamptz);
    CREATE TABLE call_embeddings (id text PRIMARY KEY, workspace_id text DEFAULT 'pbk', call_id text DEFAULT '',
      lead_id text DEFAULT '', outcome text DEFAULT 'unknown', sentiment numeric, source_text text DEFAULT '',
      transcript_hash text DEFAULT '', embedding_model text DEFAULT 'text-embedding-3-small',
      embedding text, synthetic boolean DEFAULT false, metadata jsonb DEFAULT '{}',
      created_at timestamptz, updated_at timestamptz);
  `);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE ${TABLES.join(', ')}`);
  queries = [];
  releases = [];
});

function poolFor(intercept) {
  return { async connect() {
    return { async query(config) {
      const text = typeof config === 'string' ? config : config.text;
      const values = config.values || [];
      queries.push({ text, values, timeout: config.query_timeout });
      return await intercept?.(text, values) ?? db.query(text, values);
    }, release(destroy) { releases.push(Boolean(destroy)); } };
  } };
}
async function collect(options = {}) {
  assert.equal(typeof module.collectBacklogReconciliation, 'function', 'Task 1 collector export missing');
  return module.collectBacklogReconciliation({ pool: poolFor(), secret: SECRET, now: NOW, ...options });
}
function validate(value) {
  assert.equal(typeof module.validateBacklogReconciliation, 'function', 'Task 1 validator export missing');
  return module.validateBacklogReconciliation(value);
}
async function snapshot(options) {
  const report = await collect(options);
  assert.equal(report.ok, true);
  assert.equal(validate(report.reconciliation), true);
  return report.reconciliation;
}
async function dead({ id = 'dead-private', event = 'event-private', call = 'call-private', text = TEXT,
  tenant = 'pbk', payload = { workspaceId: 'pbk', callId: call, transcript: `  ${text}  ` } } = {}) {
  await db.query(`INSERT INTO event_dead_letters(id,event_id,tenant_id,payload,error,stack,created_at)
    VALUES ($1,$2,$3,$4,'sensitive worker failure','private stack',$5)`, [id, event, tenant, JSON.stringify(payload), AT]);
}
async function qa({ id = 'call-qa-event-event-private', call = 'call-private', text = TEXT,
  tenant = 'pbk', at = LATER, score = 67, grade = 'C', breakdown = QA_BREAKDOWN } = {}) {
  await db.query(`INSERT INTO pbk_call_qa_scores(id,tenant_id,call_id,transcript_snippet,created_at,score,grade,breakdown)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [id, tenant, call, text, at, score, grade, JSON.stringify(breakdown)]);
}
async function memory({ id = 'memory-private', call = 'call-private', text = TEXT, hash = createHash('sha256').update(text).digest('hex'),
  tenant = 'pbk', embedding = VECTOR, synthetic = false } = {}) {
  await db.query(`INSERT INTO call_embeddings(id,workspace_id,call_id,source_text,transcript_hash,embedding,
    synthetic,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
  [id, tenant, call, text, hash, embedding, synthetic, LATER]);
}
async function dispatch({ id = 'approval-private', tenant = 'pbk', status = 'reconciliation_required', binding = 'original-binding' } = {}) {
  await db.query(`INSERT INTO provider_action_dispatches(approval_id,workspace_id,status,binding_hash,result,error,
    dispatch_started_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'sensitive dispatch error',$6,$6,$6)`,
  [id, tenant, status, binding, JSON.stringify({ providerProof: { verified: true, id: 'provider-private' } }), AT]);
}
async function approval(status = 'approved', tenant = 'pbk') {
  await db.query(`INSERT INTO approvals(id,workspace_id,status,payload,created_at,updated_at)
    VALUES ('approval-private',$1,$2,'{"phone":"+15555550199","name":"Private Seller"}',$3,$3)`, [tenant, status, AT]);
}
function noSnapshot(report) {
  assert.equal(report.ok, false);
  assert.equal(report.reconciliation, null);
  assert.equal(typeof report.result, 'string');
  assert(!/private|sensitive|15555550199/.test(JSON.stringify(report)));
}

test('exports strict boolean validator', () => {
  assert.equal(validate(null), false);
});
test('exports collector and strict boolean validator; empty snapshot has exact guards/counts', async () => {
  const value = await snapshot();
  assert.deepEqual(value.counts, { dispatchesLocked: 0, deadLettersOpen: 0, qaRecovered: 0,
    qaUnverified: 0, memoryVerified: 0, memoryUnverified: 0 });
  assert.deepEqual(Object.keys(value).sort(), ['sourceFingerprint', 'complete', 'noContact',
    'providerWritesBlocked', 'counts', 'dispatches', 'deadLetters'].sort());
  assert.equal(value.complete, true);
  assert.equal(value.noContact, true);
  assert.equal(value.providerWritesBlocked, true);
});

test('actual SQL reads one repeatable-read read-only transaction, then rolls back and releases', async () => {
  await snapshot();
  assert.match(queries[0].text, /^BEGIN.*REPEATABLE READ.*READ ONLY$/i);
  assert.equal(queries.at(-1).text, 'ROLLBACK');
  assert.deepEqual(releases, [false]);
  assert.equal((await db.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
  for (const q of queries) {
    assert(q.timeout > 0 && q.timeout <= 2000);
    assert(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|COMMIT)\b/i.test(q.text));
  }
});

test('exact deterministic QA and real memory prove only partial internal recovery, never closure', async () => {
  await dead(); await qa(); await memory(); await dispatch(); await approval();
  const value = await snapshot();
  assert.deepEqual(value.counts, { dispatchesLocked: 1, deadLettersOpen: 1, qaRecovered: 1,
    qaUnverified: 0, memoryVerified: 1, memoryUnverified: 0 });
  assert.deepEqual(value.deadLetters.map(({ qa, memory, status, fullRecovery }) => ({ qa, memory, status, fullRecovery })),
    [{ qa: 'verified', memory: 'verified', status: 'review_required', fullRecovery: 'unverified' }]);
  assert.deepEqual(value.dispatches.map(({ status, deliveryProof, binding, approval }) => ({ status, deliveryProof, binding, approval })),
    [{ status: 'manual_review_locked', deliveryProof: 'unverified', binding: 'present', approval: 'approved' }]);
  assert(!/private|sensitive|15555550199|Seller|providerProof|transcript/.test(JSON.stringify(value)));
  for (const row of [...value.deadLetters, ...value.dispatches]) {
    assert.match(row.recordRef, /^[a-f0-9]{64}$/);
    assert.match(row.sourceBinding, /^[a-f0-9]{64}$/);
  }
});

test.each(['approved', 'pending', 'denied', null])('approval %s and fake inline provider proof keep dispatch locked', async status => {
  await dispatch();
  if (status) await approval(status);
  const value = await snapshot();
  assert.equal(value.dispatches[0].approval, status === null ? 'missing' : ['approved', 'pending'].includes(status) ? status : 'other');
  assert.equal(value.dispatches[0].status, 'manual_review_locked');
  assert.equal(value.dispatches[0].deliveryProof, 'unverified');
});

test('missing binding remains missing; completed and foreign dispatches/approvals are excluded', async () => {
  await dispatch({ binding: '' }); await approval('approved', 'foreign');
  await dispatch({ id: 'completed', status: 'completed' });
  await dispatch({ id: 'foreign', tenant: 'foreign' });
  const value = await snapshot();
  assert.equal(value.dispatches.length, 1);
  assert.equal(value.dispatches[0].binding, 'missing');
  assert.equal(value.dispatches[0].approval, 'missing');
});

test.each([
  ['similar id', { id: 'call-qa-event-event-private-extra' }],
  ['wrong call', { call: 'call-private-extra' }],
  ['foreign scope', { tenant: 'foreign' }],
  ['different transcript', { text: `${TEXT} changed` }],
  ['future timestamp', { at: '2026-11-17T12:00:00Z' }],
  ['missing timestamp', { at: null }],
])('QA %s cannot verify original', async (_name, options) => {
  await dead(); await qa(options);
  const value = await snapshot();
  assert.equal(value.deadLetters[0].qa, 'unverified');
  assert.equal(value.counts.qaUnverified, 1);
});

test.each([
  ['NULL score', { score: null }],
  ['NaN score', { score: 'NaN' }],
  ['positive infinite score', { score: 'Infinity' }],
  ['negative infinite score', { score: '-Infinity' }],
  ['negative score', { score: -1 }],
  ['score over 100', { score: 101 }],
  ['NULL grade', { grade: null }],
  ['empty grade', { grade: '' }],
  ['whitespace grade', { grade: ' ' }],
  ['unsupported grade', { grade: 'passed' }],
  ['wrong grade case', { grade: 'c' }],
  ['grade inconsistent with score', { grade: 'A' }],
  ['NULL breakdown', { breakdown: null }],
  ['empty placeholder breakdown', { breakdown: {} }],
  ['array breakdown', { breakdown: [] }],
  ['string breakdown', { breakdown: 'completed' }],
  ['all-zero placeholder breakdown', { score: 0, grade: 'needs_coaching',
    breakdown: { painProbe: 0, objectionHandling: 0, offerPresentation: 0, nextStep: 0, toneRapport: 0 } }],
  ['missing breakdown field', { breakdown: { painProbe: 8, objectionHandling: 18, offerPresentation: 20, nextStep: 6 } }],
  ['unexpected breakdown field', { breakdown: { ...QA_BREAKDOWN, completed: true } }],
  ['NULL component', { breakdown: { ...QA_BREAKDOWN, painProbe: null } }],
  ['string component', { breakdown: { ...QA_BREAKDOWN, painProbe: '8' } }],
  ['component never emitted by scorer', { score: 68, breakdown: { ...QA_BREAKDOWN, painProbe: 9 } }],
  ['valid components with wrong total', { score: 68 }],
])('QA completed scoring rejects %s despite exact original binding', async (_name, options) => {
  await dead(); await qa(options);
  const value = await snapshot();
  assert.equal(value.deadLetters[0].qa, 'unverified');
  assert.equal(value.deadLetters[0].status, 'review_required');
  assert.equal(value.counts.qaRecovered, 0);
  assert.equal(value.counts.qaUnverified, 1);
});

test.each([
  [36, 'needs_coaching', { painProbe: 8, objectionHandling: 10, offerPresentation: 7, nextStep: 6, toneRapport: 5 }],
  [59, 'needs_coaching', { painProbe: 8, objectionHandling: 10, offerPresentation: 20, nextStep: 6, toneRapport: 15 }],
  [60, 'C', { painProbe: 8, objectionHandling: 10, offerPresentation: 7, nextStep: 20, toneRapport: 15 }],
  [71, 'C', { painProbe: 8, objectionHandling: 18, offerPresentation: 20, nextStep: 20, toneRapport: 5 }],
  [72, 'B', { painProbe: 20, objectionHandling: 10, offerPresentation: 7, nextStep: 20, toneRapport: 15 }],
  [83, 'B', { painProbe: 20, objectionHandling: 18, offerPresentation: 20, nextStep: 20, toneRapport: 5 }],
  [85, 'A', { painProbe: 20, objectionHandling: 10, offerPresentation: 20, nextStep: 20, toneRapport: 15 }],
  [100, 'A', { painProbe: 20, objectionHandling: 25, offerPresentation: 20, nextStep: 20, toneRapport: 15 }],
])('QA completed scoring accepts scorer total %s with grade %s without a quality gate', async (score, grade, breakdown) => {
  await dead(); await qa({ score, grade, breakdown });
  const value = await snapshot();
  assert.equal(value.deadLetters[0].qa, 'verified');
  assert.equal(value.counts.qaRecovered, 1);
  assert.equal(value.deadLetters[0].fullRecovery, 'unverified');
});

test('QA default placeholder receipt is not completed scoring evidence', async () => {
  await dead();
  await db.query(`INSERT INTO pbk_call_qa_scores(id,call_id,transcript_snippet,created_at)
    VALUES ('call-qa-event-event-private','call-private',$1,$2)`, [TEXT, LATER]);
  const value = await snapshot();
  assert.equal(value.counts.qaRecovered, 0);
  assert.equal(value.counts.qaUnverified, 1);
});

test('QA scoring invalidation changes keyed evidence and never exposes scoring payloads', async () => {
  await dead(); await qa();
  const before = await snapshot();
  assert.equal(before.counts.qaRecovered, 1);
  await db.exec("UPDATE pbk_call_qa_scores SET breakdown = '{}'");
  const after = await snapshot();
  assert.equal(after.counts.qaRecovered, 0);
  assert.notEqual(after.sourceFingerprint, before.sourceFingerprint);
  assert.notEqual(after.deadLetters[0].sourceBinding, before.deadLetters[0].sourceBinding);
  assert(!/score|grade|breakdown|painProbe|private/.test(JSON.stringify(after)));
});

test('a matching 2000-character snippet cannot prove a longer original', async () => {
  const text = 'x'.repeat(2001);
  await dead({ text }); await qa({ text: text.slice(0, 2000) });
  assert.equal((await snapshot()).deadLetters[0].qa, 'unverified');
});
test('even an inserted full QA snippet cannot prove an original exceeding 2000 JS characters', async () => {
  const text = 'x'.repeat(2001);
  await dead({ text }); await qa({ text });
  assert.equal((await snapshot()).deadLetters[0].qa, 'unverified');
});
test('QA boundary counts JS characters, not Unicode code points', async () => {
  const text = String.fromCodePoint(0x1f600).repeat(1001);
  await dead({ text }); await qa({ text });
  assert.equal((await snapshot()).deadLetters[0].qa, 'unverified');
});
test('an exact full 2000-character original can be proven without inferring omitted work', async () => {
  const text = 'x'.repeat(2000);
  await dead({ text }); await qa({ text });
  const row = (await snapshot()).deadLetters[0];
  assert.equal(row.qa, 'verified');
  assert.equal(row.memory, 'unverified');
});

test.each([
  ['no explicit scope', { callId: 'call-private', transcript: TEXT }],
  ['foreign scope', { workspaceId: 'foreign', callId: 'call-private', transcript: TEXT }],
  ['conflicting scope', { workspaceId: 'pbk', workspace_id: 'foreign', callId: 'call-private', transcript: TEXT }],
  ['nonstring call', { workspaceId: 'pbk', callId: 123, transcript: TEXT }],
  ['empty call', { workspaceId: 'pbk', callId: ' ', transcript: TEXT }],
  ['conflicting call', { workspaceId: 'pbk', callId: 'call-private', call_id: 'other', transcript: TEXT }],
  ['empty transcript', { workspaceId: 'pbk', callId: 'call-private', transcript: ' ' }],
  ['nonstring transcript', { workspaceId: 'pbk', callId: 'call-private', transcript: 123 }],
  ['synthetic original', { workspaceId: 'pbk', callId: 'call-private', transcript: TEXT, synthetic: true }],
])('%s leaves QA and memory unverified', async (_name, payload) => {
  await dead({ payload }); await qa(); await memory();
  const row = (await snapshot()).deadLetters[0];
  assert.equal(row.qa, 'unverified');
  assert.equal(row.memory, 'unverified');
});

test.each(['source', 'event_type', 'event_id'])('unsupported original %s cannot prove recovery', async field => {
  await dead(); await qa(); await memory();
  await db.query(`UPDATE event_dead_letters SET ${field} = $1`, [field === 'event_id' ? '' : 'unsupported']);
  const row = (await snapshot()).deadLetters[0];
  assert.equal(row.qa, 'unverified');
  assert.equal(row.memory, 'unverified');
});

test('production recording source and snake-case identities are supported', async () => {
  await dead({ payload: { workspace_id: 'pbk', call_id: 'call-private', transcript: TEXT } });
  await db.exec("UPDATE event_dead_letters SET source = 'telnyx-recording-capture'");
  await qa(); await memory();
  const row = (await snapshot()).deadLetters[0];
  assert.equal(row.qa, 'verified'); assert.equal(row.memory, 'verified');
});

test.each([
  ['foreign tenant', { tenant: 'foreign' }], ['wrong call', { call: 'other' }],
  ['wrong hash', { hash: '0'.repeat(64) }], ['wrong text with original hash', { text: 'different', hash: createHash('sha256').update(TEXT).digest('hex') }],
  ['missing embedding', { embedding: null }], ['zero vector', { embedding: JSON.stringify(Array(1536).fill(0)) }],
  ['synthetic embedding', { synthetic: true }],
])('memory %s remains unverified', async (_name, options) => {
  await dead(); await qa(); await memory(options);
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
});
test('short calls without memory are unverified, not inferred skipped', async () => {
  await dead({ text: 'Short call' }); await qa({ text: 'Short call' });
  const value = await snapshot();
  assert.equal(value.counts.memoryUnverified, 1);
  assert.equal(value.deadLetters[0].memory, 'unverified');
});
test('metadata synthetic evidence and future memory dates cannot prove memory', async () => {
  await dead(); await memory();
  await db.exec('UPDATE call_embeddings SET metadata = \'{"synthetic":true}\'');
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
  await db.exec("UPDATE call_embeddings SET metadata = '{}', updated_at = '2026-11-17T00:00:00Z'");
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
});
test.each([
  ['nested synthetic original', "UPDATE event_dead_letters SET payload = payload || '{\"metadata\":{\"synthetic\":true}}'"],
  ['ambiguous synthetic flag', "UPDATE call_embeddings SET metadata = '{\"synthetic\":\"true\"}'"],
  ['synthetic model', "UPDATE call_embeddings SET embedding_model = 'synthetic-test-model'"],
])('%s cannot prove real memory', async (_name, sql) => {
  await dead(); await memory(); await db.exec(sql);
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
});
test.each([
  ['real-model-latest', 'verified'],
  ['real-latest-v2', 'verified'],
  ['test-model', 'unverified'],
  ['fixture-model', 'unverified'],
  ['synthetic', 'unverified'],
  ['mock.embedding', 'unverified'],
  ['real-model-test', 'unverified'],
  ['real_fixture_model', 'unverified'],
  ['org/fixture/model', 'unverified'],
  ['org:MOCK:model', 'unverified'],
])('memory model name %s uses explicit delimited markers, not substrings', async (model, expected) => {
  await dead(); await memory();
  await db.query('UPDATE call_embeddings SET embedding_model = $1', [model]);
  assert.equal((await snapshot()).deadLetters[0].memory, expected);
});
test('a latest model alias never overrides explicit synthetic metadata', async () => {
  await dead(); await memory();
  await db.exec("UPDATE call_embeddings SET embedding_model = 'real-model-latest', metadata = '{\"synthetic\":true}'");
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
});
test.each(['[]', '[0.5]', '["0.5"]', 'private malformed vector'])('invalid vector %s cannot verify memory', async embedding => {
  await dead(); await memory({ embedding });
  assert.equal((await snapshot()).deadLetters[0].memory, 'unverified');
});
test.each([
  "UPDATE event_dead_letters SET created_at = NULL",
  "UPDATE event_dead_letters SET created_at = '2026-11-17T00:00:00Z'",
  "UPDATE event_dead_letters SET payload = '[]'",
  "UPDATE provider_action_dispatches SET updated_at = NULL",
  "UPDATE approvals SET updated_at = NULL",
])('malformed original cannot yield a usable snapshot: %s', async sql => {
  await dead(); await dispatch(); await approval(); await db.exec(sql);
  noSnapshot(await collect());
});
test('dispatching rows remain locked and proof changes update keyed bindings, not opaque record refs', async () => {
  await dispatch({ status: 'dispatching' }); await dead(); await qa(); await memory();
  const before = await snapshot();
  await db.exec("UPDATE provider_action_dispatches SET result = '{\"changed\":true}'; UPDATE call_embeddings SET outcome = 'changed'");
  const after = await snapshot();
  assert.equal(after.dispatches[0].status, 'manual_review_locked');
  assert.equal(after.dispatches[0].recordRef, before.dispatches[0].recordRef);
  assert.equal(after.deadLetters[0].recordRef, before.deadLetters[0].recordRef);
  assert.notEqual(after.dispatches[0].sourceBinding, before.dispatches[0].sourceBinding);
  assert.notEqual(after.deadLetters[0].sourceBinding, before.deadLetters[0].sourceBinding);
});

test.each([
  ['dispatch failure', "UPDATE provider_action_dispatches SET error = 'changed'"],
  ['dispatch result', "UPDATE provider_action_dispatches SET result = '{\"changed\":true}'"],
  ['dispatch timestamp', `UPDATE provider_action_dispatches SET updated_at = '${LATER}'`],
  ['approval payload', "UPDATE approvals SET payload = '{\"changed\":true}'"],
  ['approval timestamp', `UPDATE approvals SET updated_at = '${LATER}'`],
  ['original payload', "UPDATE event_dead_letters SET payload = payload || '{\"changed\":true}'"],
  ['original failure', "UPDATE event_dead_letters SET error = 'changed', stack = 'changed'"],
  ['QA content', "UPDATE pbk_call_qa_scores SET weaknesses = '[\"changed\"]'"],
  ['QA timestamp', `UPDATE pbk_call_qa_scores SET created_at = '${AT}'`],
  ['memory metadata', "UPDATE call_embeddings SET metadata = '{\"changed\":true}'"],
  ['memory timestamp', `UPDATE call_embeddings SET updated_at = '${AT}'`],
  ['memory vector', "UPDATE call_embeddings SET embedding = ('[1,' || repeat('0,',1534) || '0]')"],
])('global fingerprint binds %s even when counts remain unchanged', async (_name, sql) => {
  await dispatch(); await approval(); await dead(); await qa(); await memory();
  const before = await snapshot();
  await db.exec(sql);
  const after = await snapshot();
  assert.notEqual(after.sourceFingerprint, before.sourceFingerprint);
});
test('fingerprint is deterministic, canonical, secret-keyed and binds unverified proof rows', async () => {
  await dead(); await qa({ text: 'wrong text' }); await memory({ hash: 'wrong hash' });
  const first = await snapshot();
  assert.deepEqual(await snapshot(), first);
  await db.exec("UPDATE event_dead_letters SET payload = jsonb_build_object('transcript', payload->'transcript', 'callId', payload->'callId', 'workspaceId', 'pbk')");
  assert.deepEqual(await snapshot(), first);
  const otherKey = await snapshot({ secret: randomBytes(32).toString('hex') });
  assert.notEqual(otherKey.sourceFingerprint, first.sourceFingerprint);
  assert.notEqual(otherKey.deadLetters[0].recordRef, first.deadLetters[0].recordRef);
  await db.exec("UPDATE pbk_call_qa_scores SET grade = 'changed'");
  assert.notEqual((await snapshot()).sourceFingerprint, first.sourceFingerprint);
  const second = await snapshot();
  await db.exec("UPDATE call_embeddings SET metadata = '{\"failure\":\"sensitive failure\"}'");
  assert.notEqual((await snapshot()).sourceFingerprint, second.sourceFingerprint);
});
test('foreign rows and unrelated proof rows cannot affect the PBK snapshot', async () => {
  await dead(); const before = await snapshot();
  await dead({ id: 'foreign', event: 'foreign', tenant: 'foreign' });
  await qa({ tenant: 'foreign' }); await memory({ tenant: 'foreign' });
  await qa({ id: 'unrelated', call: 'unrelated' }); await memory({ id: 'unrelated', call: 'unrelated' });
  assert.deepEqual(await snapshot(), before);
});

test.each(TABLES)('missing table %s fails closed, redacts errors, and rolls back', async table => {
  await dead();
  await db.exec(`ALTER TABLE ${table} RENAME TO hidden_source`);
  try { noSnapshot(await collect()); assert.equal(queries.at(-1).text, 'ROLLBACK'); assert.deepEqual(releases, [true]); }
  finally { await db.exec(`ALTER TABLE hidden_source RENAME TO ${table}`); }
});
test.each(['dispatches', 'deadLetters', 'memory'])('%s reads 64 plus overflow, not an incomplete snapshot', async kind => {
  if (kind === 'dispatches') {
    for (let i = 0; i < 64; i++) await dispatch({ id: `a-${i}` });
  } else if (kind === 'deadLetters') {
    for (let i = 0; i < 64; i++) await dead({ id: `d-${i}`, event: `e-${i}` });
  } else {
    await dead();
    for (let i = 0; i < 64; i++) {
      await memory({ id: `m-${i}` });
    }
  }
  await snapshot();
  if (kind === 'dispatches') await dispatch({ id: 'overflow' });
  else if (kind === 'deadLetters') await dead({ id: 'overflow', event: 'overflow' });
  else await memory({ id: 'overflow' });
  noSnapshot(await collect());
});
test('64 exact QA receipts are bounded; unrelated same-call receipts cannot overflow collection', async () => {
  for (let i = 0; i < 64; i++) {
    await dead({ id: `d-${i}`, event: `e-${i}` });
    await qa({ id: `call-qa-event-e-${i}` });
  }
  for (let i = 0; i < 65; i++) await qa({ id: `unrelated-${i}` });
  const value = await snapshot();
  assert.equal(value.counts.qaRecovered, 64);
  const before = value.sourceFingerprint;
  await db.exec("UPDATE pbk_call_qa_scores SET grade = 'changed' WHERE id LIKE 'unrelated-%'");
  assert.equal((await snapshot()).sourceFingerprint, before);
  assert.match(queries.find(q => /FROM public.pbk_call_qa_scores/.test(q.text)).text, /LIMIT 65/i);
});
test('defensive QA row overflow fails closed even if a driver returns more than the exact-id bound', async () => {
  await dead(); await qa();
  noSnapshot(await collect({ pool: poolFor(async (text, values) => {
    if (!/FROM public.pbk_call_qa_scores/.test(text)) return;
    const result = await db.query(text, values);
    return { ...result, rows: Array(65).fill(result.rows[0]) };
  }) }));
});
test.each([
  ['dispatch', 'provider_action_dispatches', 'original', "UPDATE provider_action_dispatches SET result = jsonb_build_object('private', repeat('x',65537))"],
  ['approval', 'provider_action_dispatches', 'approval', "UPDATE approvals SET payload = jsonb_build_object('private', repeat('x',65537))"],
  ['dead letter', 'event_dead_letters', 'original', "UPDATE event_dead_letters SET payload = payload || jsonb_build_object('private', repeat('x',65537))"],
  ['QA', 'pbk_call_qa_scores', 'proof', "UPDATE pbk_call_qa_scores SET metadata = jsonb_build_object('private', repeat('x',65537))"],
  ['memory', 'call_embeddings', 'proof', "UPDATE call_embeddings SET metadata = jsonb_build_object('private', repeat('x',65537))"],
])('oversized %s rows never cross the SQL boundary as raw JSON', async (_name, table, field, sql) => {
  await dispatch(); await approval(); await dead(); await qa(); await memory(); await db.exec(sql);
  let inspected = false;
  noSnapshot(await collect({ pool: poolFor(async (text, values) => {
    if (!text.includes(`FROM public.${table}`)) return;
    const result = await db.query(text, values);
    assert.equal(result.rows[0][field], null);
    assert(result.rows[0][`${field}Bytes`] > 65536);
    inspected = true;
    return result;
  }) }));
  assert.equal(inspected, true);
});

test.each([undefined, '', 123, null])('invalid secret %s cannot acquire a connection', async secret => {
  noSnapshot(await collect({ secret })); assert.equal(queries.length, 0);
});
test.each([NaN, Infinity, -1, '2026-11-16', null])('invalid clock %s cannot collect', async now => {
  noSnapshot(await collect({ now })); assert.equal(queries.length, 0);
});
test('invalid query result shape fails closed rather than constructing empty evidence', async () => {
  noSnapshot(await collect({ pool: poolFor(text => /SELECT/.test(text) ? { rows: null } : undefined) }));
});
test('SQL failure and failed rollback never return a usable snapshot', async () => {
  noSnapshot(await collect({ pool: poolFor(text => {
    if (/SELECT|ROLLBACK/.test(text)) throw new Error('sensitive private failure');
  }) }));
  await db.exec('ROLLBACK');
  assert.deepEqual(releases, [true]);
});
test('the database itself rejects a write inside the collector transaction', async () => {
  await dead();
  let denied = false;
  await snapshot({ pool: poolFor(async text => {
    if (!/FROM public.event_dead_letters/.test(text)) return;
    await assert.rejects(db.query("DELETE FROM event_dead_letters"), error => {
      denied = error.code === '25006'; return denied;
    });
    await db.exec('ROLLBACK');
    // Restart read-only after deliberately aborting this disposable test transaction.
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  }) });
  assert.equal(denied, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM event_dead_letters')).rows[0].n, 1);
});

test('bounded checkout destroys a client that arrives after the deadline', async () => {
  assert.equal(typeof module.collectBacklogReconciliation, 'function', 'Task 1 collector export missing');
  jest.useFakeTimers();
  let deliver;
  const late = [];
  try {
    const pending = collect({ pool: { connect: () => new Promise(resolve => { deliver = resolve; }) } });
    await jest.advanceTimersByTimeAsync(16000);
    noSnapshot(await pending);
    deliver({ release(destroy) { late.push(destroy); } });
    await jest.advanceTimersByTimeAsync(0);
    assert.deepEqual(late, [true]);
  } finally { jest.useRealTimers(); }
});
test('bounded hung SELECT and rollback destroy the client and contain late rejection', async () => {
  assert.equal(typeof module.collectBacklogReconciliation, 'function', 'Task 1 collector export missing');
  jest.useFakeTimers();
  let rejectLate;
  const calls = [];
  const released = [];
  try {
    const pending = collect({ pool: { async connect() { return {
      query({ text }) {
        calls.push(text);
        if (/SELECT/.test(text)) return new Promise((_, reject) => { rejectLate = reject; });
        if (text === 'ROLLBACK') return new Promise(() => {});
        return Promise.resolve({ rows: [] });
      }, release(destroy) { released.push(destroy); },
    }; } } });
    await jest.advanceTimersByTimeAsync(16000);
    noSnapshot(await pending);
    assert(calls.includes('ROLLBACK'));
    assert.deepEqual(released, [true]);
    rejectLate(new Error('private late query error'));
    await jest.advanceTimersByTimeAsync(0);
  } finally { jest.useRealTimers(); }
});

test('strict validator rejects unknown keys, invalid enums/counts, duplicates and broken guards', async () => {
  await dead(); await qa(); await memory(); await dispatch();
  const valid = await snapshot();
  const mutations = [
    v => { v.extra = 'private'; }, v => { delete v.complete; },
    v => { v.complete = false; }, v => { v.noContact = false; }, v => { v.providerWritesBlocked = false; },
    v => { v.sourceFingerprint = 'x'.repeat(64); }, v => { v.sourceFingerprint = 'A'.repeat(64); },
    v => { v.counts.extra = 0; }, v => { v.counts.qaRecovered = 0; }, v => { v.counts.memoryUnverified = 1; },
    v => { v.counts.dispatchesLocked = '1'; }, v => { v.counts.deadLettersOpen = -1; },
    v => { v.counts.qaUnverified = NaN; }, v => { v.dispatches[0].status = 'completed'; },
    v => { v.dispatches[0].deliveryProof = 'verified'; }, v => { v.dispatches[0].approval = 'rejected'; },
    v => { v.dispatches[0].binding = 'unknown'; }, v => { v.dispatches[0].raw = 'private'; },
    v => { v.dispatches[0].recordRef = 'raw-id'; }, v => { v.deadLetters[0].sourceBinding = null; },
    v => { v.deadLetters[0].status = 'closed'; }, v => { v.deadLetters[0].qa = 'skipped'; },
    v => { v.deadLetters[0].memory = 'skipped'; }, v => { v.deadLetters[0].fullRecovery = 'verified'; },
    v => { v.deadLetters[0].raw = 'private'; }, v => { v.deadLetters.push(v.deadLetters[0]); v.counts.deadLettersOpen++;
      v.counts.qaRecovered++; v.counts.memoryVerified++; },
    v => { v.dispatches = Array(65).fill(v.dispatches[0]); v.counts.dispatchesLocked = 65; },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(JSON.stringify(valid));
    assert.equal(validate(value), true, 'untampered JSON clone must validate before mutation');
    mutate(value);
    assert.equal(validate(value), false, mutate.toString());
  }
  for (const value of [null, [], 0, true, {}, 'private']) assert.equal(validate(value), false);
});
test('strict validator rejects non-JSON shapes and does not invoke getters', async () => {
  await dead();
  const valid = await snapshot();
  const nonenumerable = JSON.parse(JSON.stringify(valid));
  Object.defineProperty(nonenumerable, 'complete', { value: true, enumerable: false });
  assert.equal(validate(nonenumerable), false);
  const getter = JSON.parse(JSON.stringify(valid));
  let invoked = false;
  Object.defineProperty(getter.deadLetters, '0', { get() { invoked = true; return valid.deadLetters[0]; } });
  assert.equal(validate(getter), false);
  assert.equal(invoked, false);
  const symbolic = JSON.parse(JSON.stringify(valid));
  symbolic[Symbol('private')] = 'private';
  assert.equal(validate(symbolic), false);
  const sparse = JSON.parse(JSON.stringify(valid));
  delete sparse.deadLetters[0];
  assert.equal(validate(sparse), false);
  assert.equal(validate(new Proxy({}, { ownKeys() { throw new Error('private'); } })), false);
});
