import assert from 'node:assert/strict';
import { afterAll, beforeAll, beforeEach, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { DEAD_LETTER_CLOSURE_SQL } from './dead-letter-closure-migration.mjs';
import { executeDeadLetterClosure } from './dead-letter-closure-store.mjs';
import { verifyClosureIntent } from './dead-letter-closure-protocol.mjs';
import { CLOSURE_SOURCE_FIXTURE_SQL, seedClosureSources, seedClosureApproval,
  closureTestAuthority } from './fixtures/dead-letter-closure-store-fixture.mjs';

let mod = {}, db, authority, log;
const query = (sql, values) => db.query(sql, values);
const pool = { connect: async () => ({ query: async ({ text, values }) => {
  log.push(text); const r = await query(text, values); return { rows: r.rows, rowCount: r.affectedRows };
}, release() {} }) };
const api = name => { assert.equal(typeof mod[name], 'function', `${name} missing Task6 API`); return mod[name]; };
const ref = () => api('prepareDeadLetterClosureProposal');
beforeAll(async () => {
  mod = await import('./dead-letter-closure-approval.mjs').catch(e => {
    if (e.code === 'ERR_MODULE_NOT_FOUND' || e.code === 'MODULE_NOT_FOUND') return {}; throw e;
  });
  db = new PGlite();
  await db.exec('CREATE ROLE proposal_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE,CREATE ON SCHEMA public TO proposal_owner; SET ROLE proposal_owner;');
  await db.exec(CLOSURE_SOURCE_FIXTURE_SQL);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  authority = closureTestAuthority(); log = [];
  await db.exec(`ROLLBACK; DROP TABLE IF EXISTS public.pbk_dead_letter_closure_ledger CASCADE;
    DROP FUNCTION IF EXISTS public.pbk_closure_reject_mutation();
    TRUNCATE event_dead_letters,calls,pbk_call_qa_scores,call_embeddings,pbk_eval_runs,approvals;`);
  await db.exec(DEAD_LETTER_CLOSURE_SQL); await seedClosureSources(query);
});
const request = extra => ({ method: 'POST', search: '', headers: { authorization: 'Bearer local-test' }, body: {}, ...extra });
test('proposal authorizer requires direct founder and rejects duplicate/delegated headers', () => {
  const auth = api('authorizeClosureProposalRequest');
  assert.equal(auth(request(), 'local-test').ok, true);
  for (const headers of [{}, { authorization: ['Bearer local-test'] },
    { authorization: 'Bearer local-test', Authorization: 'Bearer local-test' },
    ...['x-pbk-team-token', 'x-team-token', 'x-pbk-team-passcode', 'x-team-passcode',
      'x-pbk-netlify-proxy', 'x-forwarded-authorization', 'x-pbk-webhook-secret'].map(k => ({ authorization: 'Bearer local-test', [k]: '' }))]) {
    assert.equal(auth(request({ headers }), 'local-test').ok, false);
  }
  assert.equal(auth(request({ rawHeaders: ['Authorization', 'Bearer local-test', 'Authorization', 'Bearer local-test'] }), 'local-test').ok, false);
});
test('proposal cannot inject evidence or approval status; POST empty body and no query only', () => {
  const auth = api('authorizeClosureProposalRequest');
  for (const body of [{ status: 'approved' }, { manifest: {} }, { approvalId: 'chosen' }, { action: 'revoke_internal' }, [], null]) {
    assert.equal(auth(request({ body }), 'local-test').ok, false);
  }
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.equal(auth(request({ method }), 'local-test').ok, false);
  assert.equal(auth(request({ search: '?now=0' }), 'local-test').ok, false);
});
test('internal classification detects intent and conflicting aliases, not only an exact action', () => {
  const is = api('isDeadLetterClosureApproval');
  assert.equal(is({ type: 'admin', approvalAction: 'dead_letter_internal_closure' }), true);
  assert.equal(is({ type: 'provider-action', metadata: { deadLetterClosureIntent: {} } }), true);
  assert.equal(is({ action: 'dead_letter_internal_closure' }), true);
  assert.equal(is({ metadata: { requestedTool: 'dead_letter_internal_closure' } }), true);
  assert.equal(is({ type: 'dead_letter_internal_closure', approvalAction: 'sendContract' }), true);
  assert.equal(is({ approvalAction: ' DEAD_LETTER_INTERNAL_CLOSURE ' }), true);
  assert.equal(is({ type: 'admin' }), false);
});
test('prepare signs current complete manifest, returns pending admin params and performs only reads', async () => {
  const { manifest } = await seedClosureApproval(query, authority);
  log = [];
  const r = await ref()({ pool, ...authority, recordRef: manifest.recordRef, action: 'close_internal', approvalId: 'new-proposal', now: Date.now() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.params.id, 'new-proposal'); assert.equal(r.params.type, 'admin');
  assert.equal(r.params.status, 'pending'); assert.equal(r.params.approvalAction, 'dead_letter_internal_closure');
  assert.equal(verifyClosureIntent({ intent: r.params.metadata.deadLetterClosureIntent, ...authority, approvalId: r.params.id, now: Date.now() }).verified, true);
  assert(!r.params.leadId && !r.params.contractId && !r.params.provider);
  assert(!/dead-private|owner discussed|original failure/.test(JSON.stringify(r)));
  assert(log.every(sql => /^(SELECT|BEGIN|SET LOCAL|ROLLBACK)\b/.test(sql.trim())));
  assert.equal((await query('SELECT count(*)::int n FROM approvals')).rows[0].n, 1);
});
test('revoke proposal uses authenticated prior manifest after current proof loss', async () => {
  const approved = await seedClosureApproval(query, authority);
  assert.equal((await executeDeadLetterClosure({ pool, ...authority, approvalId: approved.approvalId })).verified, true);
  await query('DELETE FROM call_embeddings');
  const r = await ref()({ pool, ...authority, recordRef: approved.manifest.recordRef, action: 'revoke_internal', approvalId: 'revoke-proposal', now: Date.now() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.params.metadata.deadLetterClosureIntent.action, 'revoke_internal');
  assert(r.params.metadata.deadLetterClosureIntent.predecessor);
  assert.equal((await ref()({ pool, ...authority, recordRef: approved.manifest.recordRef, action: 'close_internal', approvalId: 'bad-close', now: Date.now() })).ok, false);
});
test('prepare denies malformed refs, caller overrides, bad histories and unavailable storage', async () => {
  const { manifest } = await seedClosureApproval(query, authority);
  const args = { pool, ...authority, recordRef: manifest.recordRef, action: 'close_internal', approvalId: 'proposal', now: Date.now() };
  for (const extra of [{ recordRef: '../x' }, { action: 'apply' }, { manifest }, { status: 'approved' }, { pool: null }]) {
    assert.equal((await ref()({ ...args, ...extra })).ok, false);
  }
  assert.equal((await ref()({ ...args, action: 'revoke_internal' })).ok, false);
});
test('proposal context refuses unauthenticated prior-head history without writing or leaking rows', async () => {
  const approved = await seedClosureApproval(query, authority);
  assert.equal((await executeDeadLetterClosure({ pool, ...authority, approvalId: approved.approvalId })).verified, true);
  const corrupted = { connect: async () => {
    const client = await pool.connect();
    return { ...client, query: async config => {
      const r = await client.query(config);
      if (config.text.startsWith('SELECT id,tenant_id,ordinal::text')) {
        r.rows = JSON.parse(JSON.stringify(r.rows)); r.rows[0].report.attestation.signature = '0'.repeat(64);
      }
      return r;
    } };
  } };
  log = [];
  const r = await ref()({ pool: corrupted, ...authority, recordRef: approved.manifest.recordRef,
    action: 'revoke_internal', approvalId: 'revoke', now: Date.now() });
  assert.equal(r.ok, false); assert.equal(r.result, 'closure_predecessor_invalid');
  assert(!/dead-private|owner discussed|original failure/.test(JSON.stringify(r)));
  assert(log.every(sql => /^(SELECT|BEGIN|SET LOCAL|ROLLBACK)\b/.test(sql.trim())));
});
