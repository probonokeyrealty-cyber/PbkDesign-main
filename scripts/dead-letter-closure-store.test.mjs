import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, jest, test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { DEAD_LETTER_CLOSURE_SQL } from './dead-letter-closure-migration.mjs';
import { closureBinding, createClosureIntent, signClosureReceipt } from './dead-letter-closure-protocol.mjs';
import { CLOSURE_SOURCE_FIXTURE_SQL, seedClosureSources, seedClosureApproval,
  closureTestAuthority, closureHead } from './fixtures/dead-letter-closure-store-fixture.mjs';

const PgResult = createRequire(import.meta.url)('pg/lib/result.js');
let db; let mod = {}; let authority; let approval; let log; let hook; let released; let active;
const query = (sql, values) => db.query(sql, values);
function pool() {
  return { connect: async () => {
    assert.equal(active, 0, 'max:1 pool must release write connection before readback'); active++;
    const client = new EventEmitter();
    client.query = async config => {
      const { text, values } = config; log.push(text);
      if (hook) { const intercepted = await hook(text, values, client); if (intercepted) return intercepted; }
      const result = await query(text, values);
      const native = new PgResult(); native.rows = result.rows; native.rowCount = result.affectedRows ?? result.rows.length;
      return native;
    };
    client.release = destroy => { released.push(Boolean(destroy)); active--; };
    return client;
  } };
}
function api(name) { assert.equal(typeof mod[name], 'function', `${name} missing store module`); return mod[name]; }
const execute = (options = {}) => api('executeDeadLetterClosure')({ pool: pool(), ...authority, approvalId: approval.approvalId, ...options });
const read = (options = {}) => api('readDeadLetterClosures')({ pool: pool(), ...authority, ...options });
const reverify = reference => api('verifyDeadLetterClosureReference')({ pool: pool(), ...authority, reference });
function failure(r) { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.verified, false); assert.equal(r.counts, null); }
function guards(r) {
  assert.equal(r.noContact, true); assert.equal(r.providerWritesBlocked, true);
  assert.equal(r.deliveryRetries, false); assert.equal(r.providerDeliveryVerified, false); assert.equal(r.launchQualified, false);
  assert(!/dead-private|call-private|approval-private|original failure|owner discussed/.test(JSON.stringify(r)));
}
async function rows() { return (await query(`SELECT id,tenant_id,ordinal::text,
  to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at,
  insert_xid::text,record_ref,approval_ref,intent_binding,action,previous_id,report
  FROM public.pbk_dead_letter_closure_ledger ORDER BY ordinal`)).rows; }
async function protectedRows() {
  const result = [];
  for (const table of ['event_dead_letters', 'provider_action_dispatches', 'approvals']) {
    result.push((await query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows);
  }
  return result;
}
beforeAll(async () => {
  mod = await import('./dead-letter-closure-store.mjs').catch(e => {
    if (['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(e.code)) return {}; throw e;
  });
  db = new PGlite();
  await db.exec(`CREATE ROLE closure_store_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE,CREATE ON SCHEMA public TO closure_store_owner; SET ROLE closure_store_owner;`);
  await db.exec(CLOSURE_SOURCE_FIXTURE_SQL);
}, 30000);
afterAll(async () => { jest.useRealTimers(); await db?.close(); });
beforeEach(async () => {
  jest.useRealTimers(); hook = null; log = []; released = []; active = 0; authority = closureTestAuthority();
  await db.exec(`ROLLBACK; DROP TABLE IF EXISTS public.pbk_dead_letter_closure_ledger CASCADE;
    DROP FUNCTION IF EXISTS public.pbk_closure_reject_mutation();
    TRUNCATE event_dead_letters,calls,pbk_call_qa_scores,call_embeddings,pbk_eval_runs,approvals;`);
  await db.exec(DEAD_LETTER_CLOSURE_SQL);
  await seedClosureSources(query); approval = await seedClosureApproval(query, authority);
});

test('exact approved append and independent readback, native pg.Result, max:1 pool', async () => {
  await query(`INSERT INTO approvals VALUES ('unrelated-private','pbk','offer','pending','{}',NULL,now(),now())`);
  const before = await protectedRows(); const r = await execute(); guards(r);
  assert.equal(r.verified, true, JSON.stringify(r)); assert.equal(r.counts.closedInternal, 1);
  assert.deepEqual(await protectedRows(), before); assert.equal((await rows()).length, 1);
  assert.deepEqual(released, [false, false]);
  const lock = log.findIndex(s => s.includes('pg_advisory_xact_lock'));
  const approvalLock = log.findIndex(s => s.includes('public.approvals') && s.includes('FOR UPDATE'));
  assert(lock >= 0 && approvalLock > lock); assert(log.some(s => s.includes('FOR SHARE')));
  assert(log.includes('COMMIT')); assert(log.some(s => /REPEATABLE READ READ ONLY/.test(s)));
  const v = await reverify(r.reference); assert.equal(v.verified, true, JSON.stringify(v));
  assert(!log.some(s => /^\s*(UPDATE|DELETE|TRUNCATE)\b|provider_action_dispatches/.test(s)));
});

async function boundary() {
  const r = await api('captureDeadLetterAuditBoundary')({ pool: pool() });
  assert.equal(r.verified, true, JSON.stringify(r));
  return r.boundary;
}
test('audit boundary captures a real bounded snapshot and database/server ordering', async () => {
  const b = await boundary();
  assert.match(b.snapshot, /^\d+:\d+:[\d,]*$/);
  assert(Date.parse(b.databaseCapturedAt) <= Date.parse(b.serverObservedAt));
  assert(log.some(s => s.includes('pg_current_snapshot()')));
  assert(log.some(s => /READ ONLY/.test(s)));
  guards(await api('captureDeadLetterAuditBoundary')({ pool: pool(), now: () => 0 }));
  assert.equal((await api('captureDeadLetterAuditBoundary')({ pool: pool(), now: () => 0 })).verified, false);
});
test('post-cutoff commit denied despite earlier timestamp and no older-good fallback', async () => {
  assert.equal((await execute()).verified, true);
  const b = await boundary();
  const first = await read({ boundary: b });
  assert.equal(first.counts.closedInternal, 1, JSON.stringify(first));
  hook = text => text.startsWith('SELECT id,pg_visible_in_snapshot')
    ? { rows: [{ id: first.cases[0].head.id, visible: false }] } : undefined;
  const r = await read({ boundary: b });
  assert.equal(r.verified, true, JSON.stringify(r));
  assert.equal(r.counts.closedInternal, 0);
  assert.equal(r.counts.invalidated, 1);
  assert.equal(r.cases[0].reason, 'cutoff_ineligible');
});
test('audit cutoff constrains current proof times as well as receipt xid', async () => {
  assert.equal((await execute()).verified, true);
  const b = await boundary();
  const cutoff = new Date().toISOString();
  await query("UPDATE call_embeddings SET updated_at=$1", [new Date(Date.parse(cutoff) + 1000).toISOString()]);
  const r = await read({ boundary: b, cutoff, now: Date.parse(cutoff) + 2000 });
  assert.equal(r.counts.closedInternal, 0, JSON.stringify(r));
});
test.each(['snapshot', 'overflow', 'clock', 'cutoff'])('audit boundary rejects %s tamper', async kind => {
  const b = await boundary();
  if (kind === 'snapshot') b.snapshot = 'not-a-snapshot';
  if (kind === 'overflow') b.snapshot = '1:2:' + '1,'.repeat(5000);
  if (kind === 'clock') b.databaseCapturedAt = new Date(Date.parse(b.serverObservedAt) + 1).toISOString();
  const r = await read({ boundary: b, ...(kind === 'cutoff' ? { cutoff: '2020-01-01T00:00:00.000Z' } : {}) });
  failure(r);
});
test('snapshot text is authenticated, unsupported capture/overflow fail closed without raw details', async () => {
  const b = await boundary();
  const r = await read({ boundary: b });
  assert.equal(r.verified, true);
  const changed = JSON.parse(JSON.stringify(r.reference));
  changed.boundary.snapshot = '1:2:';
  failure(await reverify(changed));
  for (const mode of ['unsupported', 'overflow']) {
    hook = text => {
      if (!text.startsWith('SELECT pg_current_snapshot()')) return;
      if (mode === 'unsupported') throw new Error('private unavailable snapshot SQL');
      return { rows: [{ snapshot: '1:2:' + '1,'.repeat(5000), database_captured_at: b.databaseCapturedAt }] };
    };
    const unavailable = await api('captureDeadLetterAuditBoundary')({ pool: pool() });
    assert.equal(unavailable.verified, false); assert.equal(unavailable.boundary, null); guards(unavailable);
    assert(!JSON.stringify(unavailable).includes('private'));
  }
});
test('boundary capture rejects server clock ahead of database capture, not just database ahead', async () => {
  const r = await api('captureDeadLetterAuditBoundary')({ pool: pool(), now: () => Date.now() + 10000 });
  assert.equal(r.verified, false);
  assert.equal(r.boundary, null);
});
test('a visible signed receipt with completion after cutoff remains ineligible', async () => {
  assert.equal((await execute()).verified, true);
  const b = await boundary(); const cutoff = new Date().toISOString();
  const ledger = JSON.parse(JSON.stringify(await rows()));
  ledger[0].report.completedAt = new Date(Date.parse(cutoff) + 1000).toISOString();
  ledger[0].report.attestation.signature = signClosureReceipt({ report: ledger[0].report, secret: authority.secret });
  hook = text => text.startsWith('SELECT id,tenant_id,ordinal::text') ? { rows: ledger } : undefined;
  const r = await read({ boundary: b, cutoff, now: Date.parse(cutoff) + 2000 });
  assert.equal(r.verified, true, JSON.stringify(r));
  assert.equal(r.counts.closedInternal, 0);
});
test('audit pool wrapper preserves native client errors during boundary capture', async () => {
  const { createOperationalAuditPool, withOperationalAuditCollection } = await import('./operational-audit-store.mjs');
  const raw = new EventEmitter(); let atSnapshot; let discarded = false;
  const started = new Promise(resolve => { atSnapshot = resolve; });
  raw.release = destroy => { discarded = destroy === true; };
  raw.query = async ({ text }) => {
    if (text.startsWith('SELECT pg_current_snapshot()')) { atSnapshot(); return new Promise(() => {}); }
    return { rows: [] };
  };
  const p = withOperationalAuditCollection(createOperationalAuditPool({ connect: async () => raw }),
    pool => api('captureDeadLetterAuditBoundary')({ pool }));
  await started;
  try { assert.doesNotThrow(() => raw.emit('error', new Error('private native client failure'))); }
  finally { const r = await p; assert.equal(r.verified, false); assert(discarded); }
});
test.each(['pending', 'denied', 'missing', 'expired'])('%s canonical approval blocked', async status => {
  if (status === 'missing') await query('DELETE FROM approvals');
  else if (status !== 'expired') await query('UPDATE approvals SET status=$1', [status]);
  const r = await execute(status === 'expired' ? { now: () => Date.now() + 86400001 } : {});
  failure(r); guards(r); assert.equal((await rows()).length, 0); assert(!log.includes('COMMIT'));
});
test('same intent is single use, exact replay remains valid after proposal expiry', async () => {
  assert.equal((await execute()).verified, true);
  const old = await rows(); const r = await execute({ now: () => Date.now() + 86400001 });
  assert.equal(r.verified, true, JSON.stringify(r)); assert.equal(r.replayed, true); assert.deepEqual(await rows(), old);
});
test('empty/mixed collector is honest open, installation missing is unavailable', async () => {
  await query('DELETE FROM call_embeddings'); const r = await read(); guards(r);
  assert.equal(r.verified, true); assert.deepEqual(r.counts, { total: 1, closedInternal: 0, open: 1, invalidated: 0 });
  await query('DROP TABLE pbk_dead_letter_closure_ledger'); failure(await read());
});
test('revocation requires fresh exact approval and append, cannot restore old credit', async () => {
  assert.equal((await execute()).verified, true); const prior = (await rows())[0];
  await query('DELETE FROM call_embeddings');
  approval = await seedClosureApproval(query, authority, { id: 'revoke-private', action: 'revoke_internal',
    predecessor: closureHead(authority, prior), manifest: approval.manifest });
  const r = await execute(); assert.equal(r.verified, true, JSON.stringify(r));
  assert.equal(r.counts.invalidated, 1); assert.equal(r.counts.closedInternal, 0);
  assert.equal((await rows()).length, 2); assert.deepEqual((await rows())[0], prior);
  assert.equal((await execute()).replayed, true);
});
test.each(['source', 'decision', 'intent'])('%s drift blocks admission or current credit', async kind => {
  assert.equal((await execute()).verified, true);
  if (kind === 'source') await query("UPDATE event_dead_letters SET error='changed'");
  if (kind === 'decision') await query("UPDATE approvals SET status='denied'");
  if (kind === 'intent') await query("UPDATE approvals SET payload=jsonb_set(payload,'{metadata,deadLetterClosureIntent,action}','\"revoke_internal\"')");
  const r = await read(); assert.equal(r.counts?.closedInternal, 0, JSON.stringify(r)); assert.equal(r.counts.invalidated, 1);
  failure(await execute()); assert.equal((await rows()).length, 1);
});
test('temporary outage restores only identical proof without modifying history', async () => {
  const r = await execute(); const old = await rows();
  hook = text => { if (text.includes('public.call_embeddings e')) throw new Error('private transport error'); };
  failure(await read()); assert.equal(released.at(-1), true);
  hook = null; assert.equal((await reverify(r.reference)).verified, true); assert.deepEqual(await rows(), old);
  await query("UPDATE call_embeddings SET metadata='{\"changed\":true}'");
  const changed = await read(); assert.equal(changed.counts.closedInternal, 0); failure(await reverify(r.reference));
});
test('lost original never reduces total silently, including frozen references', async () => {
  const r = await execute(); await query('DELETE FROM event_dead_letters'); failure(await read()); failure(await reverify(r.reference));
});
test('reference cannot select a newer beneficial close or survive a revoke', async () => {
  const open = await read(); assert.equal(open.counts.open, 1); await execute(); failure(await reverify(open.reference));
  const closed = await read(); const prior = (await rows())[0];
  approval = await seedClosureApproval(query, authority, { id: 'revoke-private', action: 'revoke_internal',
    predecessor: closureHead(authority, prior), manifest: approval.manifest });
  await execute(); failure(await reverify(closed.reference));
});
test('newest bad receipt never falls back and historical chain tampering denies credit', async () => {
  await execute(); const prior = (await rows())[0];
  approval = await seedClosureApproval(query, authority, { id: 'second-private', predecessor: closureHead(authority, prior) });
  await execute();
  hook = async (text, values) => {
    if (!text.includes('FROM public.pbk_dead_letter_closure_ledger')) return null;
    const result = await query(text, values);
    result.rows[1].report.attestation.signature = '0'.repeat(64); return result;
  };
  const r = await read(); assert.equal(r.counts.closedInternal, 0); assert.equal(r.counts.invalidated, 1);
});
test('historical revision authenticates under its own revision, current re-close needs new decision', async () => {
  await execute(); const prior = (await rows())[0]; authority.revision = 'c'.repeat(40);
  assert.equal((await read()).counts.invalidated, 1);
  approval = await seedClosureApproval(query, authority, { id: 'new-release', predecessor: closureHead(authority, prior) });
  const r = await execute(); assert.equal(r.verified, true, JSON.stringify(r)); assert.equal(r.counts.closedInternal, 1);
});
test('global history overflow denies all even with a valid selected case', async () => {
  await execute(); const row = (await rows())[0];
  hook = text => text.includes('FROM public.pbk_dead_letter_closure_ledger') ? { rows: Array(65).fill(row), rowCount: 65 } : null;
  failure(await read());
});
test('ambiguous approval mapping, nonzero decision micros, and wrong actual ID deny authority', async () => {
  await execute();
  await query("INSERT INTO approvals SELECT 'duplicate',workspace_id,type,status,payload,decided_at,created_at,updated_at FROM approvals");
  failure(await read()); await query("DELETE FROM approvals WHERE id='duplicate'");
  await query("UPDATE approvals SET decided_at=decided_at+interval '1 microsecond'");
  assert.equal((await read()).counts.closedInternal, 0);
});
test('client error during active work destroys without rollback or commit', async () => {
  hook = (text, values, client) => { if (text.includes('pg_advisory_xact_lock')) { client.emit('error', new Error('private')); return new Promise(() => {}); } };
  failure(await execute()); assert.equal(released.at(-1), true); assert(!log.includes('COMMIT')); assert(!log.includes('ROLLBACK'));
}, 5000);
test('late client acquisition is destroyed without queries', async () => {
  jest.useFakeTimers(); const client = new EventEmitter(); let destroyed;
  client.query = () => assert.fail('late client must not query'); client.release = value => { destroyed = value; };
  let resolve; const p = api('readDeadLetterClosures')({ ...authority, pool: { connect: () => new Promise(r => { resolve = r; }) } });
  await jest.advanceTimersByTimeAsync(2001); failure(await p); resolve(client); await jest.advanceTimersByTimeAsync(0);
  assert.equal(destroyed, true); jest.useRealTimers();
});
test('query timeout and nested timeout poisoning never queue rollback after abandonment', async () => {
  // Real DB setup finishes before fake timers; only the stalled native query is simulated.
  hook = text => { if (text.includes('public.call_embeddings e')) return new Promise(() => {}); };
  const p = read();
  while (!log.some(s => s.includes('public.call_embeddings e'))) await new Promise(r => setTimeout(r, 1));
  jest.useFakeTimers(); // the already scheduled native timer remains real (bounded to 2s).
  const r = await p; failure(r); assert.equal(released.at(-1), true);
  assert(!log.includes('COMMIT')); assert(!log.includes('ROLLBACK')); jest.useRealTimers();
}, 5000);
test('boundary is opaque authenticated data, reference tampering and future cutoff denied', async () => {
  const r = await read({ boundary: { auditSnapshot: 'fixture-boundary' } });
  assert.deepEqual(r.reference.boundary, { auditSnapshot: 'fixture-boundary' });
  const changed = structuredClone(r.reference); changed.boundary.auditSnapshot = 'changed'; failure(await reverify(changed));
  failure(await read({ cutoff: new Date(Date.now() + 60000).toISOString() }));
  assert.equal(typeof closureBinding(authority.secret, 'audit-reference', {}), 'string');
});
test('future canonical decision cannot authorize admission', async () => {
  const future = new Date(Date.now() + 60000).toISOString();
  await query("UPDATE approvals SET decided_at=$1::text::timestamptz,payload=jsonb_set(payload,'{actedAt}',to_jsonb($1::text))", [future]);
  failure(await execute()); assert.equal((await rows()).length, 0);
});
test('source drift before admission and caller approval JSON are never authority', async () => {
  await query("UPDATE event_dead_letters SET error='changed'"); failure(await execute());
  failure(await execute({ approval: { status: 'approved', intent: approval.intent } }));
  assert.equal((await rows()).length, 0);
});
test('stale predecessor or invented manifest cannot authorize another append', async () => {
  await execute(); approval = await seedClosureApproval(query, authority, { id: 'stale-predecessor' });
  failure(await execute()); assert.equal((await rows()).length, 1);
});
test('rollback abandonment destroys client and never queues a later commit', async () => {
  await query("UPDATE approvals SET status='pending'");
  hook = (text, values, client) => {
    if (text === 'ROLLBACK') { client.emit('error', new Error('private rollback error')); return new Promise(() => {}); }
  };
  failure(await execute()); assert.equal(released.at(-1), true);
  assert.equal(log.filter(s => s === 'ROLLBACK').length, 1); assert(!log.includes('COMMIT'));
});
test('metadata adapter swallowing a native error still poisons connection', async () => {
  hook = text => { if (text.includes('AS closure_capabilities')) throw new Error('private metadata error'); };
  failure(await read()); assert.deepEqual(released, [true]); assert(!log.includes('ROLLBACK'));
});
test('historical tamper, wrong secret, revision and broken predecessor never gain credit', async () => {
  await execute(); const prior = (await rows())[0];
  approval = await seedClosureApproval(query, authority, { id: 'second-history', predecessor: closureHead(authority, prior) });
  await execute();
  hook = async (text, values) => {
    if (!text.includes('FROM public.pbk_dead_letter_closure_ledger')) return null;
    const r = await query(text, values); r.rows[0].report.attestation.signature = '0'.repeat(64); return r;
  };
  assert.equal((await read()).counts.invalidated, 1); hook = null;
  assert.equal((await read({ secret: 'different local fixture secret' })).ok, false);
});
test('64 authenticated history rows prevent allocation of a 65th receipt', async () => {
  await execute(); const original = (await rows())[0]; const history = [original];
  for (let i = 1; i < 64; i++) {
    const intent = createClosureIntent({ ...authority, approvalId: `history-${i}`, action: 'close_internal',
      recordRef: original.record_ref, manifest: approval.manifest, predecessor: closureHead(authority, history.at(-1)),
      createdAt: original.report.intent.createdAt });
    const row = { ...JSON.parse(JSON.stringify(original)), id: `history-receipt-${i}`, ordinal: String(i + 1),
      approval_ref: intent.approvalRef, intent_binding: closureBinding(authority.secret, 'intent', intent),
      previous_id: history.at(-1).id };
    Object.assign(row.report, { receiptId: row.id, ordinal: row.ordinal, approvalRef: row.approval_ref,
      intentBinding: row.intent_binding, intent, predecessor: intent.predecessor });
    assert.equal(row.report.manifestBinding, intent.manifestBinding);
    row.report.attestation.signature = signClosureReceipt({ report: row.report, secret: authority.secret }); history.push(row);
  }
  approval = await seedClosureApproval(query, authority, { id: 'overflow-admission', predecessor: closureHead(authority, history.at(-1)) });
  hook = text => text.includes('FROM public.pbk_dead_letter_closure_ledger') ? { rows: history, rowCount: 64 } : null;
  log = []; failure(await execute()); assert(!log.some(s => s.includes('nextval(')));
  assert(!log.some(s => s.startsWith('INSERT INTO'))); assert.equal((await rows()).length, 1);
});
test('postcommit approval drift cannot pass independent readback; receipt remains immutable', async () => {
  let changed = false;
  hook = async text => {
    if (!changed && text.includes('REPEATABLE READ READ ONLY')) {
      changed = true; await query("UPDATE approvals SET status='denied'");
    }
  };
  failure(await execute()); assert.equal((await rows()).length, 1);
  assert.equal((await read()).counts.invalidated, 1);
});
test('empty originals and unsupported present originals yield honest bounded counts', async () => {
  await query('DELETE FROM event_dead_letters');
  const empty = await read(); assert.equal(empty.verified, true);
  assert.deepEqual(empty.counts, { total: 0, closedInternal: 0, open: 0, invalidated: 0 });
  await query(`INSERT INTO event_dead_letters VALUES ('unsupported-private','pbk','unsupported-event','other.event',
    'unknown','{}','preserved',now()-interval '1 hour')`);
  const unsupported = await read(); assert.equal(unsupported.verified, true); assert.equal(unsupported.counts.open, 1);
});
test('mixed eligible and blocked originals are all bound, including lost open sources', async () => {
  await query(`INSERT INTO event_dead_letters VALUES ('unsupported-private','pbk','unsupported-event','other.event',
    'unknown','{}','preserved',now()-interval '1 hour')`);
  const r = await execute(); assert.equal(r.verified, true, JSON.stringify(r));
  assert.deepEqual(r.counts, { total: 2, closedInternal: 1, open: 1, invalidated: 0 });
  assert.equal(r.reference.cases.length, 2);
  await query("DELETE FROM event_dead_letters WHERE id='unsupported-private'"); failure(await reverify(r.reference));
});
test('mapped approvals overflow and actual ID substitution deny all', async () => {
  await execute();
  const raw = (await query(`SELECT octet_length(to_jsonb(a)::text) AS bytes,
    to_jsonb(a)||jsonb_build_object('decided_at',to_char(decided_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) AS approval FROM approvals a`)).rows[0];
  hook = text => text.includes('ANY($1::text[]) ORDER BY a.id') ? { rows: Array(65).fill(raw) } : null;
  failure(await read());
  hook = text => {
    if (!text.includes('ANY($1::text[]) ORDER BY a.id')) return null;
    const altered = JSON.parse(JSON.stringify(raw)); altered.approval.id = 'substituted'; altered.approval.payload.id = 'substituted';
    return { rows: [altered] };
  };
  const substituted = await read();
  assert.equal(substituted.counts?.invalidated, 1, JSON.stringify(substituted));
});
test('unsafe input getters, rotated secrets and altered references fail without leaking data', async () => {
  let invoked = false;
  const input = { pool: pool(), ...authority };
  Object.defineProperty(input, 'reference', { enumerable: true, get() { invoked = true; throw new Error('private'); } });
  failure(await api('readDeadLetterClosures')(input)); assert.equal(invoked, false);
  const r = await execute(); const reference = JSON.parse(JSON.stringify(r.reference)); reference.cases[0].head.id = 'different';
  failure(await reverify(reference)); failure(await reverify({ ...r.reference, extra: true }));
  failure(await api('verifyDeadLetterClosureReference')({ pool: pool(), ...authority, secret: 'rotated fixture only', reference: r.reference }));
});

async function recording(operation) {
  const tape = [];
  hook = async (text, values) => { const r = await query(text, values);
    tape.push({ text, rows: JSON.parse(JSON.stringify(r.rows)), rowCount: r.rows.length }); return r; };
  const r = await operation(); assert.equal(r.verified, true, JSON.stringify(r)); hook = null;
  return tape;
}
function tapePool(tape, { delay = 0 } = {}) {
  const state = { connects: 0, queries: [], released: [] };
  state.pool = { connect: async () => {
    state.connects++; const c = new EventEmitter();
    c.release = destroy => state.released.push(Boolean(destroy));
    c.query = async ({ text, query_timeout }) => {
      state.queries.push(text); assert(query_timeout <= 2000);
      const next = tape.shift(); assert.equal(next?.text, text);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const result = new PgResult(); result.rows = next.rows; result.rowCount = next.rowCount; return result;
    };
    return c;
  } };
  return state;
}
test('read deadline is shared across individually bounded successful queries', async () => {
  const tape = await recording(() => read()); const scripted = tapePool(tape, { delay: 1500 });
  jest.useFakeTimers();
  const p = api('readDeadLetterClosures')({ pool: scripted.pool, ...authority });
  await jest.advanceTimersByTimeAsync(15001); failure(await p);
  assert.deepEqual(scripted.released, [true]); assert(!scripted.queries.includes('ROLLBACK'));
  jest.useRealTimers();
});
test('expired shared execution fence never acquires a readback client after commit', async () => {
  const tape = await recording(() => execute()); const prior = (await rows())[0]; const scripted = tapePool(tape);
  jest.useFakeTimers(); let ticks = 0;
  const now = () => {
    if (++ticks === 1) return Date.parse(prior.report.observedAt);
    if (ticks === 3) jest.advanceTimersByTime(60001);
    return Date.parse(prior.report.completedAt);
  };
  const r = await api('executeDeadLetterClosure')({ pool: scripted.pool, ...authority, approvalId: approval.approvalId, now });
  failure(r); await jest.advanceTimersByTimeAsync(0);
  assert.equal(scripted.connects, 1, 'deadline must be checked before requesting another client');
  assert.deepEqual(scripted.released, [false]); jest.useRealTimers();
});
test('late write query completion after timeout cannot insert, rollback or commit', async () => {
  let settle; hook = text => {
    if (text.includes('SELECT nextval(')) return new Promise(resolve => { settle = resolve; });
  };
  const p = execute();
  while (!settle) await new Promise(resolve => setTimeout(resolve, 1));
  failure(await p); assert.equal(released.at(-1), true);
  settle({ rows: [{ ordinal: '2', insert_xid: '1', admitted_at: new Date().toISOString().replace('Z', '000Z') }] });
  await Promise.resolve(); await Promise.resolve();
  assert(!log.some(s => s.startsWith('INSERT INTO'))); assert(!log.includes('ROLLBACK')); assert(!log.includes('COMMIT'));
}, 5000);
test('a reused approval ID cannot authorize a fresh revoke even with a newly signed intent', async () => {
  await execute(); const prior = (await rows())[0]; const createdAt = new Date(Date.now() - 1).toISOString();
  const intent = createClosureIntent({ ...authority, approvalId: approval.approvalId, action: 'revoke_internal',
    recordRef: approval.intent.recordRef, manifest: approval.manifest, predecessor: closureHead(authority, prior), createdAt });
  const payload = { id: approval.approvalId, type: 'admin', status: 'approved',
    approvalAction: 'dead_letter_internal_closure', actedAt: createdAt, metadata: { deadLetterClosureIntent: intent } };
  await query('UPDATE approvals SET payload=$1,decided_at=$2', [JSON.stringify(payload), createdAt]);
  failure(await execute()); assert.equal((await rows()).length, 1);
});
test.each(['pbk_call_qa_scores', 'call_embeddings', 'approvals'])('loss of %s invalidates, identical restored rows regain proof only', async table => {
  const r = await execute(); const ledger = await rows();
  const saved = (await query(`DELETE FROM public.${table} t RETURNING to_jsonb(t) AS row`)).rows;
  const missing = await read(); assert.equal(missing.counts.invalidated, 1); failure(await reverify(r.reference));
  for (const entry of saved) await query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table},$1::jsonb)`,
    [JSON.stringify(entry.row)]);
  assert.equal((await reverify(r.reference)).verified, true); assert.deepEqual(await rows(), ledger);
});
