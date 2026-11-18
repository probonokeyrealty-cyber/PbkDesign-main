import { randomUUID, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson } from './skill-governance-store.mjs';
import { closureBinding, projectClosureApproval, verifyClosureIntent, signClosureReceipt,
  verifyClosureReceipt, DEAD_LETTER_CLOSURE_LIMITS as LIMITS } from './dead-letter-closure-protocol.mjs';
import { collectDeadLetterClosureEvidence } from './dead-letter-closure-evidence.mjs';
import { verifyDeadLetterClosureInstallation } from './dead-letter-closure-migration.mjs';

const GUARD = Object.freeze({ noContact: true, providerWritesBlocked: true, deliveryRetries: false,
  providerDeliveryVerified: false, launchQualified: false });
const SCHEMA = 'pbk-dead-letter-closure-reference-v1';
const TABLE = 'public.pbk_dead_letter_closure_ledger';
const SEQUENCE = 'public.pbk_dead_letter_closure_ledger_ordinal_seq';
const BOUNDARY_SCHEMA = 'pbk-dead-letter-audit-boundary-v1';
const REASONS = new Set(['closure_invalid_input', 'closure_unavailable', 'closure_timeout',
  'closure_installation_invalid', 'closure_source_unavailable', 'closure_history_overflow',
  'closure_original_missing', 'closure_approval_invalid', 'closure_approval_ambiguous',
  'closure_intent_invalid', 'closure_predecessor_invalid', 'closure_source_changed',
  'closure_reference_invalid', 'closure_reference_changed', 'closure_cutoff_changed', 'closure_readback_failed']);
const fail = reason => { throw new Error(reason); };
const need = (v, reason = 'closure_invalid_input') => { if (!v) fail(reason); };
const failure = error => ({ ok: false, verified: false,
  result: REASONS.has(error?.message) ? error.message : 'closure_unavailable', counts: null, cases: [], reference: null, ...GUARD });
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(v);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const equalHash = (a, b) => hex(a) && hex(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const bind = (a, domain, value) => closureBinding(a.secret, domain, value);
const headRef = (a, row) => row ? { id: row.id, hash: bind(a, 'ledger-row', row) } : null;

function options(input, allowed) {
  need(!types.isProxy(input) && input && Object.getPrototypeOf(input) === Object.prototype);
  const ds = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(ds)) need(typeof key === 'string' && allowed.includes(key)
    && ds[key].enumerable && Object.hasOwn(ds[key], 'value'));
  return input;
}
function authority(a, now) {
  need(a.pool && typeof a.pool.connect === 'function' && typeof a.secret === 'string'
    && a.secret.trim().length > 0 && a.secret.length <= 4096
    && typeof a.revision === 'string' && /^[a-f0-9]{40}$/.test(a.revision));
  need(Number.isSafeInteger(now) && now >= 0 && Number.isFinite(new Date(now).getTime()));
}
function json(a, value) {
  bind(a, 'validate-store-input', value);
  return JSON.parse(canonicalJson(value));
}
function bounded(rows, reason = 'closure_history_overflow') {
  need(Array.isArray(rows) && rows.length <= LIMITS.maxRecords, reason); return rows;
}
function iso(value) {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value));
  need(Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value); return value;
}
export function validateDeadLetterAuditBoundary(boundary, cutoff) {
  try {
    options(boundary, ['databaseCapturedAt', 'schemaVersion', 'serverObservedAt', 'snapshot']);
    need(boundary && Object.getPrototypeOf(boundary) === Object.prototype
      && same(Object.keys(boundary).sort(), ['databaseCapturedAt', 'schemaVersion', 'serverObservedAt', 'snapshot']));
    need(boundary.schemaVersion === BOUNDARY_SCHEMA && typeof boundary.snapshot === 'string'
      && Buffer.byteLength(boundary.snapshot) <= 8192 && /^\d{1,20}:\d{1,20}:(?:\d{1,20}(?:,\d{1,20})*)?$/.test(boundary.snapshot));
    const [min, max, pending] = boundary.snapshot.split(':');
    const lo = BigInt(min), hi = BigInt(max), xips = pending ? pending.split(',').map(BigInt) : [];
    need(lo > 0n && lo <= hi && hi <= 18446744073709551615n
      && xips.every((x, i) => x >= lo && x < hi && (i === 0 || xips[i - 1] < x)));
    iso(boundary.databaseCapturedAt); iso(boundary.serverObservedAt); iso(cutoff);
    need(boundary.databaseCapturedAt <= boundary.serverObservedAt && boundary.serverObservedAt <= cutoff);
    return true;
  } catch { return false; }
}

export async function captureDeadLetterAuditBoundary(input) {
  let c;
  try {
    const a = options(input, ['pool', 'now']);
    const clock = a.now ?? Date.now; need(typeof clock === 'function' && a.pool?.connect);
    const started = clock(); need(Number.isSafeInteger(started) && started >= 0);
    c = await connection(a.pool, fence(LIMITS.collectionMs));
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await c.query(`SELECT pg_current_snapshot()::text AS snapshot,
      to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS database_captured_at`);
    need(rows.length === 1, 'closure_unavailable');
    const observed = clock(); need(Number.isSafeInteger(observed) && observed >= 0);
    const boundary = { schemaVersion: BOUNDARY_SCHEMA, snapshot: rows[0].snapshot,
      databaseCapturedAt: rows[0].database_captured_at, serverObservedAt: new Date(observed).toISOString() };
    need(validateDeadLetterAuditBoundary(boundary, boundary.serverObservedAt), 'closure_cutoff_changed');
    need(boundary.databaseCapturedAt >= new Date(started).toISOString(), 'closure_cutoff_changed');
    await c.query('ROLLBACK');
    return { ok: true, verified: true, result: 'closure_boundary_captured', boundary, ...GUARD };
  } catch (e) {
    c?.destroy(); return { ...failure(e), boundary: null };
  } finally { c?.release(); }
}
function fence(ms) { return { deadline: performance.now() + ms, abandoned: false }; }
function remaining(f) {
  need(!f.abandoned && f.deadline > performance.now(), 'closure_timeout');
  return Math.max(1, Math.floor(f.deadline - performance.now()));
}

// A timeout abandons the connection, not just the await. Never queue cleanup SQL
// behind work whose completion is unknown, including errors swallowed by adapters.
async function connection(pool, f) {
  const acquireMs = Math.min(LIMITS.queryMs, remaining(f));
  let client; let released = false; let rejectError;
  const errorSignal = new Promise((_, reject) => { rejectError = reject; });
  errorSignal.catch(() => {});
  const destroy = () => {
    f.abandoned = true;
    if (client && !released) { released = true; client.release(true); }
  };
  const onError = () => { destroy(); rejectError(new Error('closure_unavailable')); };
  let timer;
  const acquisition = Promise.resolve().then(() => pool.connect());
  acquisition.then(late => { if (f.abandoned) late.release(true); }, () => {});
  try {
    client = await Promise.race([acquisition, new Promise((_, reject) => {
      timer = setTimeout(() => { destroy(); reject(new Error('closure_timeout')); }, acquireMs);
    })]);
  } finally { clearTimeout(timer); }
  need(client && typeof client.query === 'function' && typeof client.release === 'function', 'closure_unavailable');
  client.on?.('error', onError);
  const query = async (text, values = []) => {
    const ms = Math.min(LIMITS.queryMs, remaining(f)); let timeout;
    try {
      const r = await Promise.race([errorSignal, Promise.resolve().then(() => {
        remaining(f); return client.query({ text, values, query_timeout: ms });
      }), new Promise((_, reject) => {
        timeout = setTimeout(() => { destroy(); reject(new Error('closure_timeout')); }, ms);
      })]);
      remaining(f);
      need(r && Array.isArray(r.rows), 'closure_unavailable');
      // pg.Result is a class instance; the collector deliberately accepts plain envelopes only.
      return { rows: r.rows, rowCount: r.rowCount };
    } catch (e) { destroy(); throw e; }
    finally { clearTimeout(timeout); }
  };
  return { query, destroy, release() {
    if (!released) { released = true; client.removeListener?.('error', onError); client.release(); }
  } };
}
async function transaction(a, f, write, work) {
  let c; let started = false;
  try {
    c = await connection(a.pool, f);
    await c.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    await c.query("SET LOCAL statement_timeout = '2000ms'");
    await c.query("SET LOCAL lock_timeout = '2000ms'");
    const installation = await verifyDeadLetterClosureInstallation(c.query);
    if (!installation.verified) { c.destroy(); fail('closure_installation_invalid'); }
    const result = await work(c);
    remaining(f);
    await c.query(write ? 'COMMIT' : 'ROLLBACK'); started = false;
    return result;
  } catch (e) {
    if (started && c && !f.abandoned) {
      try { await c.query('ROLLBACK'); } catch { c.destroy(); }
    }
    throw e;
  } finally { c?.release(); }
}

const LEDGER_SQL = `SELECT id,tenant_id,ordinal::text,
  to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at,
  insert_xid::text,record_ref,approval_ref,intent_binding,action,previous_id,
  CASE WHEN octet_length(report::text)<=65536 THEN report ELSE NULL END AS report
  FROM public.pbk_dead_letter_closure_ledger WHERE tenant_id='pbk' ORDER BY ordinal LIMIT 65`;
const APPROVAL_SELECT = `SELECT octet_length(to_jsonb(a)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(a)::text)<=65536 THEN to_jsonb(a) || jsonb_build_object(
    'decided_at',to_char(a.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ELSE NULL END AS approval
  FROM public.approvals a`;
function rawApproval(a, row) {
  need(row && Number.isSafeInteger(row.bytes) && row.bytes <= LIMITS.maxBytes && row.bytes >= 0,
    'closure_approval_invalid');
  return json(a, row.approval);
}
async function approvalById(c, a, approvalId, lock = false) {
  const { rows } = await c.query(`${APPROVAL_SELECT} WHERE a.id=$1 LIMIT 65${lock ? ' FOR UPDATE' : ''}`, [approvalId]);
  need(rows.length === 1, 'closure_approval_invalid');
  const raw = rawApproval(a, rows[0]); const projection = projectClosureApproval(raw);
  need(projection && projection.id === approvalId, 'closure_approval_invalid'); return projection;
}
async function evidence(c, a, now, write = false) {
  const r = await collectDeadLetterClosureEvidence({ secret: a.secret, revision: a.revision, now,
    query: (sql, values) => c.query(write && !sql.includes('SELECT EXISTS') ? `${sql} FOR SHARE` : sql, values) });
  if (!r.ok) { c.destroy(); fail('closure_source_unavailable'); }
  return r.cases;
}
async function history(c, a, cases, now) {
  const rows = bounded((await c.query(LEDGER_SQL)).rows).map(r => json(a, r));
  const originals = new Set(cases.map(r => r.recordRef));
  need(rows.every(r => hex(r.record_ref) && originals.has(r.record_ref)), 'closure_original_missing');
  const groups = new Map(cases.map(r => [r.recordRef, []]));
  const ids = new Set(); const intents = new Set(); let order = 0n;
  for (const row of rows) {
    need(id(row.id) && !ids.has(row.id) && !intents.has(row.intent_binding)
      && typeof row.ordinal === 'string' && /^[1-9][0-9]{0,19}$/.test(row.ordinal)
      && BigInt(row.ordinal) > order, 'closure_predecessor_invalid');
    order = BigInt(row.ordinal); ids.add(row.id); intents.add(row.intent_binding);
    groups.get(row.record_ref).push(row);
  }
  const chains = new Map();
  for (const [ref, members] of groups) {
    let prior = null; let valid = true;
    for (const row of members) {
      const report = row.report;
      const auth = verifyClosureReceipt({ row, secret: a.secret, revision: report?.revision, now });
      valid = valid && auth.verified && same(report?.predecessor ?? null, headRef(a, prior))
        && row.previous_id === (prior?.id ?? null)
        && (!prior || row.admitted_at >= prior.admitted_at);
      prior = row;
    }
    chains.set(ref, { members, head: prior, valid });
  }
  return { rows, chains };
}
async function decisions(c, a, heads) {
  const refs = [...new Set(heads.map(r => r.approval_ref))];
  if (!refs.length) return new Map();
  const { rows } = await c.query(`${APPROVAL_SELECT}
    WHERE a.payload #>> '{metadata,deadLetterClosureIntent,approvalRef}' = ANY($1::text[]) ORDER BY a.id LIMIT 65`, [refs]);
  bounded(rows, 'closure_approval_ambiguous');
  const mapped = new Map();
  for (const entry of rows) {
    const raw = rawApproval(a, entry);
    const ref = raw.payload?.metadata?.deadLetterClosureIntent?.approvalRef;
    need(refs.includes(ref) && !mapped.has(ref), 'closure_approval_ambiguous');
    // Bad canonical status/identity is retained as a null decision, never filtered away.
    const p = projectClosureApproval(raw);
    mapped.set(ref, p && equalHash(ref, bind(a, 'approval-ref', raw.id)) ? p : null);
  }
  return mapped;
}
function currentDecision(a, head, p) {
  return Boolean(p && equalHash(head.approval_ref, bind(a, 'approval-ref', p.id))
    && decisionAtAdmission(p, Date.parse(head.report.observedAt))
    && equalHash(head.report?.decisionBinding, bind(a, 'approval-decision', p))
    && equalHash(head.intent_binding, bind(a, 'intent', p.intent))
    && verifyClosureIntent({ intent: p.intent, approvalId: p.id, secret: a.secret,
      revision: head.report.revision, now: Date.parse(head.report.observedAt) }).verified);
}
function decisionAtAdmission(p, observed) {
  const decided = Date.parse(p.decidedAt);
  return decided >= Date.parse(p.intent.createdAt) && decided <= observed && decided < Date.parse(p.intent.expiresAt);
}
function caseStatus(a, source, chain, decision) {
  const head = chain.head;
  let status = 'open'; let reason = 'no_receipt';
  if (head) {
    status = 'invalidated'; reason = 'chain_invalid';
    if (chain.valid) {
      if (head.report.revision !== a.revision) reason = 'revision_changed';
      else if (!currentDecision(a, head, decision)) reason = 'approval_changed';
      else if (head.report.originalBinding !== source.originalBinding) reason = 'original_changed';
      else if (head.action === 'revoke_internal') reason = 'revoked';
      else if (!source.eligible || head.report.manifestBinding !== bind(a, 'manifest', source.manifest)) reason = 'proof_changed';
      else { status = 'closed_internal'; reason = 'current_proof_verified'; }
    }
  }
  return { recordRef: source.recordRef, originalBinding: source.originalBinding,
    selectionBinding: source.selectionBinding, manifestBinding: source.eligible ? bind(a, 'manifest', source.manifest) : null,
    head: headRef(a, head), decisionBinding: decision ? bind(a, 'approval-decision', decision) : null, status, reason };
}
function authenticateReference(a, value) {
  const r = json(a, value);
  need(r && Object.keys(r).sort().join(',') === ['schemaVersion', 'tenantId', 'revision', 'cutoff', 'boundary',
    'counts', 'cases', 'attestation'].sort().join(','), 'closure_reference_invalid');
  const { attestation, ...body } = r;
  need(r.schemaVersion === SCHEMA && r.tenantId === 'pbk' && r.revision === a.revision
    && attestation && same(Object.keys(attestation).sort(), ['signature', 'version'])
    && attestation.version === SCHEMA && equalHash(attestation.signature, bind(a, 'audit-reference', body)), 'closure_reference_invalid');
  iso(r.cutoff); bounded(r.cases); return r;
}
async function readWithFence(a, f, now) {
  const reference = a.reference === undefined ? null : authenticateReference(a, a.reference);
  const cutoff = iso(reference?.cutoff ?? a.cutoff ?? new Date(now).toISOString());
  need(Date.parse(cutoff) <= now);
  const boundary = json(a, reference ? reference.boundary : a.boundary ?? null);
  const auditBoundary = boundary?.schemaVersion === BOUNDARY_SCHEMA;
  if (auditBoundary) need(validateDeadLetterAuditBoundary(boundary, cutoff), 'closure_cutoff_changed');
  if (reference && a.cutoff !== undefined) need(a.cutoff === cutoff, 'closure_reference_invalid');
  if (reference && a.boundary !== undefined) need(same(json(a, a.boundary), boundary), 'closure_reference_invalid');
  const readFence = { deadline: Math.min(f.deadline, performance.now() + LIMITS.collectionMs), abandoned: false };
  return transaction(a, readFence, false, async c => {
    // Require both current freshness (notably skip TTL) and source/proof times at cutoff.
    // Both collectors use this same read-only transaction and remaining query fence.
    let cases = await evidence(c, a, now);
    if (auditBoundary) {
      const atCutoff = new Map((await evidence(c, a, Date.parse(cutoff))).map(s => [s.recordRef, s]));
      cases = cases.map(s => s.eligible && atCutoff.get(s.recordRef)?.eligible
        && same(s.manifest, atCutoff.get(s.recordRef).manifest) ? s : { ...s, eligible: false, manifest: null });
    }
    const { rows, chains } = await history(c, a, cases, now);
    // Timestamp cutoffs are observations only, never a commit/snapshot visibility claim.
    if (!auditBoundary) need(rows.every(r => typeof r.admitted_at === 'string'
      && r.admitted_at <= `${cutoff.slice(0, 23)}000Z`), 'closure_cutoff_changed');
    const heads = [...chains.values()].map(v => v.head).filter(Boolean);
    let visible;
    if (auditBoundary && heads.length) {
      const checked = bounded((await c.query(`SELECT id,pg_visible_in_snapshot(insert_xid,$1::pg_snapshot) AS visible
        FROM public.pbk_dead_letter_closure_ledger WHERE tenant_id='pbk' AND id=ANY($2::text[])
        ORDER BY ordinal LIMIT 65`, [boundary.snapshot, heads.map(h => h.id)])).rows);
      need(checked.length === heads.length && new Set(checked.map(r => r.id)).size === heads.length
        && checked.every(r => heads.some(h => h.id === r.id) && typeof r.visible === 'boolean'), 'closure_cutoff_changed');
      visible = new Set(checked.filter(r => r.visible).map(r => r.id));
    }
    const current = await decisions(c, a, [...chains.values()].map(v => v.head).filter(Boolean));
    const statuses = cases.map(s => { const chain = chains.get(s.recordRef);
      const status = caseStatus(a, s, chain, chain.head ? current.get(chain.head.approval_ref) : null);
      if (auditBoundary && chain.head && (!visible.has(chain.head.id)
        || chain.head.admitted_at > `${cutoff.slice(0, 23)}000Z`
        || chain.head.report?.observedAt > cutoff || chain.head.report?.completedAt > cutoff)) {
        status.status = 'invalidated'; status.reason = 'cutoff_ineligible';
      }
      return status; });
    const counts = { total: statuses.length, closedInternal: statuses.filter(s => s.status === 'closed_internal').length,
      open: statuses.filter(s => s.status === 'open').length, invalidated: statuses.filter(s => s.status === 'invalidated').length };
    const body = { schemaVersion: SCHEMA, tenantId: 'pbk', revision: a.revision, cutoff, boundary, counts, cases: statuses };
    if (reference) { const { attestation: _, ...prior } = reference;
      need(same(prior, body), 'closure_reference_changed'); }
    const signed = { ...body, attestation: { version: SCHEMA, signature: bind(a, 'audit-reference', body) } };
    const result = { ok: true, verified: true, result: 'closure_summary_verified', counts, cases: statuses, reference: signed, ...GUARD };
    json(a, result); need(Buffer.byteLength(canonicalJson(signed)) <= LIMITS.maxBytes, 'closure_reference_invalid'); return result;
  });
}

export async function readDeadLetterClosures(input) {
  try {
    const a = options(input, ['pool', 'secret', 'revision', 'now', 'cutoff', 'reference', 'boundary', 'deadlineAt']);
    const now = a.now ?? Date.now(); authority(a, now);
    const f = fence(LIMITS.collectionMs);
    if (a.deadlineAt !== undefined) { need(Number.isFinite(a.deadlineAt)); f.deadline = Math.min(f.deadline, a.deadlineAt); }
    return await readWithFence(a, f, now);
  } catch (e) { return failure(e); }
}
export async function verifyDeadLetterClosureReference(input) {
  try {
    const a = options(input, ['pool', 'secret', 'revision', 'now', 'reference', 'deadlineAt']);
    need(a.reference !== undefined, 'closure_reference_invalid');
    return await readDeadLetterClosures(a);
  } catch (e) { return failure(e); }
}

// Trusted proposal preparation only. Reuse the reader's bounded snapshot and
// authenticated chain; never return raw originals, approvals, or ledger rows.
export async function readDeadLetterClosureProposalContext(input) {
  try {
    const a = options(input, ['pool', 'secret', 'revision', 'recordRef', 'action', 'now']);
    const now = a.now ?? Date.now(); authority(a, now);
    need(hex(a.recordRef) && ['close_internal', 'revoke_internal'].includes(a.action));
    return await transaction(a, fence(LIMITS.collectionMs), false, async c => {
      const cases = await evidence(c, a, now);
      const source = cases.find(s => s.recordRef === a.recordRef);
      need(source, 'closure_original_missing');
      const ledger = await history(c, a, cases, now);
      const chain = ledger.chains.get(a.recordRef);
      need(chain.valid, 'closure_predecessor_invalid');
      need(ledger.rows.length < LIMITS.maxRecords, 'closure_history_overflow');
      let manifest;
      if (a.action === 'revoke_internal') {
        need(chain.head?.action === 'close_internal', 'closure_predecessor_invalid');
        manifest = chain.head.report.manifest;
        need(manifest.originalBinding === source.originalBinding, 'closure_source_changed');
      } else {
        need(source.eligible, 'closure_source_changed'); manifest = source.manifest;
      }
      return { ok: true, verified: true, result: 'closure_proposal_context_verified',
        manifest, predecessor: headRef(a, chain.head), ...GUARD };
    });
  } catch (e) { return failure(e); }
}

export async function executeDeadLetterClosure(input) {
  try {
    const a = options(input, ['pool', 'secret', 'revision', 'approvalId', 'now']);
    const clock = a.now ?? Date.now; need(typeof clock === 'function');
    const observed = clock(); authority(a, observed); need(id(a.approvalId));
    const f = fence(LIMITS.executionMs);
    const written = await transaction(a, f, true, async c => {
      const discovered = await approvalById(c, a, a.approvalId);
      await c.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',
        [`pbk:dead-letter-closure:${discovered.intent.recordRef}`]);
      const decision = await approvalById(c, a, a.approvalId, true);
      need(same(discovered, decision), 'closure_approval_invalid');
      const intent = decision.intent;
      const cases = await evidence(c, a, observed, true);
      const source = cases.find(s => s.recordRef === intent.recordRef);
      need(source && source.originalBinding === intent.originalBinding, 'closure_source_changed');
      const ledger = await history(c, a, cases, observed);
      const chain = ledger.chains.get(intent.recordRef); const head = chain.head;
      need(chain.valid, 'closure_predecessor_invalid');
      const used = ledger.rows.find(r => r.intent_binding === bind(a, 'intent', intent));
      if (used) {
        need(head?.id === used.id && currentDecision(a, head, decision)
          && head.report.revision === a.revision && (head.action === 'revoke_internal'
            || (source.eligible && head.report.manifestBinding === bind(a, 'manifest', source.manifest))), 'closure_intent_invalid');
        return { receipt: headRef(a, head), replayed: true, action: head.action };
      }
      need(verifyClosureIntent({ intent, approvalId: a.approvalId, secret: a.secret,
        revision: a.revision, now: observed }).verified, 'closure_intent_invalid');
      need(decisionAtAdmission(decision, observed), 'closure_approval_invalid');
      need(!ledger.rows.some(r => r.approval_ref === intent.approvalRef), 'closure_approval_invalid');
      need(ledger.rows.length < LIMITS.maxRecords, 'closure_history_overflow');
      need(same(intent.predecessor, headRef(a, head)), 'closure_predecessor_invalid');
      let manifest;
      if (intent.action === 'revoke_internal') {
        need(head && head.action === 'close_internal', 'closure_predecessor_invalid');
        manifest = head.report.manifest;
      } else { need(source.eligible, 'closure_source_changed'); manifest = source.manifest; }
      need(intent.manifestBinding === bind(a, 'manifest', manifest), 'closure_source_changed');
      const { rows } = await c.query(`SELECT nextval($1::regclass)::text AS ordinal,
        pg_current_xact_id()::text AS insert_xid,
        to_char(date_trunc('milliseconds',clock_timestamp()) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted_at`, [SEQUENCE]);
      need(rows.length === 1, 'closure_unavailable');
      const allocated = rows[0]; const completed = clock(); authority(a, completed);
      const report = { schemaVersion: 'pbk-dead-letter-closure-v1', tenantId: 'pbk', receiptId: randomUUID(),
        ordinal: allocated.ordinal, admittedAt: allocated.admitted_at, insertXid: allocated.insert_xid,
        recordRef: intent.recordRef, originalBinding: intent.originalBinding, manifestBinding: intent.manifestBinding,
        policyVersion: intent.policyVersion, approvalRef: intent.approvalRef, intentBinding: bind(a, 'intent', intent),
        decisionBinding: bind(a, 'approval-decision', decision), action: intent.action, predecessor: intent.predecessor,
        revision: a.revision, observedAt: new Date(observed).toISOString(), completedAt: new Date(completed).toISOString(),
        approvalExpiresAt: intent.expiresAt, manifest, intent, guard: { counts: null, ...GUARD } };
      report.attestation = { version: report.schemaVersion, signature: signClosureReceipt({ report, secret: a.secret }) };
      const row = { id: report.receiptId, tenant_id: 'pbk', ordinal: report.ordinal, admitted_at: report.admittedAt,
        insert_xid: report.insertXid, record_ref: report.recordRef, approval_ref: report.approvalRef,
        intent_binding: report.intentBinding, action: report.action, previous_id: report.predecessor?.id ?? null, report };
      await c.query(`INSERT INTO ${TABLE} (id,tenant_id,ordinal,admitted_at,insert_xid,record_ref,
        approval_ref,intent_binding,action,previous_id,report) OVERRIDING SYSTEM VALUE
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, Object.values(row));
      return { receipt: headRef(a, row), replayed: false, action: intent.action };
    });
    // No nested checkout: independent verification works even with a native pool max:1.
    const summary = await readWithFence(a, f, clock());
    const status = summary.cases.find(s => same(s.head, written.receipt));
    need(status && (written.action === 'close_internal' ? status.status === 'closed_internal' : status.reason === 'revoked'),
      'closure_readback_failed');
    remaining(f);
    return { ...summary, result: 'closure_execution_verified', receipt: written.receipt, replayed: written.replayed };
  } catch (e) { return failure(e); }
}
