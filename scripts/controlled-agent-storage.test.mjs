import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { createControlledAgentStorage, readControlledAgentQualification } from './controlled-agent-storage.mjs';
import { createControlledPool } from './controlled-execution-scope.mjs';

test('isolated real SQL writes and rereads never change public records or restamp source', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.lead_profiles(id text PRIMARY KEY, lead_name text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()); INSERT INTO public.lead_profiles(id) VALUES ('customer'); CREATE TABLE public.pbk_tasks(id text PRIMARY KEY, metadata jsonb); CREATE TABLE public.bridge_state(id text PRIMARY KEY, data jsonb, updated_at timestamptz);");
    const pool = { query: async (sql, values) => {
      const result = await db.query(sql, values);
      // PostgreSQL name[] (OID 1003) is not decoded by node-postgres like text[].
      if (sql.includes('array_agg(a.attname ORDER BY')) for (const row of result.rows) row.columns = pg.types.getTypeParser(1003)(`{${row.columns.join(',')}}`);
      return result;
    } };
    const storage = await createControlledAgentStorage(pool, { tables: ['lead_profiles', 'pbk_tasks', 'bridge_state'], revision: 'abc' });
    const scope = { ...storage, blockedSql: 0 };
    const isolated = createControlledPool(db, scope);
    await isolated.query('INSERT INTO public.lead_profiles(id) VALUES ($1)', [storage.fixture.leadId]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.lead_profiles')).rows[0].n, 1);
    const first = await readControlledAgentQualification(db, storage.runId);
    const second = await readControlledAgentQualification(db, storage.runId);
    assert.equal(first.fixture.sourceUpdatedAt, second.fixture.sourceUpdatedAt);
    assert.equal(first.productionReadinessVerified, false);
    assert.equal(first.organicReadinessPromoted, false);
  } finally { await db.close(); }
});
