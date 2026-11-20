import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { createInvestorQaStagingSource } from './lib/investor-qa-staging-source.mjs';

const now = Date.parse('2026-11-20T17:40:00Z');
const token = 'isolated-fixture-token-for-this-test-only';
const selection = { accountId: 'qa-workspace', leadId: 'qa-sample-1', revision: '2026-11-20T17:39:00.123456Z' };
const request = { staffUid: 'qa-user', ...selection };
const identity = { database: 'pbk_composio_staging', role: 'pbk_composio_staging_user' };
const row = {
  ...selection, address: 'Fictional QA Lane', city: 'Example City', state: 'CA', zip: '00123',
  checkedAt: '2026-11-20', assetType: 'Single-family', askingPrice: 195000,
  raw: { private: 'not a response field' }, email: 'excluded@example.invalid',
};
const env = {
  RENDER_SERVICE_ID: 'srv-dbvk7tv40ujc73e0d8gg',
  PBK_INVESTOR_QA_SOURCE_TOKEN: token,
  PBK_INVESTOR_QA_SOURCE_GRANT: JSON.stringify({ ...request, expiresAt: now + 60_000 }),
  PBK_INVESTOR_QA_DISCOVERY_UNTIL: String(now + 60_000),
};

function fixture(overrides = {}, records = [row], database = identity) {
  const calls = [];
  let released = 0;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/current_database\(\)/.test(sql)) return { rows: [database] };
      if (/ORDER BY id/.test(sql)) return { rows: records.map(({ accountId, leadId, revision }) => ({ accountId, leadId, revision })) };
      if (/FROM public.lead_profiles/.test(sql)) return { rows: records };
      return { rows: [] };
    },
    release() { released++; },
  };
  const source = createInvestorQaStagingSource({
    env: { ...env, ...overrides },
    getPool: () => ({ connect: async () => client }), now: () => now,
  });
  return { source, calls, get released() { return released; } };
}
const req = (body = request, headers = {}) => Object.assign(
  Readable.from([Buffer.from(JSON.stringify(body))]),
  { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers } },
);

test('all operation is off outside the fixed staging service and outside its explicit configuration', async () => {
  for (const overrides of [
    { RENDER_SERVICE_ID: 'other-service' },
    { PBK_INVESTOR_QA_SOURCE_TOKEN: undefined, PBK_INVESTOR_QA_DISCOVERY_UNTIL: undefined },
    { PBK_INVESTOR_QA_SOURCE_GRANT: JSON.stringify({ ...request, expiresAt: now }), PBK_INVESTOR_QA_DISCOVERY_UNTIL: String(now) },
  ]) {
    const { source, calls } = fixture(overrides);
    assert.equal((await source.handle(req())).status, 404);
    assert.equal(await source.discover(), null);
    assert.deepEqual(calls, []);
  }
});

test('unauthorized or mismatched scope never reaches Postgres', async () => {
  const { source, calls } = fixture();
  assert.equal((await source.handle(req(undefined, { authorization: 'Bearer wrong' }))).status, 401);
  assert.equal((await source.handle(req(undefined, { origin: 'https://browser.example' }))).status, 404);
  for (const field of ['staffUid', 'accountId', 'leadId', 'revision']) {
    assert.equal((await source.handle(req({ ...request, [field]: 'wrong' }))).status, 404);
  }
  assert.deepEqual(calls, []);
});

test('the scoped lookup checks the dedicated DB, exact revision, and exposes only packet facts', async () => {
  const qa = fixture();
  const { source, calls } = qa;
  const reply = await source.handle(req());
  assert.equal(reply.status, 200);
  assert.equal(reply.body.record.revision, selection.revision);
  assert.equal(reply.body.record.fictional, true);
  assert.equal(reply.body.record.askingCents, 19_500_000);
  assert.doesNotMatch(JSON.stringify(reply.body), /private|excluded@example|raw/);
  assert.equal(calls[0].sql, 'BEGIN READ ONLY');
  const query = calls.find(call => /FROM public.lead_profiles/.test(call.sql));
  assert.deepEqual(query.values, [selection.accountId, selection.leadId, selection.revision]);
  assert.match(query.sql, /fictional/);
  assert.doesNotMatch(calls.map(call => call.sql).join('\n'), /\b(?:insert|update|delete|alter|create)\b/i);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.equal(qa.released, 1);
});

test('missing, stale, or wrong DB cannot be verified', async () => {
  assert.equal((await fixture({}, []).source.handle(req())).status, 404);
  assert.equal((await fixture({}, [{ ...row, revision: 'stale' }]).source.handle(req())).status, 404);
  const wrongDb = fixture({}, [row], { ...identity, database: 'other' });
  assert.equal((await wrongDb.source.handle(req())).status, 503);
  assert.ok(!wrongDb.calls.some(call => /FROM public.lead_profiles/.test(call.sql)));
  assert.equal(wrongDb.calls.at(-1).sql, 'ROLLBACK');
});

test('deployment discovery only emits a verified QA tuple after the same stored read', async () => {
  const { source, calls } = fixture({ PBK_INVESTOR_QA_SOURCE_TOKEN: undefined });
  assert.deepEqual(await source.discover(), { verified: true, ...selection });
  assert.ok(calls.find(call => /ORDER BY id/.test(call.sql)));
  assert.deepEqual(calls.find(call => /FROM public.lead_profiles/.test(call.sql) && call.values?.length === 3).values,
    [selection.accountId, selection.leadId, selection.revision]);
  assert.deepEqual(await fixture({}, []).source.discover(), { verified: false, reason: 'no_eligible_existing_qa_lead' });
});

test('reads an existing synthetic revision from disposable loopback Postgres', {
  skip: !process.env.PBK_INVESTOR_QA_LOCAL_TEST_PORT,
}, async () => {
  const port = Number(process.env.PBK_INVESTOR_QA_LOCAL_TEST_PORT);
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
  const { default: { Pool } } = await import('pg');
  const pool = new Pool({ host: '127.0.0.1', port, database: identity.database,
    user: identity.role, password: 'local-test-only', connectionTimeoutMillis: 3000 });
  try {
    await pool.query(`CREATE TABLE public.lead_profiles (
      workspace_id text, id text PRIMARY KEY, updated_at timestamptz, address text,
      city text, state text, postal_code text, phone text, email text, raw jsonb
    )`);
    await pool.query(`INSERT INTO public.lead_profiles VALUES
      ($1, $2, $3, $4, $5, $6, $7, '', '', '{"fictional":true,"property":{"type":"Single-family","askingPrice":195000}}'),
      ($1, 'qa-ignore-me', $3, $4, $5, $6, $7, 'excluded', '', '{"fictional":true}')`,
    [selection.accountId, selection.leadId, selection.revision, row.address, row.city, row.state, row.zip]);
    const source = createInvestorQaStagingSource({ env, getPool: () => pool, now: () => now });
    assert.deepEqual(await source.discover(), { verified: true, ...selection });
    assert.equal((await source.handle(req())).body.record?.revision, selection.revision);
    await pool.query("UPDATE public.lead_profiles SET updated_at = updated_at + interval '1 microsecond' WHERE id = $1", [selection.leadId]);
    assert.equal((await source.handle(req())).status, 404);
  } finally {
    await pool.end();
  }
});
