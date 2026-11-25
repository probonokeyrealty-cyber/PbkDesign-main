import { rexLeadImportEventInsert } from './rex-lead-import-events.mjs';

export function isRetryablePostgresSnapshotError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  return (
    /^(08[0-9A-Z]{3}|57P0[123]|53300|55P03|PBK_POSTGRES_OPERATION_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)$/.test(code) ||
    /not yet accepting connections|database system is starting up|connection terminated|terminating connection|connection ended unexpectedly|server closed the connection|query read timeout/i.test(message)
  );
}

// Each retry uses the same row version and payload. A lost response can hide
// a successful commit, and a different writer may have advanced the row.
export async function writePostgresStateSnapshot(pool, serialized, {
  maxAttempts,
  delay,
  onAttempt = () => {},
  rexLeadImports = [],
}) {
  let version;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    onAttempt(attempt);
    try {
      if (version === undefined) {
        const current = await pool.query("SELECT xmin::text AS version FROM bridge_state WHERE id = 'singleton'");
        version = current.rows[0]?.version ?? null;
      }
      const snapshotSql = version === null
        ? `INSERT INTO bridge_state (id, data, updated_at)
           VALUES ('singleton', $1::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`
        : `UPDATE bridge_state SET data = $1::jsonb, updated_at = NOW()
           WHERE id = 'singleton' AND xmin::text = $2`;
      const params = version === null ? [serialized] : [serialized, version];
      const result = rexLeadImports.length
        ? await pool.query(`WITH saved AS (${snapshotSql} RETURNING id), queued AS (
            ${rexLeadImportEventInsert('$' + (params.length + 1), 'WHERE EXISTS (SELECT 1 FROM saved)')}
          ) SELECT id FROM saved`, [...params, JSON.stringify(rexLeadImports)])
        : await pool.query(snapshotSql, params);

      if (result.rowCount === 1) return attempt;
      const existing = await pool.query(
        "SELECT data = $1::jsonb AS matches FROM bridge_state WHERE id = 'singleton'",
        [serialized],
      );
      if (existing.rows[0]?.matches) return attempt;
      throw Object.assign(new Error('Postgres snapshot changed during the write.'), {
        code: 'PBK_POSTGRES_SNAPSHOT_CONFLICT',
      });
    } catch (error) {
      if (attempt === maxAttempts || !isRetryablePostgresSnapshotError(error)) throw error;
      await delay(attempt);
    }
  }
}
