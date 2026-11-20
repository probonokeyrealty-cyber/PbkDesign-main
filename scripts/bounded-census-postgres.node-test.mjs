import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { validateTargetedEvalTarget } from './targeted-readiness-eval-guard.mjs';
import { CENSUS_SOURCE_SCHEMA_SQL, protectedCensusFingerprints } from './bounded-census-test-fixture.mjs';

test('guarded disposable Postgres proves journal commit order, rollback and paged readback', { timeout: 600000 }, async t => {
  const { connectionConfig } = await validateTargetedEvalTarget();
  const { readProtectedFixtureFingerprints } = await import('./readiness-timing-postgres-fixture.mjs');
  const database = `pbk_census_${randomUUID().replaceAll('-', '')}`;
  assert.match(database, /^pbk_census_[a-f0-9]{32}$/);
  const base = new pg.Pool({ ...connectionConfig, max: 1, connectionTimeoutMillis: 10000, query_timeout: 15000 });
  let pool;
  let created = false, inherited;
  try {
    inherited = await readProtectedFixtureFingerprints(base);
    // Fresh authenticated throwaway branch only. A separate empty database preserves
    // inherited public objects and exercises the actual shipped SQL without rewriting it.
    await base.query(`CREATE DATABASE "${database}"`); created = true;
    pool = new pg.Pool({ ...connectionConfig, database, max: 6, connectionTimeoutMillis: 10000, query_timeout: 15000 });
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, database);
    await pool.query(CENSUS_SOURCE_SCHEMA_SQL);
    const sql = readFileSync(new URL('./migrations/20261117-bounded-census.sql', import.meta.url), 'utf8');
    const protectedBefore = await protectedCensusFingerprints((...args) => pool.query(...args));
    await pool.query(sql);
    await pool.query(sql);
    assert.equal((await pool.query('SELECT public.pbk_census_verify_installation() AS ok')).rows[0].ok, true);
    const security = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity,relacl::text AS acl
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relname LIKE 'pbk_runtime_census_%' AND relkind='r' ORDER BY relname`)).rows;
    assert.equal(security.length, 5);
    assert(security.every(row => row.relrowsecurity && !row.relforcerowsecurity));

    await t.test('uncommitted journal writes cannot fall behind a closed committed head', async () => {
      const a = await pool.connect(), b = await pool.connect();
      const head = async () => Number((await pool.query('SELECT sequence FROM public.pbk_runtime_census_head WHERE id=true')).rows[0].sequence);
      let bInsert;
      try {
        const initial = await head();
        await a.query('BEGIN');
        await b.query('BEGIN');
        await a.query("INSERT INTO public.activity_log(id,text,created_at,updated_at) VALUES ('a','fixture',clock_timestamp(),clock_timestamp())");
        bInsert = b.query("INSERT INTO public.activity_log(id,text,created_at,updated_at) VALUES ('b','fixture',clock_timestamp(),clock_timestamp())");
        const resolved = await Promise.race([bInsert.then(() => true), new Promise(done => setTimeout(() => done(false), 100))]);
        assert.equal(resolved, false, 'source trigger must serialize before allocating a committed journal boundary');
        assert.equal(await head(), initial);
        await a.query('COMMIT');
        await bInsert;
        assert.equal(await head(), initial + 1, 'second transaction is still uncommitted');
        await b.query('COMMIT');
        assert.equal(await head(), initial + 2);
        await a.query('BEGIN');
        await a.query("UPDATE public.activity_log SET text='rolled back' WHERE id='a'");
        await a.query('ROLLBACK');
        assert.equal(await head(), initial + 2);
        const rows = (await pool.query('SELECT sequence,previous_hash,chain_hash FROM public.pbk_runtime_census_journal ORDER BY sequence')).rows;
        for (let index = 1; index < rows.length; index++) {
          assert.equal(Number(rows[index].sequence), Number(rows[index - 1].sequence) + 1);
          assert.equal(rows[index].previous_hash, rows[index - 1].chain_hash);
        }
      } finally {
        await a.query('ROLLBACK').catch(() => {});
        await b.query('ROLLBACK').catch(() => {});
        await bInsert?.catch(() => {});
        a.release(); b.release();
      }
    });

    await t.test('real source edits, key changes and deletes remain observation-only', async () => {
      const initial = Number((await pool.query('SELECT sequence FROM public.pbk_runtime_census_head WHERE id=true')).rows[0].sequence);
      await pool.query("UPDATE public.activity_log SET id='a-renamed',text='changed' WHERE id='a'");
      await pool.query("DELETE FROM public.activity_log WHERE id='b'");
      const rows = (await pool.query('SELECT * FROM public.pbk_census_journal_page($1,$2,128)', [initial, initial + 3])).rows;
      assert.equal(rows.length, 3);
      assert.deepEqual(rows.map(row => row.presence), ['deleted', 'present', 'deleted']);
      assert(rows.every(row => /^[a-f0-9]{64}$/.test(row.source_ref)));
      assert(!JSON.stringify(rows).includes('a-renamed'));
      assert(!rows.some(row => Object.hasOwn(row, 'body') || Object.hasOwn(row, 'text')));
    });

    await t.test('actual PostgreSQL closes a baseline and independently verifies its first forward checkpoint', async () => {
      const { appendRuntimeCoverageCheckpoint } = await import('./runtime-coverage-store.mjs');
      const secret = randomBytes(32).toString('hex'), revision = 'd'.repeat(40);
      const health = { authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
        providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' };
      let result;
      for (let attempts = 0; attempts < 32; attempts++) {
        result = await appendRuntimeCoverageCheckpoint({ pool, secret, revision, bootId: 'actual-pg-proof',
          protocol: 'paged-v2', health });
        if (result.verified) break;
        assert.equal(result.result, 'coverage_source_bootstrap_incomplete', JSON.stringify(result));
        if (attempts === 0) {
          // The journal sees an invalid future clock before the later QA page
          // sees the same source version after its timestamp has passed.
          await pool.query(`INSERT INTO public.pbk_qa_audit(id,tenant_id,passed,created_at)
            VALUES ('clock-transition','pbk',true,clock_timestamp()+interval '1 second')`);
          const journal = (await pool.query(`SELECT clock_valid FROM public.pbk_runtime_census_journal
            WHERE source_kind='qa' ORDER BY sequence DESC LIMIT 1`)).rows[0];
          assert.equal(journal.clock_valid, false);
        }
        if (attempts === 1) await new Promise(done => setTimeout(done, 1100));
      }
      assert.equal(result.verified, true, JSON.stringify(result));
      assert.equal(result.report.intervalStart, result.report.cutoff);
      assert.equal(result.report.instrumentation, 'runtime-paged-census-v2');
      assert.equal((await pool.query(`SELECT clock_valid FROM public.pbk_runtime_census_journal
        WHERE source_kind='qa' ORDER BY sequence DESC LIMIT 1`)).rows[0].clock_valid, false,
      'historical clock evidence cannot be upgraded by later page observation');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM public.pbk_eval_runs WHERE suite_name='runtime_coverage_v1'")).rows[0].n, 1);
    });
    assert.deepEqual(await protectedCensusFingerprints((...args) => pool.query(...args)), protectedBefore);
    assert.deepEqual(await readProtectedFixtureFingerprints(base), inherited);
  } finally {
    try {
      if (pool) await pool.end();
      if (created) {
        assert.match(database, /^pbk_census_[a-f0-9]{32}$/);
        await base.query(`DROP DATABASE "${database}"`);
        assert.equal((await base.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1', [database])).rows[0].n, 0);
      }
    } finally { await base.end(); }
  }
});
