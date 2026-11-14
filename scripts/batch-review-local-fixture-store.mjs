import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyReviewedBatch } from '../src/app/utils/batchReview.ts';
import {
  ensureBatchPhoneSchema,
  registerBatchPhonePlanInTransaction,
  withBatchPhoneTransaction,
} from './batch-phone-dispatch.mjs';

// This workspace exists only in the dedicated local fixture database.
export const fixtureWorkspace = 'batch-review-fixture';

export async function openBatchReviewFixtureStore(directory, initialLeads) {
  const db = await PGlite.create(directory);
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      const query = (sql, params) => params ? db.query(sql, params) : db.exec(sql);
      return { query, release };
    },
    async query(sql, params) {
      const client = await pool.connect();
      try { return await client.query(sql, params); } finally { client.release(); }
    },
  };
  try {
    await ensureBatchPhoneSchema(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.pbk_batch_review_fixture (
        singleton BOOLEAN PRIMARY KEY CHECK (singleton),
        revision UUID NOT NULL,
        leads JSONB NOT NULL
      )
    `);
    await pool.query(`
      INSERT INTO public.pbk_batch_review_fixture VALUES (TRUE, $1, $2::jsonb)
      ON CONFLICT (singleton) DO NOTHING
    `, [randomUUID(), JSON.stringify(initialLeads)]);
  } catch (error) {
    await db.close();
    throw error;
  }

  return {
    pool,
    async read() {
      const { rows } = await pool.query(
        'SELECT revision, leads FROM public.pbk_batch_review_fixture WHERE singleton = TRUE', []
      );
      return rows[0];
    },
    apply(sampleRows, reviewedRows, revision) {
      return withBatchPhoneTransaction(pool, async (client) => {
        const { rows: [snapshot] } = await client.query(
          'SELECT revision, leads FROM public.pbk_batch_review_fixture WHERE singleton = TRUE FOR UPDATE', []
        );
        if (revision !== snapshot.revision) return { stale: true };
        const result = applyReviewedBatch(
          sampleRows, snapshot.leads, reviewedRows, (row) => `sample-batch-${row}`
        );
        if (!result.appliedLeadIds.size) return { empty: true };
        const registeredPhoneCount = await registerBatchPhonePlanInTransaction(client, {
          workspace: fixtureWorkspace,
          batchId: snapshot.revision,
          entries: result.contactPlan.filter(({ rows }) =>
            rows.some((row) => result.appliedLeadIds.has(row))
          ),
          leadIdForRow: (row) => result.appliedLeadIds.get(row),
        });
        // A registration failure rolls back the roster and revision as well.
        await client.query(`
          UPDATE public.pbk_batch_review_fixture SET revision = $1, leads = $2::jsonb
          WHERE singleton = TRUE
        `, [randomUUID(), JSON.stringify(result.leads)]);
        return { summary: result.summary, registeredPhoneCount };
      });
    },
    close: () => db.close(),
  };
}
