import assert from 'node:assert/strict';
import { CANARY_EVIDENCE_LIMITS as limits } from '../canary-evidence-protocol.mjs';

// Test-only observation of original reader SQL and native pg results.
export function observeCanaryPostgres(pool, afterFirstSnapshot) {
  const trace = { queries: [], envelopes: [], transactions: [], released: [], snapshots: 0 };
  const audited = { connect(callback) {
    if (!callback) return new Promise((resolve, reject) => {
      audited.connect((error, client) => error ? reject(error) : resolve(client));
    });
    // pg removes its idle listener before this callback. Do not defer the
    // reader's handoff to a promise continuation or replace the event channel.
    return pool.connect((error, client, release) => {
      if (error) { callback(error, client, release); return; }
      const observed = {
        on: client.on.bind(client),
        removeListener: client.removeListener.bind(client),
        async query(config) {
          const text = typeof config === 'string' ? config : config.text;
          if (typeof config === 'object') assert(config.query_timeout > 0 && config.query_timeout <= limits.queryTimeoutMs);
          trace.queries.push(text);
          assert(/^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|ROLLBACK|SELECT set_config\(|WITH selected AS MATERIALIZED)/.test(text));
          const result = await client.query(config);
          if (text.startsWith('BEGIN')) {
            trace.transactions.push((await client.query(`SELECT current_setting('transaction_read_only') AS ro,
              current_setting('transaction_isolation') AS isolation`)).rows[0]);
          }
          if (text.startsWith('WITH selected')) {
            assert.deepEqual(result.fields.map(field => field.dataTypeID), [114, 23, 23], 'JSON and int4, not bigint strings');
            for (const row of result.rows) {
              assert(Number.isSafeInteger(row.physical_bytes));
              assert(Number.isSafeInteger(row.report_bytes));
            }
            trace.envelopes.push({ config, rows: result.rows });
          }
          if (text === 'ROLLBACK' && ++trace.snapshots === 1) await afterFirstSnapshot?.();
          return result;
        }, release(destroy) { trace.released.push(Boolean(destroy)); return client.release(destroy); },
      };
      callback(null, observed, observed.release);
    });
  } };
  return { pool: audited, trace };
}
