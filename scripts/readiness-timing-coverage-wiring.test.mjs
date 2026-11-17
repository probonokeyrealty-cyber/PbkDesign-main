import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { recordRuntimeSourceEvidence } from './runtime-source-evidence.mjs';
import { withRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const secret = 'explicit-local-task4-overwrite-fixture-material';
const revision = 'a'.repeat(40);
const sourceId = 'task4-local-archive-write';
let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE activity_log (
      id text PRIMARY KEY, workspace_id text, lead_id text, lead_name text,
      address text, actor text, category text, status text, text text, target text,
      source text, metadata jsonb, created_at timestamptz, updated_at timestamptz
    );
    CREATE TABLE pbk_eval_runs (
      id text PRIMARY KEY, tenant_id text, suite_name text, ok boolean,
      total int, passed int, failed int, report jsonb, source text, created_at timestamptz
    );
  `);
}, 30000);

afterAll(async () => { await db?.close(); });

function archiveWriter() {
  const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  const start = source.indexOf('async function persistActivityLogRecord(entry = {}) {');
  const end = source.indexOf('\nasync function recordProductionRuntimeEvent(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    Date,
    console,
    getPgPool: () => ({ query: (sql, values) => db.query(sql, values) }),
    ensureActivityLogSchema: async () => {},
    isoNow: () => new Date(NOW - 1000).toISOString(),
    activityLogPersistenceWarned: false,
  });
  vm.runInContext(source.slice(start, end), context);
  return context.writeRuntimeEventToActivityLog;
}

test('a delayed archive receipt must not attest another writer latest row under the first writer origin', async () => {
  const write = archiveWriter();
  const pool = { connect: async () => ({
    query: config => db.query(config.text, config.values),
    release() {},
  }) };
  let resume, wrote;
  const paused = new Promise(resolve => { resume = resolve; });
  const persisted = new Promise(resolve => { wrote = resolve; });
  const first = withRuntimeEvidenceContext('operator_chat', async () => {
    await write({ id: sourceId, source: 'fixture', event_type: 'first', severity: 'info' });
    wrote();
    await paused;
    return recordRuntimeSourceEvidence({ pool, secret, revision,
      sourceKind: 'runtime_archive', sourceId, now: NOW });
  });
  await persisted;
  try {
    // This second committed write has no operational context and reuses A's identity.
    await write({ id: sourceId, source: 'fixture', event_type: 'second', severity: 'info' });
    const row = (await db.query('SELECT category FROM activity_log WHERE id=$1', [sourceId])).rows[0];
    assert.equal(row.category, 'SECOND');
  } finally { resume(); }
  const receipt = await first;
  const proofs = (await db.query(`SELECT report FROM pbk_eval_runs
    WHERE report->>'recordRef' IS NOT NULL`)).rows;
  assert.equal(receipt.verified && receipt.classification === 'operational', false,
    'ID-only Task 2 recorder must not attribute B durable row to A operational context');
  assert.equal(proofs.some(({ report }) => report.classification === 'operational'), false);
});
