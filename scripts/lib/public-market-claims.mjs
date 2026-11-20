// Separate monotonic claims: whole-state snapshot retries cannot erase these.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export function createPublicMarketClaims({ getPool, testDirectory, now = Date.now } = {}) {
  let chain = Promise.resolve();
  const claim = (jobId) => {
    const work = chain.then(async () => {
      const until = now() + 300000;
      const pool = getPool?.();
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(742813, 1)');
          await client.query(
            'CREATE TABLE IF NOT EXISTS pbk_public_market_claims (job_id text PRIMARY KEY, expires_at timestamptz NOT NULL)'
          );
          const existing = await client.query(
            'SELECT job_id FROM pbk_public_market_claims WHERE job_id=$1 OR expires_at>NOW() LIMIT 1',
            [jobId]
          );
          if (existing.rows.length) {
            await client.query('ROLLBACK');
            return false;
          }
          await client.query(
            "INSERT INTO pbk_public_market_claims (job_id,expires_at) VALUES ($1,NOW()+INTERVAL '5 minutes')",
            [jobId]
          );
          await client.query('COMMIT');
          return true;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
      // Only isolated tests use files. Hosted activation requires Postgres.
      if (!testDirectory) throw Error('durable_claims_unavailable');
      await mkdir(testDirectory, { recursive: true });
      const file = path.join(testDirectory, 'public-market-claims.json');
      const saved = await readFile(file, 'utf8')
        .then(JSON.parse)
        .catch((e) => {
          if (e.code === 'ENOENT') return { ids: [], until: 0 };
          throw e;
        });
      if (saved.ids.includes(jobId) || saved.until > now()) return false;
      await writeFile(file, JSON.stringify({ ids: [...saved.ids, jobId], until }), { flush: true });
      return true;
    });
    chain = work.catch(() => {});
    return work;
  };
  return { claim };
}
