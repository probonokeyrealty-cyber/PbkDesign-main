import { createHmac, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson } from './skill-governance-store.mjs';
import { closureBinding } from './dead-letter-closure-protocol.mjs';
import { isExcludedEpisodicCall, selectBestEpisodicTranscript } from './ava-episodic-memory.mjs';

/* Integration/provenance contract:
 * - recordCallMemorySkip is called ONLY inside the existing authenticated, founder-gated
 *   memory tool, immediately after the real insufficient_call_memory branch. This store
 *   cannot independently prove execution of its caller; no caller-supplied receipt is accepted.
 * - pool/secret/revision/now are server-owned (existing bridge key/build revision/clock).
 *   eventId/callId are lookup hints, sourceText is the tool's already-normalized selection.
 *   Each is checked against a durable PBK provider-origin call.completed dead letter;
 *   canonical PBK call transcript/notes are reloaded, including provider identity aliases.
 * - Missing canonical context is supported only with that durable original. Canonical-only
 *   calls/normal events without dead letters, ambiguous aliases, synthetic/controlled and
 *   unknown-origin sources are unsupported. Provider-origin here means trusted stored event
 *   provenance, NOT independent provider delivery or organic-operation certification.
 * - One opaque deterministic pbk_eval_runs slot per event/key, not an append-only parallel
 *   ledger. Fresh identical executions are idempotent, without refreshing time. Changed,
 *   expired or new-revision evidence requires another real execution before replacement.
 *   A read never records or repairs evidence; no fallback to older source/key/revision.
 * - All bindings are domain-separated HMACs, including low-entropy normalized source text.
 *   No raw call/event ids, transcripts, seller PII or caller reports are persisted/returned.
 * - Reads use one bounded snapshot (64 originals/calls/receipts, 64KiB source rows,
 *   4KiB receipts, 2s query/acquisition timeout and shared 10s deadline). Pool clients are
 *   destroyed on abandonment; no retry, provider request, DDL, approval or delivery write.
 * - Fresh means [execution, execution+24h), current policy80 and exact build revision.
 *   Summary counts: events = verifiedSkips + unverified + notApplicable. >=80 current
 *   normalized chars are not_applicable, never a skip/embedding verification. verified is
 *   true only with >=1 genuine skip and zero unverified sources. Empty/all-N/A is not a pass.
 *   These are supplementary memoryPolicyOutcomes, NEVER backlog-v1 memoryVerified,
 *   fullRecovery, delivery/launch readiness or an excuse to manufacture old embeddings.
 */

const SCHEMA = 'pbk-call-memory-skip-v1';
const SUITE = 'call_memory_skip_v1';
const SOURCE = 'server:call-memory-skip:v1';
const POLICY = Object.freeze({ version: 'episodic-short-source-v1', minimumChars: 80,
  normalization: 'selectBestEpisodicTranscript-v1' });
const LIMIT = 64;
const ROW_BYTES = 65536;
const REPORT_BYTES = 4096;
const DAY_MS = 86400_000;
const DEADLINE_MS = 10_000;
const QUERY_MS = 2000;
const PROVIDERS = new Set(['telnyx-deepgram-finalize', 'telnyx-recording-capture']);
const GUARDS = Object.freeze({ embeddingVerified: false, fullRecovery: false,
  providerDeliveryVerified: false, launchQualified: false, noContact: true, providerWritesBlocked: true });
const plain = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && /^\S{1,256}$/.test(value)
  && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const clock = value => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
const iso = value => new Date(value).toISOString();
const fail = reason => { throw Object.assign(new Error(reason), { reason }); };

function failure(reason) {
  return { ok: false, verified: false, complete: false, result: reason, source: 'postgres:pbk_eval_runs',
    recordRef: null, counts: null, outcomes: [], issues: [reason], ...GUARDS };
}
function authority({ pool, secret, revision, now }) {
  return pool && typeof pool.connect === 'function' && pool.controlled !== true
    && typeof secret === 'string' && secret.trim().length > 0
    && typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision) && clock(now);
}
function keyed(secret, domain, value) {
  return createHmac('sha256', secret).update(`pbk:call-memory-skip:v1:${domain}\0`)
    .update(canonicalJson(value)).digest('hex');
}
function signature(report, secret) {
  const { attestation: _ignored, ...unsigned } = report;
  const key = createHmac('sha256', secret).update('pbk.call-memory-skip.signing-key.v1').digest();
  return createHmac('sha256', key).update(`${SCHEMA}\n${canonicalJson(unsigned)}`).digest('hex');
}
function slot(recordRef) { return `call-memory-skip-v1:${recordRef}`; }
function time(value, now) {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  return clock(parsed) && parsed <= now ? parsed : null;
}
function identity(value, keys) {
  const values = keys.filter(key => Object.hasOwn(value, key)).map(key => value[key]);
  return values.length && values.every(id) && values.every(v => v === values[0]) ? values[0] : null;
}
function operational(value, depth = 0) {
  if (!plain(value) || depth > 16) return false;
  if (['synthetic', 'fixture', 'test', 'controlled', 'demo', 'sample'].some(key =>
    Object.hasOwn(value, key) && value[key] !== false)) return false;
  if (/synthetic|fixture|controlled-qualification|chaos-test|\b(?:demo|mock|sample|seed)\b/i
    .test(String(value.source || value.provider || ''))) return false;
  return !Object.hasOwn(value, 'metadata') || operational(value.metadata, depth + 1);
}
function boundedRow(row, maximum = ROW_BYTES) {
  if (!plain(row) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) fail('invalid_source');
  if (row.bytes > maximum) fail('source_overflow');
  if (!plain(row.original)) fail('invalid_source');
  return row.original;
}
function originalContext(original, now) {
  const p = original.payload;
  if (original.tenant_id !== 'pbk' || !id(original.id) || !id(original.event_id)
    || original.event_type !== 'call.completed' || !PROVIDERS.has(original.source)
    || time(original.created_at, now) === null || !plain(p)
    || !operational(original) || !operational(p)) fail('source_unverified');
  const callId = identity(p, ['callId', 'call_id']);
  if (!callId || identity(p, ['workspaceId', 'workspace_id']) !== 'pbk'
    || ['tenantId', 'tenant_id'].some(key => Object.hasOwn(p, key) && p[key] !== 'pbk')
    || isExcludedEpisodicCall({ ...p, id: callId })) fail('source_unverified');
  // The supported durable source is the event-worker call.completed replay contract.
  const transcript = p.transcript || p.transcriptText || p.transcript_text || '';
  if (!selectBestEpisodicTranscript([transcript])) fail('source_unverified');
  return { callId, transcript };
}
function matches(call, callId) {
  return ['id', 'telnyx_call_control_id', 'telnyx_call_leg_id', 'telnyx_call_session_id']
    .some(key => call[key] === callId);
}
function currentSource(original, calls, { secret, now }) {
  const context = originalContext(original, now);
  const matching = calls.filter(call => matches(call, context.callId));
  if (matching.length > 1) fail('source_ambiguous');
  const call = matching[0] || null;
  if (call && (call.workspace_id !== 'pbk' || !id(call.id) || call.provider !== 'telnyx'
    || time(call.created_at, now) === null || time(call.updated_at, now) === null
    || time(call.updated_at, now) < time(call.created_at, now)
    || !operational(call) || isExcludedEpisodicCall(call))) fail('source_unverified');
  const text = selectBestEpisodicTranscript([context.transcript, call?.transcript, call?.notes]);
  if (!text || text.length >= POLICY.minimumChars) fail('not_short_source');
  return { text, callId: context.callId, recordRef: keyed(secret, 'event-ref', original.event_id),
    callRef: keyed(secret, 'call-ref', context.callId),
    sourceHash: keyed(secret, 'normalized-source', text),
    sourceBinding: keyed(secret, 'source-binding', { original, call }) };
}
function unsignedReceipt(source, revision, executedAt) {
  return { schemaVersion: SCHEMA, tenantId: 'pbk', recordRef: source.recordRef, callRef: source.callRef,
    sourceHash: source.sourceHash, sourceBinding: source.sourceBinding, revision,
    policy: { ...POLICY }, outcome: 'skipped_short_source', executedAt };
}
function verify(row, source, { secret, revision, now }) {
  if (!row) return 'receipt_missing';
  const r = row.report;
  if (!plain(r) || Buffer.byteLength(JSON.stringify(r)) > REPORT_BYTES) return 'receipt_unverified';
  const at = typeof r.executedAt === 'string' ? time(r.executedAt, now) : null;
  if (at === null || r.executedAt !== iso(at) || now - at >= DAY_MS) return 'receipt_stale';
  const stored = time(row.created_at, now);
  if (stored !== at || row.id !== slot(source.recordRef) || row.tenant_id !== 'pbk'
    || row.created_at_exact !== `${iso(at).slice(0, -1)}000Z`
    || row.suite_name !== SUITE || row.source !== SOURCE || row.ok !== false
    || row.total !== 1 || row.passed !== 0 || row.failed !== 1) return 'receipt_unverified';
  if (r.revision !== revision) return 'revision_mismatch';
  const attestation = r.attestation;
  if (!plain(attestation) || Object.keys(attestation).length !== 2 || attestation.version !== SCHEMA
    || typeof attestation.signature !== 'string' || !/^[a-f0-9]{64}$/.test(attestation.signature)
    || !timingSafeEqual(Buffer.from(attestation.signature, 'hex'), Buffer.from(signature(r, secret), 'hex'))) {
    return 'signature_invalid';
  }
  if (r.sourceBinding !== source.sourceBinding || r.sourceHash !== source.sourceHash) return 'source_changed';
  const { attestation: _ignored, ...unsigned } = r;
  return canonicalJson(unsigned) === canonicalJson(unsignedReceipt(source, revision, r.executedAt))
    ? null : 'receipt_unverified';
}

/** Pure current-source adapter. A read authenticates an existing execution; it never records one. */
export function verifyCallMemorySkipEvidence(input) {
  const guard = { counts: null, noContact: true, providerWritesBlocked: true, deliveryRetries: false,
    providerDeliveryVerified: false, launchQualified: false };
  const denied = result => ({ ok: false, verified: false, result, ...guard });
  try {
    if (types.isProxy(input) || !plain(input)) return denied('invalid_input');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string'
      || !descriptors[k].enumerable || !Object.hasOwn(descriptors[k], 'value'))) return denied('invalid_input');
    const { original, calls, receipt, secret, revision, now } = input;
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096
      || typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision) || !clock(now)) return denied('invalid_input');
    // Reuse the protocol's descriptor-safe, depth/node/byte-bounded JSON validation.
    closureBinding(secret, 'skip-evidence-input', { original, calls, receipt, revision, now });
    if (!Array.isArray(calls) || calls.length > LIMIT || !calls.every(plain)) return denied('invalid_input');
    const source = currentSource(original, calls, { secret, now });
    const issue = verify(receipt, source, { secret, revision, now });
    if (issue) return denied(issue);
    return { ok: true, verified: true, result: 'call_memory_skip_verified', ...guard,
      outcome: 'skipped_short_source', executedAt: receipt.report.executedAt,
      artifactRef: closureBinding(secret, 'memory-skip-artifact-ref', receipt.id),
      binding: closureBinding(secret, 'memory-skip-artifact', receipt) };
  } catch (error) { return denied(reason(error)); }
}

async function withTransaction(pool, readOnly, action) {
  const deadline = performance.now() + DEADLINE_MS;
  let client;
  let destroyed = false;
  let released = false;
  const release = destroy => {
    if (!released && client) { released = true; client.release(destroy); }
  };
  const bounded = async (operation, onLate) => {
    const ms = Math.min(QUERY_MS, Math.floor(deadline - performance.now()));
    if (destroyed || ms <= 0) fail('query_failed');
    let timer;
    let expired = false;
    const pending = Promise.resolve().then(() => {
      if (destroyed) fail('query_failed');
      return operation(ms);
    });
    pending.then(value => { if (expired) onLate?.(value); }, () => {}).catch(() => {});
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true; destroyed = true;
          try { release(true); } finally { reject(Object.assign(new Error('query_failed'), { reason: 'query_failed' })); }
        }, ms);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    client = await bounded(() => pool.connect(), late => late?.release(true));
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') fail('source_unavailable');
    const query = (text, values = []) => bounded(ms => client.query({ text, values, query_timeout: ms }));
    await query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    try {
      await query("SET LOCAL statement_timeout = '1500ms'");
      await query("SET LOCAL lock_timeout = '500ms'");
      await query("SET LOCAL idle_in_transaction_session_timeout = '3000ms'");
      const result = await action(query);
      await query(readOnly ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (error) {
      if (!destroyed) await query('ROLLBACK').catch(() => {});
      throw error;
    }
  } catch (error) {
    destroyed = true;
    throw error;
  } finally { release(destroyed); }
}

async function originals(query, eventId) {
  const { rows } = await query(`SELECT octet_length(to_jsonb(d)::text) AS bytes,
      CASE WHEN octet_length(to_jsonb(d)::text) <= 65536 THEN to_jsonb(d) ELSE NULL END AS original
    FROM public.event_dead_letters d WHERE d.tenant_id = 'pbk'${eventId === undefined ? '' : ' AND d.event_id = $1'}
    ORDER BY d.id LIMIT 65${eventId === undefined ? '' : ' FOR SHARE OF d'}`, eventId === undefined ? [] : [eventId]);
  if (!Array.isArray(rows) || rows.length > LIMIT) fail('source_overflow');
  const result = rows.map(row => boundedRow(row));
  const events = result.map(row => row.event_id);
  if (new Set(events).size !== events.length) fail('source_ambiguous');
  return result;
}
async function canonicalCalls(query, callIds, lock) {
  if (!callIds.length) return [];
  // Reject identity collisions without loading another tenant's call content.
  const collision = await query(`SELECT EXISTS(SELECT 1 FROM public.calls c
    WHERE c.workspace_id IS DISTINCT FROM 'pbk' AND (c.id = ANY($1::text[])
      OR c.telnyx_call_control_id = ANY($1::text[]) OR c.telnyx_call_leg_id = ANY($1::text[])
      OR c.telnyx_call_session_id = ANY($1::text[]))) AS outside_scope`, [callIds]);
  if (collision.rows?.[0]?.outside_scope !== false) fail('source_unverified');
  const { rows } = await query(`SELECT octet_length(to_jsonb(c)::text) AS bytes,
      CASE WHEN octet_length(to_jsonb(c)::text) <= 65536 THEN to_jsonb(c) ELSE NULL END AS original
    FROM public.calls c WHERE c.workspace_id = 'pbk' AND (c.id = ANY($1::text[])
      OR c.telnyx_call_control_id = ANY($1::text[]) OR c.telnyx_call_leg_id = ANY($1::text[])
      OR c.telnyx_call_session_id = ANY($1::text[])) ORDER BY c.id LIMIT 65${lock ? ' FOR SHARE OF c' : ''}`, [callIds]);
  if (!Array.isArray(rows) || rows.length > LIMIT) fail('source_overflow');
  return rows.map(row => boundedRow(row));
}
async function receiptRows(query, refs) {
  if (!refs.length) return [];
  const { rows } = await query(`SELECT id, tenant_id, suite_name, source, ok, total, passed, failed, created_at,
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
      CASE WHEN octet_length(report::text) <= 4096 THEN report ELSE NULL END AS report
    FROM public.pbk_eval_runs WHERE id = ANY($1::text[]) ORDER BY id LIMIT 65`, [refs.map(slot)]);
  if (!Array.isArray(rows) || rows.length > LIMIT) fail('source_overflow');
  return rows;
}
function reason(error) {
  return ['source_overflow', 'source_unverified', 'source_ambiguous', 'not_short_source',
    'source_missing', 'source_mismatch', 'query_failed', 'invalid_source', 'source_unavailable', 'store_busy']
    .includes(error?.reason) ? error.reason : 'source_unavailable';
}

/** Trusted internal seam ONLY: call after the real upsert branch evaluated insufficient_call_memory.
 * This helper validates durable provenance, not authentication or proof of its own call site.
 * Never expose it as a tool/endpoint or pass caller-controlled now/revision/secret/pool. */
export async function recordCallMemorySkip({ pool, secret, revision, eventId, callId, sourceText, now = Date.now() } = {}) {
  if (!authority({ pool, secret, revision, now }) || !id(eventId) || !id(callId)
    || typeof sourceText !== 'string' || !sourceText || sourceText.length >= POLICY.minimumChars
    || selectBestEpisodicTranscript([sourceText]) !== sourceText) return failure('invalid_input');
  try {
    return await withTransaction(pool, false, async query => {
      const recordRef = keyed(secret, 'event-ref', eventId);
      const lock = await query('SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS acquired', [SOURCE, recordRef]);
      if (lock.rows?.[0]?.acquired !== true) fail('store_busy');
      const rows = await originals(query, eventId);
      if (rows.length !== 1) fail('source_missing');
      const context = originalContext(rows[0], now);
      if (context.callId !== callId) fail('source_mismatch');
      const calls = await canonicalCalls(query, [callId], true);
      const source = currentSource(rows[0], calls, { secret, now });
      if (source.text !== sourceText) fail('source_mismatch');
      const existing = (await receiptRows(query, [recordRef]))[0];
      if (verify(existing, source, { secret, revision, now }) !== null) {
        const report = unsignedReceipt(source, revision, iso(now));
        report.attestation = { version: SCHEMA, signature: signature(report, secret) };
        const result = await query(`INSERT INTO public.pbk_eval_runs
            (id,tenant_id,suite_name,source,ok,total,passed,failed,report,created_at)
          VALUES ($1,'pbk',$2,$3,FALSE,1,0,1,$4::jsonb,$5::timestamptz)
          ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,suite_name=EXCLUDED.suite_name,
            source=EXCLUDED.source,ok=FALSE,total=1,passed=0,failed=1,report=EXCLUDED.report,created_at=EXCLUDED.created_at
          WHERE public.pbk_eval_runs.tenant_id='pbk' AND public.pbk_eval_runs.suite_name=$2
            AND public.pbk_eval_runs.source=$3 RETURNING id`, [slot(recordRef), SUITE, SOURCE, JSON.stringify(report), iso(now)]);
        if (result.rows?.length !== 1) fail('invalid_source');
        const stored = (await receiptRows(query, [recordRef]))[0];
        if (verify(stored, source, { secret, revision, now }) !== null) fail('invalid_source');
      }
      return { ok: true, verified: true, result: 'call_memory_skip_recorded', source: 'postgres:pbk_eval_runs',
        recordRef, outcome: 'skipped_short_source', ...GUARDS };
    });
  } catch (error) { return failure(reason(error)); }
}

/** Read-only supplementary evidence. Never merge these counts into embedding/backlog-v1 recovery. */
export async function readCallMemorySkipSummary({ pool, secret, revision, now = Date.now() } = {}) {
  if (!authority({ pool, secret, revision, now })) return failure('invalid_input');
  try {
    return await withTransaction(pool, true, async query => {
      const rows = await originals(query);
      const contexts = rows.map(original => {
        try { return { original, context: originalContext(original, now) }; }
        catch (error) { return { original, issue: reason(error) }; }
      });
      const callIds = [...new Set(contexts.filter(c => c.context).map(c => c.context.callId))];
      const calls = await canonicalCalls(query, callIds, false);
      const refs = rows.map(row => keyed(secret, 'event-ref', row.event_id));
      const receipts = await receiptRows(query, refs);
      const outcomes = contexts.map(({ original, issue }, index) => {
        let notApplicable = false;
        if (!issue) {
          try {
            const source = currentSource(original, calls, { secret, now });
            issue = verify(receipts.find(row => row.id === slot(refs[index])), source, { secret, revision, now });
          } catch (error) {
            if (error?.reason === 'not_short_source') notApplicable = true;
            else issue = reason(error);
          }
        }
        return { recordRef: refs[index], outcome: notApplicable ? 'not_applicable' : issue ? 'unverified' : 'verified_skip',
          issue: issue || null };
      });
      const verifiedSkips = outcomes.filter(row => row.outcome === 'verified_skip').length;
      const notApplicable = outcomes.filter(row => row.outcome === 'not_applicable').length;
      const unverified = rows.length - verifiedSkips - notApplicable;
      const allVerified = verifiedSkips > 0 && unverified === 0;
      return { ok: true, complete: true, verified: allVerified, result: allVerified ? 'call_memory_skips_verified' : 'call_memory_skips_unverified',
        source: 'postgres:pbk_eval_runs', counts: { events: rows.length, verifiedSkips, unverified, notApplicable },
        issues: [...new Set(outcomes.map(row => row.issue).filter(Boolean))].sort(), outcomes, ...GUARDS };
    });
  } catch (error) { return failure(reason(error)); }
}
