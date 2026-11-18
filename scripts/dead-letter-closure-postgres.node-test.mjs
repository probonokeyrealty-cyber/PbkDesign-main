import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import pg from 'pg';
import {
  validateClosureMigrationConfig, applyDeadLetterClosureMigration, verifyDeadLetterClosureInstallation,
} from './dead-letter-closure-migration.mjs';
import { captureDeadLetterAuditBoundary, executeDeadLetterClosure, readDeadLetterClosures,
  verifyDeadLetterClosureReference } from './dead-letter-closure-store.mjs';
import { CLOSURE_SOURCE_FIXTURE_SQL, seedClosureSources, seedClosureApproval,
  closureTestAuthority, closureHead } from './fixtures/dead-letter-closure-store-fixture.mjs';

const fingerprint = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

// No provisioning, remote branch, ambient URL or service startup. The controller
// must supply a pre-created, generated empty loopback DB for an explicit local run.
export function validateLocalClosurePostgresTestConfig(env = {}) {
  if (env.PBK_CLOSURE_PG_TEST_ENABLE !== '1') throw new Error('Explicit closure local Postgres test opt-in required');
  const config = validateClosureMigrationConfig(env);
  if (!['127.0.0.1', '[::1]'].includes(config.host)
    || !/^pbk_closure_test_[a-f0-9]{32}$/.test(config.expectedDatabase)) {
    throw new Error('Closure Postgres tests require loopback IP and generated disposable database');
  }
  return config;
}

const CLOSURE_EMPTY_DATABASE_SQL = `SELECT (
  (SELECT count(*) FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_namespace n
    ON d.refclassid='pg_catalog.pg_namespace'::pg_catalog.regclass AND d.refobjid=n.oid
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') +
  (SELECT count(*) FROM pg_catalog.pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema','public')) +
  (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')
)::text AS objects`;

const testEnv = {
  PBK_CLOSURE_PG_TEST_ENABLE: '1', PBK_CLOSURE_MIGRATION_TARGET: 'local',
  PBK_CLOSURE_MIGRATION_EXPECT_HOST: '127.0.0.1',
  PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: `pbk_closure_test_${'a'.repeat(32)}`,
  PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'closure_test_owner',
  PBK_CLOSURE_MIGRATION_DATABASE_URL: `postgres://closure_test_owner:fixture-only@127.0.0.1/pbk_closure_test_${'a'.repeat(32)}`,
};

test('real-PG guard requires dedicated explicit opt-in and ignores ambient database URLs', () => {
  assert.throws(() => validateLocalClosurePostgresTestConfig({}), /opt-in/);
  assert.throws(() => validateLocalClosurePostgresTestConfig({ PBK_CLOSURE_PG_TEST_ENABLE: '1', DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL }), /PBK_CLOSURE_MIGRATION/);
  assert.equal(validateLocalClosurePostgresTestConfig(testEnv).expectedRole, 'closure_test_owner');
});

test('real-PG guard rejects remote hosts, named databases, overrides and mismatched identities', () => {
  for (const changes of [
    { PBK_CLOSURE_MIGRATION_TARGET: 'production' },
    { PBK_CLOSURE_MIGRATION_EXPECT_HOST: 'remote.invalid', PBK_CLOSURE_MIGRATION_DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL.replace('127.0.0.1', 'remote.invalid') },
    { PBK_CLOSURE_MIGRATION_EXPECT_HOST: 'localhost', PBK_CLOSURE_MIGRATION_DATABASE_URL: testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL.replace('127.0.0.1', 'localhost') },
    { PBK_CLOSURE_MIGRATION_EXPECT_DATABASE: 'postgres', PBK_CLOSURE_MIGRATION_DATABASE_URL: 'postgres://closure_test_owner:fixture-only@127.0.0.1/postgres' },
    { PBK_CLOSURE_MIGRATION_DATABASE_URL: `${testEnv.PBK_CLOSURE_MIGRATION_DATABASE_URL}?host=remote.invalid` },
    { PBK_CLOSURE_MIGRATION_EXPECT_ROLE: 'wrong' },
  ]) assert.throws(() => validateLocalClosurePostgresTestConfig({ ...testEnv, ...changes }));
});

test('empty-database preflight detects standalone schema objects (local PGlite guard test only)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const empty = async () => (await db.query(CLOSURE_EMPTY_DATABASE_SQL)).rows[0].objects === '0';
  try {
    assert.equal(await empty(), true);
    for (const ddl of ["CREATE TYPE public.fixture_type AS ENUM ('fixture')",
      'CREATE TABLE public.fixture_table(id text)', 'CREATE SCHEMA fixture_schema',
      'CREATE FUNCTION public.fixture_function() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$']) {
      await db.exec('BEGIN');
      try { await db.exec(ddl); assert.equal(await empty(), false, ddl); }
      finally { await db.exec('ROLLBACK'); }
    }
  } finally { await db.close(); }
});

test('guarded real Postgres schema and store (native max:1 and two-client races)', {
  skip: Object.hasOwn(process.env, 'PBK_CLOSURE_PG_TEST_ENABLE') ? false
    : 'Real PostgreSQL unavailable/not opted in; no replica or concurrent-transaction proof claimed',
  timeout: 120000,
}, async t => {
  const config = validateLocalClosurePostgresTestConfig(process.env);
  const expectedHost = config.host.replace(/^\[|\]$/g, '');
  let externalAttempts = 0, senderAttempts = 0;
  const connect = net.Socket.prototype.connect;
  const fetch = globalThis.fetch;
  const senders = [http.request, http.get, https.request, https.get];
  net.Socket.prototype.connect = function (...args) {
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof normalized[0] === 'object' ? normalized[0]
      : { port: normalized[0], host: normalized[1] };
    if (!options || typeof options !== 'object' || options.host !== expectedHost || Number(options.port) !== config.port) {
      externalAttempts++; throw new Error('Native proof denied unexpected network connection');
    }
    return connect.apply(this, args);
  };
  const denySender = () => { senderAttempts++; throw new Error('Native proof denied provider sender access'); };
  globalThis.fetch = http.request = http.get = https.request = https.get = denySender;
  t.after(() => {
    net.Socket.prototype.connect = connect;
    globalThis.fetch = fetch;
    [http.request, http.get, https.request, https.get] = senders;
    assert.equal(externalAttempts, 0); assert.equal(senderAttempts, 0);
    t.diagnostic('network observer: zero external connections; zero HTTP/provider sender accesses');
  });
  const url = new URL(config.databaseUrl);
  const client = new pg.Client({ host: config.host.replace(/^\[|\]$/g, ''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 2000, query_timeout: 2000,
    options: '-c search_path=pg_catalog,pg_temp -c statement_timeout=2000',
    application_name: 'pbk-closure-local-schema-test' });
  let installed = false;
  const query = client.query.bind(client);
  try {
    await client.connect();
    const connected = (await query(`SELECT current_database() AS database,current_user AS role,
      (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) AS privileged`)).rows[0];
    assert.equal(connected.database, config.expectedDatabase);
    assert.equal(connected.role, config.expectedRole);
    assert.equal(connected.privileged, false, 'existing trusted test owner must not be superuser/BYPASSRLS');
    const empty = (await query(CLOSURE_EMPTY_DATABASE_SQL)).rows[0];
    assert.equal(empty.objects, '0', 'refuse any nonempty test database before schema changes');
    assert.equal((await applyDeadLetterClosureMigration(client, config)).ok, true);
    installed = true;
    assert.equal((await applyDeadLetterClosureMigration(client, config)).ok, true);
    const installation = await verifyDeadLetterClosureInstallation(query);
    assert.equal(installation.verified, true);
    assert.equal(installation.ownerDdlTrusted, true);
    for (const sql of ['UPDATE public.pbk_dead_letter_closure_ledger SET id=id',
      'DELETE FROM public.pbk_dead_letter_closure_ledger', 'TRUNCATE public.pbk_dead_letter_closure_ledger']) {
      await assert.rejects(query(sql), /immutable/);
    }
    await t.test('native ALWAYS trigger rejects update/delete/truncate in replica mode', async () => {
      await query("SET session_replication_role='replica'");
      try {
        for (const sql of ['UPDATE public.pbk_dead_letter_closure_ledger SET id=id',
          'DELETE FROM public.pbk_dead_letter_closure_ledger', 'TRUNCATE public.pbk_dead_letter_closure_ledger']) {
          await assert.rejects(query(sql), /immutable/);
        }
      } finally { await query("SET session_replication_role='origin'"); }
    });
    await query('BEGIN');
    try {
      await query('DROP TRIGGER pbk_closure_immutable ON public.pbk_dead_letter_closure_ledger');
      assert.equal((await verifyDeadLetterClosureInstallation(query)).ok, false);
    } finally { await query('ROLLBACK'); }
    assert.equal((await verifyDeadLetterClosureInstallation(query)).ok, true);
    await t.test('native exact installation verifier detects owner DDL and privilege drift', async () => {
      for (const ddl of [
        'ALTER TABLE public.pbk_dead_letter_closure_ledger DISABLE ROW LEVEL SECURITY',
        'ALTER TABLE public.pbk_dead_letter_closure_ledger DISABLE TRIGGER pbk_closure_immutable',
        'GRANT SELECT (id) ON public.pbk_dead_letter_closure_ledger TO PUBLIC',
        'ALTER TABLE public.pbk_dead_letter_closure_ledger ADD COLUMN unreviewed text',
        'ALTER TABLE public.pbk_dead_letter_closure_ledger DROP CONSTRAINT pbk_closure_xid_check',
      ]) {
        await query('BEGIN');
        try { await query(ddl); assert.equal((await verifyDeadLetterClosureInstallation(query)).verified, false, ddl); }
        finally { await query('ROLLBACK'); }
        assert.equal((await verifyDeadLetterClosureInstallation(query)).verified, true);
      }
    });
    // vector is not trusted: bootstrap only inside the owned disposable container,
    // AFTER both empty guard and migration, never grant superuser to fixture owner.
    assert(process.env.PBK_CLOSURE_TEST_VECTOR_ADMIN_PASSWORD, 'owned-container vector bootstrap required');
    const bootstrap = new pg.Client({ host: expectedHost, port: config.port, database: config.expectedDatabase,
      user: 'postgres', password: process.env.PBK_CLOSURE_TEST_VECTOR_ADMIN_PASSWORD, ssl: false,
      connectionTimeoutMillis: 2000, query_timeout: 2000 });
    try {
      await bootstrap.connect();
      assert.equal((await bootstrap.query('SELECT current_database() AS db')).rows[0].db, config.expectedDatabase);
      await bootstrap.query('CREATE EXTENSION vector WITH SCHEMA public');
    } finally { await bootstrap.end(); }
    await nativeStoreCoverage(t, config, query);
  } finally {
    try {
      if (installed) {
        const identity = (await query('SELECT current_database() AS database,current_user AS role')).rows[0];
        assert.equal(identity.database, config.expectedDatabase);
        assert.equal(identity.role, config.expectedRole);
        assert.match(identity.database, /^pbk_closure_test_[a-f0-9]{32}$/);
        await query('DROP TABLE public.pbk_dead_letter_closure_ledger');
        await query('DROP FUNCTION public.pbk_closure_reject_mutation()');
      }
    } finally { await client.end(); }
  }
});

// Only reached after the existing empty-disposable-DB/identity/owner guards.
async function nativeStoreCoverage(t, config, query) {
  const url = new URL(config.databaseUrl);
  const connection = { host: config.host.replace(/^\[|\]$/g, ''), port: config.port,
    database: config.expectedDatabase, user: config.expectedRole, password: decodeURIComponent(url.password),
    ssl: false, connectionTimeoutMillis: 2000, query_timeout: 2000,
    options: '-c search_path=pg_catalog,pg_temp -c statement_timeout=2000', application_name: 'pbk-closure-local-store-test' };
  const pool = new pg.Pool({ ...connection, max: 1 });
  const other = new pg.Pool({ ...connection, max: 1 });
  let bufferedResponses = 0, maximumDatabaseLeadMs = 0;
  // SQLSTATE/routine only: native failures must be diagnosable without row/SQL data.
  for (const base of [pool, other]) {
    base.on('connect', c => {
      const run = c.query.bind(c);
      c.query = async (...args) => {
        try {
          const result = await run(...args);
          const timestamp = result?.rows?.[0]?.admitted_at || result?.rows?.[0]?.database_captured_at;
          if (timestamp) {
            // Docker's clock can lead Windows by a few ms. Buffer the real response,
            // never edit its timestamp or weaken strict runtime/signature ordering.
            const delta = Date.parse(timestamp) - Date.now();
            const until = performance.now() + 100;
            while (Date.parse(timestamp) > Date.now() && performance.now() < until) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
            assert(Date.parse(timestamp) <= Date.now(), 'fixture clocks failed to converge within 100ms');
            if (delta > 0) bufferedResponses++;
            maximumDatabaseLeadMs = Math.max(maximumDatabaseLeadMs, delta);
          }
          return result;
        }
        catch (error) { t.diagnostic(`native SQL failure: ${error.code || 'client'} / ${error.routine || 'client'}`); throw error; }
      };
    });
  }
  const authority = closureTestAuthority();
  const ledgerRows = async () => (await query(`SELECT id,tenant_id,ordinal::text,
    to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at,
    insert_xid::text,record_ref,approval_ref,intent_binding,action,previous_id,report
    FROM public.pbk_dead_letter_closure_ledger ORDER BY ordinal`)).rows;
  const wrappedPool = (base, intercept) => ({ connect: async () => {
    const c = await base.connect();
    return { on: c.on.bind(c), removeListener: c.removeListener.bind(c), release: c.release.bind(c),
      query: async command => { await intercept(command); return c.query(command); } };
  } });
  let sourcesCreated = false;
  try {
    await query(CLOSURE_SOURCE_FIXTURE_SQL.replace('embedding text', 'embedding public.vector(1536)')); sourcesCreated = true;
    await query(`INSERT INTO public.provider_action_dispatches
      SELECT 'locked-'||n,jsonb_build_object('state','unknown','lane',n) FROM generate_series(2,6) n`);
    await seedClosureSources(query);
    assert.equal((await query('SELECT public.vector_dims(embedding) AS dimensions FROM public.call_embeddings')).rows[0].dimensions, 1536);
    assert.equal((await query(`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute
      WHERE attrelid='public.call_embeddings'::regclass AND attname='embedding'`)).rows[0].type, 'public.vector(1536)');
    const dispatchBefore = (await query('SELECT to_jsonb(d) AS row FROM public.provider_action_dispatches d ORDER BY id')).rows;
    const originalsBefore = (await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d ORDER BY id')).rows;
    let approval = await seedClosureApproval(query, authority);
    let closed;
    await t.test('native completion clock before database admission fails closed without append', async () => {
      let allocated = false;
      const writer = wrappedPool(pool, async command => {
        if (command.text.includes('AS admitted_at') && command.text.includes('nextval')) allocated = true;
      });
      const denied = await executeDeadLetterClosure({ pool: writer, ...authority, approvalId: approval.approvalId,
        now: () => Date.now() - (allocated ? 1000 : 0) });
      assert.equal(allocated, true); assert.equal(denied.verified, false); assert.equal(denied.counts, null);
      assert.equal((await ledgerRows()).length, 0);
    });
    await t.test('native pg.Result write and independent readback do not deadlock max:1', async () => {
      const before = (await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d')).rows;
      closed = await executeDeadLetterClosure({ pool, ...authority, approvalId: approval.approvalId });
      assert.equal(closed.verified, true, JSON.stringify(closed)); assert.equal(closed.counts.closedInternal, 1);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).verified, true);
      assert.equal(fingerprint((await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d')).rows), fingerprint(before));
      assert.equal(fingerprint((await query('SELECT to_jsonb(d) AS row FROM public.provider_action_dispatches d ORDER BY id')).rows), fingerprint(dispatchBefore));
      const rows = await ledgerRows();
      const replay = await executeDeadLetterClosure({ pool, ...authority, approvalId: approval.approvalId });
      assert.equal(replay.verified, true); assert.equal(fingerprint(await ledgerRows()), fingerprint(rows));
    });
    await t.test('held transaction commits after audit snapshot despite earlier admission timestamp: no older-good fallback', async () => {
      const before = await ledgerRows();
      const next = await seedClosureApproval(query, authority,
        { id: 'cutoff-held-close', predecessor: closureHead(authority, before.at(-1)) });
      let atCommit, releaseCommit;
      const held = new Promise(resolve => { atCommit = resolve; });
      const resume = new Promise(resolve => { releaseCommit = resolve; });
      const writer = wrappedPool(pool, async command => {
        if (command.text === 'COMMIT') { atCommit(); await resume; }
      });
      const writing = executeDeadLetterClosure({ pool: writer, ...authority, approvalId: next.approvalId });
      let captured, cutoff, written;
      try {
        await Promise.race([held, writing.then(r => { throw new Error(`Held transaction never reached commit: ${r.result}`); })]);
        captured = await captureDeadLetterAuditBoundary({ pool: other });
        assert.equal(captured.verified, true, JSON.stringify(captured));
        cutoff = new Date().toISOString();
      } finally { releaseCommit(); written = await writing; }
      assert.equal(written.verified, true, JSON.stringify(written));
      const after = await ledgerRows();
      assert(after.at(-1).admitted_at <= `${cutoff.slice(0, 23)}000Z`, 'timestamp alone would incorrectly credit this close');
      assert.equal(fingerprint(after.slice(0, before.length)), fingerprint(before));
      const read = await readDeadLetterClosures({ pool: other, ...authority,
        boundary: captured.boundary, cutoff });
      assert.equal(read.verified, true, JSON.stringify(read));
      assert.equal(read.counts.closedInternal, 0);
      assert.equal(read.counts.invalidated, 1);
      assert.equal(read.cases[0].head.id, after.at(-1).id, 'never select older visible close');
      assert.equal(read.cases[0].reason, 'cutoff_ineligible');
      assert.equal((await verifyDeadLetterClosureReference({ pool: other, ...authority, reference: read.reference })).verified, true);
      assert.equal((await readDeadLetterClosures({ pool: other, ...authority })).counts.closedInternal, 1,
        'current closure validity does not imply historical snapshot visibility');
    });
    await t.test('two-client source change after snapshot aborts admission without retry', async () => {
      const before = await ledgerRows();
      const next = await seedClosureApproval(query, authority, { id: 'source-race', predecessor: closureHead(authority, before.at(-1)) });
      let changed = false;
      const racing = wrappedPool(pool, async command => {
        if (!changed && command.text.includes('FROM public.event_dead_letters d') && command.text.includes('FOR SHARE')) {
          changed = true;
          await other.query("UPDATE public.event_dead_letters SET error='concurrent source change'");
        }
      });
      const r = await executeDeadLetterClosure({ pool: racing, ...authority, approvalId: next.approvalId });
      assert.equal(changed, true); assert.equal(r.ok, false); assert.equal(r.counts, null);
      assert.equal(fingerprint(await ledgerRows()), fingerprint(before));
      await query("UPDATE public.event_dead_letters SET error='original failure'");
    });
    await t.test('two-client canonical approval change before FOR UPDATE blocks admission', async () => {
      const before = await ledgerRows();
      const next = await seedClosureApproval(query, authority, { id: 'approval-race', predecessor: closureHead(authority, before.at(-1)) });
      let changed = false;
      const racing = wrappedPool(pool, async command => {
        if (!changed && command.text.includes('FROM public.approvals a') && command.text.includes('FOR UPDATE')) {
          changed = true; await other.query("UPDATE public.approvals SET status='denied' WHERE id=$1", [next.approvalId]);
        }
      });
      const r = await executeDeadLetterClosure({ pool: racing, ...authority, approvalId: next.approvalId });
      assert.equal(changed, true); assert.equal(r.ok, false); assert.equal(fingerprint(await ledgerRows()), fingerprint(before));
    });
    await t.test('two-client same/different intent races cannot branch one predecessor or retry', async () => {
      for (const mode of ['same', 'different']) {
        const before = await ledgerRows();
        approval = await seedClosureApproval(query, authority,
          { id: `ledger-race-${mode}`, predecessor: closureHead(authority, before.at(-1)) });
        const competitor = mode === 'same' ? approval : await seedClosureApproval(query, authority,
          { id: 'ledger-race-competitor', predecessor: closureHead(authority, before.at(-1)) });
        let arrived; const atLock = new Promise(resolve => { arrived = resolve; });
        let startedSecond; const secondStarted = new Promise(resolve => { startedSecond = resolve; });
        let firstInsert = true; let secondLock = true;
        const firstPool = wrappedPool(pool, async command => {
          if (firstInsert && command.text.startsWith('INSERT INTO public.pbk_dead_letter_closure_ledger')) {
            firstInsert = false; arrived(); await secondStarted;
          }
        });
        const secondPool = wrappedPool(other, async command => {
          if (secondLock && command.text.includes('pg_advisory_xact_lock')) { secondLock = false; startedSecond(); }
        });
        const first = executeDeadLetterClosure({ pool: firstPool, ...authority, approvalId: approval.approvalId });
        await Promise.race([atLock, first.then(r => { throw new Error(`Native race did not reach insert: ${r.result}`); })]);
        const second = executeDeadLetterClosure({ pool: secondPool, ...authority, approvalId: competitor.approvalId });
        const results = await Promise.all([first, second]);
        assert.equal(results.filter(r => r.verified).length, 1, JSON.stringify(results));
        const after = await ledgerRows(); assert.equal(after.length, before.length + 1);
        assert.equal(fingerprint(after.slice(0, before.length)), fingerprint(before));
      }
    });
    await t.test('native revoke needs new approval, missing QA/memory does not prevent withdrawal', async () => {
      const before = await ledgerRows();
      approval = await seedClosureApproval(query, authority, { id: 'revoke-native', action: 'revoke_internal',
        predecessor: closureHead(authority, before.at(-1)), manifest: approval.manifest });
      await query('DELETE FROM public.call_embeddings'); await query('DELETE FROM public.pbk_call_qa_scores');
      const r = await executeDeadLetterClosure({ pool, ...authority, approvalId: approval.approvalId });
      assert.equal(r.verified, true, JSON.stringify(r)); assert.equal(r.counts.invalidated, 1);
      assert.equal((await readDeadLetterClosures({ pool, ...authority })).counts.closedInternal, 0);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).ok, false);
      assert.equal(fingerprint((await ledgerRows()).slice(0, before.length)), fingerprint(before));
    });
    await t.test('native lost original denies usable summary and frozen reference', async () => {
      assert.equal(fingerprint((await query('SELECT to_jsonb(d) AS row FROM public.event_dead_letters d ORDER BY id')).rows), fingerprint(originalsBefore));
      assert.equal(fingerprint((await query('SELECT to_jsonb(d) AS row FROM public.provider_action_dispatches d ORDER BY id')).rows), fingerprint(dispatchBefore));
      t.diagnostic('original/dispatch fingerprints unchanged; six unknown dispatches retained; earlier receipt prefixes unchanged');
      await query('DELETE FROM public.event_dead_letters');
      assert.equal((await readDeadLetterClosures({ pool, ...authority })).counts, null);
      assert.equal((await verifyDeadLetterClosureReference({ pool, ...authority, reference: closed.reference })).ok, false);
    });
  } finally {
    try { await pool.end(); } finally { await other.end(); }
    t.diagnostic(`native clock fixture: bufferedResponses=${bufferedResponses}; maximumDatabaseLeadMs=${maximumDatabaseLeadMs}; capMs=100; timestamps unchanged`);
    if (sourcesCreated) {
      await query(`DROP TABLE public.provider_action_dispatches,public.approvals,public.pbk_eval_runs,
        public.call_embeddings,public.pbk_call_qa_scores,public.calls,public.event_dead_letters`);
    }
  }
}
