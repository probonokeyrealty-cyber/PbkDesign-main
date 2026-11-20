import assert from 'node:assert/strict';
import test from 'node:test';
import { seedInvestorQaLead, QA_LEAD_ID, QA_WORKSPACE_ID } from './lib/investor-qa-fixture-seed.mjs';
import { createInvestorQaStagingSource } from './lib/investor-qa-staging-source.mjs';

const now = Date.parse('2026-11-20T18:30:00Z');
const database = 'pbk_composio_staging';
const role = 'pbk_composio_staging_user';
const env = {
  RENDER_SERVICE_ID: 'srv-dbvk7tv40ujc73e0d8gg',
  PBK_DATABASE_URL: `postgresql://${role}@dpg-dc010uei0phs73bd3ohg-a/${database}`,
  PBK_INVESTOR_QA_SEED_UNTIL: String(now + 60_000),
};
const run = (getPool, overrides = {}) =>
  seedInvestorQaLead({ env: { ...env, ...overrides }, getPool, now: () => now });

test('unarmed, expired, and other-service seeds never connect', async () => {
  for (const overrides of [
    { PBK_INVESTOR_QA_SEED_UNTIL: undefined },
    { PBK_INVESTOR_QA_SEED_UNTIL: String(now) },
    { PBK_INVESTOR_QA_SEED_UNTIL: String(now + 3_600_001) },
    { RENDER_SERVICE_ID: 'other-service' },
  ]) {
    assert.equal(await run(() => assert.fail('Unexpected connection'), overrides), null);
  }
  assert.equal((await run(() => assert.fail('Unexpected connection'), {
    PBK_DATABASE_URL: `postgresql://${role}@wrong-host/${database}`,
  })).reason, 'staging_target_mismatch');
});

test('database identity is checked before any write, even after hostname pinning', async () => {
  const statements = [];
  const result = await run(() => ({ connect: async () => ({
    async query(sql) {
      statements.push(sql);
      return { rows: [{ database: 'other', role }] };
    },
    release() {},
  }) }));
  assert.equal(result.reason, 'staging_target_mismatch');
  assert.ok(statements.every(sql => !/INSERT/i.test(sql)));
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('a conflicting non-fixture lead is never overwritten', async () => {
  const statements = [];
  const result = await run(() => ({ connect: async () => ({
    async query(sql) {
      statements.push(sql);
      return { rows: /current_database/.test(sql) ? [{ database, role }] : [] };
    },
    release() {},
  }) }));
  assert.equal(result.reason, 'fixture_id_conflict');
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.ok(statements.every(sql => !/DO UPDATE/i.test(sql)));
});

test('local Postgres saves one isolated fixture and then verifies the exact revision read-only', {
  skip: !process.env.PBK_INVESTOR_QA_LOCAL_TEST_PORT,
}, async () => {
  const port = Number(process.env.PBK_INVESTOR_QA_LOCAL_TEST_PORT);
  assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
  const { default: { Pool } } = await import('pg');
  const pool = new Pool({ host: '127.0.0.1', port, database, user: role,
    password: 'local-test-only', max: 2, connectionTimeoutMillis: 3000 });
  try {
    await pool.query(`CREATE TABLE public.lead_profiles (
      id text PRIMARY KEY, workspace_id text NOT NULL, source text, status text, stage text,
      lead_name text, dnc boolean, dnc_reason text, updated_at timestamptz DEFAULT NOW(),
      address text, city text, state text, postal_code text, phone text, email text, raw jsonb
    )`);
    const attempts = await Promise.all([run(() => pool), run(() => pool)]);
    assert.equal(attempts.filter(x => x.created === true).length, 1);
    assert.equal(attempts.filter(x => x.created === false && x.saved === true).length, 1);
    const sql = 'SELECT id, workspace_id, dnc, phone, email, updated_at::text FROM public.lead_profiles';
    const before = (await pool.query(sql)).rows;
    assert.equal(before.length, 1);
    assert.deepEqual({ ...before[0], updated_at: undefined }, {
      id: QA_LEAD_ID, workspace_id: QA_WORKSPACE_ID, dnc: true, phone: '', email: '', updated_at: undefined,
    });
    const source = createInvestorQaStagingSource({
      env: { ...env, PBK_INVESTOR_QA_DISCOVERY_UNTIL: String(now + 60_000) },
      getPool: () => pool, now: () => now,
    });
    const proof = await source.discover();
    assert.equal(proof.verified, true);
    assert.equal(proof.leadId, QA_LEAD_ID);
    assert.match(proof.revision, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    assert.deepEqual((await pool.query(sql)).rows, before);
  } finally {
    await pool.end();
  }
});
