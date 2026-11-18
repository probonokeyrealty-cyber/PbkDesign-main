import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { canonicalJson } from './skill-governance-store.mjs';
import { createAuditFixture, auditFixtureHealth } from './operational-audit-test-fixture.mjs';
import { collectOperationalAudit } from './operational-audit-collector.mjs';
import { executeOperationalAudit, readOperationalAudit } from './operational-audit-store.mjs';
import { captureDeadLetterAuditBoundary, executeDeadLetterClosure } from './dead-letter-closure-store.mjs';
import { seedClosureSources, seedClosureApproval } from './fixtures/dead-letter-closure-store-fixture.mjs';
import { recordCallMemorySkip } from './call-memory-outcome-store.mjs';
const secret = 'audit-v3-isolated-material', revision = 'c'.repeat(40);
let f, sequence = 0;
const query = (sql, values) => f.db.query(sql.replace('INSERT INTO public.approvals VALUES',
  'INSERT INTO public.approvals(id,workspace_id,type,status,payload,decided_at,created_at,updated_at) VALUES'), values);
const authority = { secret, revision };
const dead = r => r.audit.checks.find(c => c.id === 'dead_letters');
const run = () => executeOperationalAudit({ pool: f.pool, ...authority, now: f.now,
  createId: () => `audit-v3-${++sequence}`, collect: args => collectOperationalAudit({ ...args,
    ...authority, observationNow: f.now, runtime: auditFixtureHealth() }) });
const read = () => readOperationalAudit({ pool: f.pool, ...authority, now: f.now() });
const close = async (options = {}) => {
  const approval = await seedClosureApproval(query, authority, { createdAt: new Date(f.now() - 100).toISOString(), ...options });
  const result = await executeDeadLetterClosure({ pool: f.pool, ...authority, approvalId: approval.approvalId, now: f.now });
  assert.equal(result.verified, true, JSON.stringify(result)); return { approval, result };
};
beforeAll(async () => { f = await createAuditFixture({ end: Date.now() + 1000, ...authority, duration: 0 }); }, 30000);
afterAll(async () => { await f?.close(); });
beforeEach(async () => {
  f.intercept(null); f.advance(Math.max(10, Date.now() + 1000 - f.now()));
  await f.db.exec(`DROP TABLE IF EXISTS pbk_dead_letter_closure_ledger CASCADE;
    DROP FUNCTION IF EXISTS pbk_closure_reject_mutation();
    TRUNCATE event_dead_letters,approvals,pbk_call_qa_scores,call_embeddings,calls,pbk_eval_runs;`);
  const { DEAD_LETTER_CLOSURE_SQL } = await import('./dead-letter-closure-migration.mjs');
  await f.db.exec(DEAD_LETTER_CLOSURE_SQL);
  await seedClosureSources(query);
});
test('v3 originals total retained and exact verified subset subtracted, even with unverified coverage', async () => {
  await close();
  await query(`INSERT INTO event_dead_letters(id,tenant_id,event_id,event_type,source,payload,error,created_at)
    VALUES ('unsupported','pbk','unsupported','other','unknown','{}','kept',now()-interval '10 days')`);
  const r = await run();
  assert.equal(r.verified, true, JSON.stringify(r));
  assert.equal(r.audit.coverage.verified, false);
  assert.equal(r.audit.closures.verified, true);
  assert.equal(dead(r).counts.totalOriginals, 2);
  assert.equal(dead(r).counts.resolvedInternal, 1);
  assert.equal(dead(r).counts.outstanding, 1);
  const row = (await query('SELECT * FROM pbk_eval_runs WHERE id=$1', [r.runId])).rows[0];
  assert.equal(row.suite_name, 'operational_audit_v3');
  assert.equal(row.source, 'server:operational-audit:v3');
  assert.equal(row.report.schemaVersion, 'pbk-operational-audit-v3');
});
test('closure after signed audit cannot improve it; unavailable ledger never means zero outstanding', async () => {
  const original = await run();
  assert.equal(dead(original).counts.outstanding, 1);
  await close();
  const r = await read();
  assert.equal(dead(r).counts.resolvedInternal, 0);
  assert.equal(dead(r).counts.outstanding, 1);
  assert.equal(r.audit.ready, false);
  await query('DROP TABLE pbk_dead_letter_closure_ledger');
  const unavailable = await run();
  assert.equal(dead(unavailable).status, 'unverified');
  assert.equal(dead(unavailable).counts.outstanding, 1);
  assert.equal(unavailable.audit.closures.verified, false);
});
test('revocation downgrades stored audit before coverage early return without rewriting signed counts', async () => {
  const { approval, result } = await close();
  const signed = await run();
  assert.equal(dead(signed).counts.resolvedInternal, 1);
  await close({ id: 'revoke', action: 'revoke_internal', predecessor: result.receipt, manifest: approval.manifest });
  const r = await read();
  assert.equal(r.audit.coverage.verified, false);
  assert.equal(r.audit.closures.verified, false);
  assert.equal(dead(r).counts.resolvedInternal, 0);
  assert.equal(dead(r).counts.outstanding, 1);
  const saved = (await query('SELECT report FROM pbk_eval_runs WHERE id=$1', [signed.runId])).rows[0].report;
  assert.equal(saved.audit.checks.find(c => c.id === 'dead_letters').counts.resolvedInternal, 1);
});
test('identical proof restoration recovers at most signed credit; new proof cannot improve counts', async () => {
  await close(); const signed = await run();
  const saved = (await query('SELECT * FROM call_embeddings')).rows[0];
  await query('DELETE FROM call_embeddings');
  assert.equal(dead(await read()).counts.resolvedInternal, 0);
  await query(`INSERT INTO call_embeddings SELECT * FROM jsonb_populate_record(NULL::call_embeddings,$1)`, [JSON.stringify(saved)]);
  assert.equal(dead(await read()).counts.resolvedInternal, dead(signed).counts.resolvedInternal);
});
test('frozen audit cutoff cannot freeze away current skip-proof expiry', async () => {
  const text = 'A short source.';
  await query("UPDATE event_dead_letters SET payload=jsonb_set(payload,'{transcript}',to_jsonb($1::text))", [text]);
  await query('UPDATE pbk_call_qa_scores SET transcript_snippet=$1', [text]);
  const skip = await recordCallMemorySkip({ pool: f.pool, ...authority, eventId: 'event-private',
    callId: 'call-private', sourceText: text, now: f.now() - 1800000 });
  assert.equal(skip.verified, true, JSON.stringify(skip));
  await close(); const signed = await run();
  assert.equal(dead(signed).counts.resolvedInternal, 1);
  f.advance(86400000 - 900000);
  const current = await read();
  assert.equal(current.verified, true, JSON.stringify(current));
  assert.equal(dead(current).counts.resolvedInternal, 0);
  assert.equal(dead(current).counts.outstanding, 1);
});
test.each(['v1', 'v2'])('legacy %s schema never gains closure credit and retains its signing domain', async version => {
  const r = await run();
  const row = (await query('SELECT * FROM pbk_eval_runs WHERE id=$1', [r.runId])).rows[0];
  const report = row.report;
  report.schemaVersion = `pbk-operational-audit-${version}`;
  delete report.audit.closures;
  const c = report.audit.checks.find(c => c.id === 'dead_letters');
  delete c.counts.totalOriginals; delete c.counts.resolvedInternal; delete c.counts.invalidatedClosures;
  if (version === 'v1') { delete report.observationCutoff; report.audit.coverage = { verified: false }; }
  const { attestation: _, ...body } = report;
  const key = createHmac('sha256', secret).update(`pbk.operational-audit.signing-key.${version}`).digest();
  report.attestation = { version: report.schemaVersion, signature: createHmac('sha256', key)
    .update(`${report.schemaVersion}\n${canonicalJson(body)}`).digest('hex') };
  await query('UPDATE pbk_eval_runs SET suite_name=$2,source=$3,report=$4 WHERE id=$1',
    [r.runId, `operational_audit_${version}`, `server:operational-audit:${version}`, JSON.stringify(report)]);
  await close(); const legacy = await read();
  assert.equal(version === 'v1' ? legacy.legacy.authenticated : legacy.verified, true, JSON.stringify(legacy));
  const audit = version === 'v1' ? legacy.legacy.audit : legacy.audit;
  assert.equal(audit.closures, undefined);
  assert.equal(audit.checks.find(c => c.id === 'dead_letters').counts.outstanding, 1);
});
test.each(['pending', 'invalid'])('newest %s v3 admission blocks older pass, including during closure validation', async kind => {
  const old = await run();
  let added = false;
  f.intercept(async text => {
    if (added || text !== 'ROLLBACK') return;
    added = true;
    await query('ROLLBACK');
    await query(`INSERT INTO pbk_eval_runs(id,tenant_id,suite_name,source,created_at,report)
      VALUES ('newest','pbk','operational_audit_v3','server:operational-audit:v3',$1,$2)`,
    [new Date(f.now() + 1).toISOString(), kind === 'pending' ? '{"completedAt":null}' : '{}']);
    return { rows: [] };
  });
  assert.equal((await read()).verified, false);
  assert(added); f.intercept(null);
  assert.equal((await read()).verified, false);
  assert.equal((await readOperationalAudit({ pool: f.pool, ...authority, now: f.now() + 1, id: old.runId })).verified, false);
});
test('normalizer rejects contradictory v3 counts and opaque boundary assertions', async () => {
  const boundary = await captureDeadLetterAuditBoundary({ pool: f.pool, now: f.now });
  assert.equal(boundary.verified, true);
  const input = await collectOperationalAudit({ pool: f.pool, ...authority, now: f.now(), closureBoundary: boundary.boundary });
  input.checks.find(c => c.id === 'dead_letters').counts.resolvedInternal = 2;
  const r = await executeOperationalAudit({ pool: f.pool, ...authority, now: f.now, collect: async () => input });
  assert.equal(dead(r).status, 'unverified');
  assert.equal(r.audit.ready, false);
});
