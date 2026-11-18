import { createHash, createHmac } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson } from './skill-governance-store.mjs';
import { isExcludedEpisodicCall, selectBestEpisodicTranscript } from './ava-episodic-memory.mjs';
import { verifyCallMemorySkipEvidence } from './call-memory-outcome-store.mjs';
import { closureBinding, validateClosureManifest, DEAD_LETTER_CLOSURE_POLICY as POLICY,
  DEAD_LETTER_CLOSURE_LIMITS as LIMITS } from './dead-letter-closure-protocol.mjs';

const GUARD = Object.freeze({ noContact: true, providerWritesBlocked: true, deliveryRetries: false,
  providerDeliveryVerified: false, launchQualified: false });
const REASONS = new Set(['invalid_input', 'invalid_source', 'source_overflow', 'source_unverified',
  'source_ambiguous', 'source_unavailable', 'query_failed', 'collection_timeout', 'report_overflow']);
const PROVIDERS = new Set(['telnyx-deepgram-finalize', 'telnyx-recording-capture']);
const COMPONENTS = Object.freeze({ painProbe: [8, 20], objectionHandling: [10, 18, 25],
  offerPresentation: [7, 20], nextStep: [6, 20], toneRapport: [5, 15] });
const fail = reason => { throw new Error(reason); };
const requireThat = (condition, reason = 'invalid_source') => { if (!condition) fail(reason); };
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,120}$/.test(v);
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const reason = e => REASONS.has(e?.message) ? e.message : 'source_unavailable';
const unavailable = result => ({ ok: false, verified: false, result, counts: null, cases: [], ...GUARD });

function options(input) {
  requireThat(!types.isProxy(input) && plain(input), 'invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  requireThat(Reflect.ownKeys(descriptors).length <= 12, 'invalid_input');
  for (const key of Reflect.ownKeys(descriptors)) requireThat(typeof key === 'string'
    && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'), 'invalid_input');
  return input;
}
function authority(secret, revision, now) {
  requireThat(typeof secret === 'string' && secret.trim().length > 0 && secret.length <= 4096
    && typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision)
    && Number.isSafeInteger(now) && now >= 0 && Number.isFinite(new Date(now).getTime()), 'invalid_input');
}
function list(value) {
  requireThat(!types.isProxy(value) && Array.isArray(value)
    && Object.getPrototypeOf(value) === Array.prototype, 'invalid_source');
  requireThat(value.length <= LIMITS.maxRecords, 'source_overflow');
  const keys = Reflect.ownKeys(value);
  requireThat(keys.length === value.length + 1, 'invalid_source');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    requireThat(d && d.enumerable && Object.hasOwn(d, 'value'), 'invalid_source');
  }
  return value;
}
function safeRow(row, secret) {
  // closureBinding validates before canonicalization; it does not call getters or toJSON.
  closureBinding(secret, 'validate-source', row);
  requireThat(plain(row));
  return row;
}
function time(value, now) {
  requireThat(typeof value === 'string');
  const match = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(Z|\+00:00)$/.exec(value);
  requireThat(match);
  const fraction = (match[3] || '').padEnd(6, '0');
  const normalized = `${match[1]}T${match[2]}.${fraction.slice(0, 3)}Z`;
  const ms = Date.parse(normalized);
  requireThat(Number.isSafeInteger(ms) && ms >= 0 && new Date(ms).toISOString() === normalized);
  const micros = BigInt(ms) * 1000n + BigInt(fraction.slice(3));
  requireThat(micros <= BigInt(now) * 1000n);
  return { iso: normalized, micros };
}
function operational(row) {
  if (!plain(row) || ['synthetic', 'fixture', 'test', 'controlled', 'demo', 'sample']
    .some(k => Object.hasOwn(row, k) && row[k] !== false)) return false;
  if (['workspaceId', 'workspace_id', 'tenantId', 'tenant_id']
    .some(k => Object.hasOwn(row, k) && row[k] !== 'pbk')) return false;
  if (/synthetic|fixture|controlled-qualification|chaos-test|\b(?:demo|mock|sample|seed)\b/i
    .test(String(row.source || row.provider || ''))) return false;
  return !Object.hasOwn(row, 'metadata') || operational(row.metadata);
}
function alias(row, keys) {
  const values = keys.filter(k => Object.hasOwn(row, k)).map(k => row[k]);
  requireThat(values.length > 0 && values.every(id) && values.every(v => v === values[0]), 'source_unverified');
  return values[0];
}
function scope(row) {
  requireThat(['workspaceId', 'workspace_id', 'tenantId', 'tenant_id']
    .every(k => !Object.hasOwn(row, k) || row[k] === 'pbk'), 'source_unverified');
}
function context(original, now) {
  requireThat(original.tenant_id === 'pbk' && id(original.id) && id(original.event_id)
    && original.event_type === 'call.completed' && PROVIDERS.has(original.source)
    && plain(original.payload) && operational(original), 'source_unverified');
  time(original.created_at, now);
  const p = original.payload;
  scope(original); scope(p);
  const callId = alias(p, ['callId', 'call_id']);
  requireThat(alias(p, ['workspaceId', 'workspace_id']) === 'pbk' && operational(p)
    && !isExcludedEpisodicCall({ ...p, id: callId }), 'source_unverified');
  const texts = ['transcript', 'transcriptText', 'transcript_text']
    .filter(key => Object.hasOwn(p, key)).map(key => p[key]);
  requireThat(texts.length > 0 && texts.every(text => typeof text === 'string')
    && texts.every(text => text === texts[0]) && texts[0].trim().length > 0, 'source_unverified');
  // The worker only passes payload.transcript to QA, but uses aliases for memory.
  return { callId, qaText: (p.transcript || '').trim(), eventText: texts[0] };
}
function matches(call, callId) {
  return ['id', 'telnyx_call_control_id', 'telnyx_call_leg_id', 'telnyx_call_session_id']
    .some(k => call[k] === callId);
}
function selection(original, calls, c, now) {
  const rows = calls.filter(row => matches(row, c.callId));
  requireThat(rows.length <= 1, 'source_ambiguous');
  const call = rows[0] || null;
  if (call) {
    requireThat(call.workspace_id === 'pbk' && id(call.id) && call.provider === 'telnyx'
      && operational(call) && !isExcludedEpisodicCall(call), 'source_unverified');
    scope(call);
    requireThat(time(call.updated_at, now).micros >= time(call.created_at, now).micros, 'source_unverified');
  }
  const text = selectBestEpisodicTranscript([c.eventText, call?.transcript, call?.notes]);
  requireThat(text.length > 0, 'source_unverified');
  return { text, call, bindingInput: { event: original.payload, call } };
}
function scriptUnsupported(p) {
  for (const key of ['scriptId', 'script_id']) {
    if (Object.hasOwn(p, key) && p[key] !== null && p[key] !== '') return true;
  }
  if (Object.hasOwn(p, 'contextAwareScript')) {
    if (p.contextAwareScript === null) return false;
    if (!plain(p.contextAwareScript)) return true;
    if (Object.hasOwn(p.contextAwareScript, 'id') && p.contextAwareScript.id !== null
      && p.contextAwareScript.id !== '') return true;
  }
  return false;
}
function qaValid(row, c, original, now) {
  try {
    requireThat(row.tenant_id === 'pbk' && row.id === `call-qa-event-${original.event_id}`
      && row.call_id === c.callId && c.qaText.length <= 2000 && row.transcript_snippet === c.qaText
      && plain(row.metadata) && operational(row), 'qa_unverified');
    scope(row); time(row.created_at, now);
    requireThat(plain(row.breakdown) && Object.keys(row.breakdown).length === 5);
    let total = 0;
    for (const [k, values] of Object.entries(COMPONENTS)) {
      requireThat(values.includes(row.breakdown[k])); total += row.breakdown[k];
    }
    const grade = total >= 85 ? 'A' : total >= 72 ? 'B' : total >= 60 ? 'C' : 'needs_coaching';
    return row.score === total && row.grade === grade;
  } catch { return false; }
}
function memoryValid(row, c, text, now) {
  try {
    requireThat(row.workspace_id === 'pbk' && typeof row.id === 'string' && row.id.length > 0
      && row.call_id === c.callId && row.source_text === text.slice(0, 12000)
      && row.transcript_hash === createHash('sha256').update(text).digest('hex')
      && row.synthetic === false && plain(row.metadata) && operational(row)
      && typeof row.embedding_model === 'string' && row.embedding_model.trim().length > 0
      && !/(?:^|[^a-z0-9])(?:synthetic|fixture|mock|test)(?:$|[^a-z0-9])/i.test(row.embedding_model));
    scope(row);
    requireThat(time(row.updated_at, now).micros >= time(row.created_at, now).micros);
    const vector = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
    return Array.isArray(vector) && vector.length === POLICY.embeddingDimensions
      && vector.every(n => typeof n === 'number' && Number.isFinite(n)) && vector.some(n => n !== 0);
  } catch { return false; }
}
function artifact(secret, stepId, row, executedAt) {
  return { id: stepId, outcome: 'completed', artifactRef: closureBinding(secret, `${stepId}-artifact-ref`, row.id),
    binding: closureBinding(secret, `${stepId}-artifact`, row), executedAt };
}
function evaluate({ original, calls, qa, memory, skipReceipt, secret, revision, now }) {
  const recordRef = closureBinding(secret, 'dead-letter-ref', original.id);
  const originalBinding = closureBinding(secret, 'original', original);
  const blocked = (reasons, selectionBinding = null) => ({ ok: true, verified: false,
    result: 'handler_evidence_blocked', counts: null, ...GUARD, recordRef, originalBinding,
    selectionBinding, eligible: false, reasons, manifest: null });
  let c; let source;
  try { c = context(original, now); source = selection(original, calls, c, now); }
  catch (e) { return blocked([['source_ambiguous', 'source_unverified'].includes(e.message) ? e.message : 'source_unverified']); }
  const selectionBinding = closureBinding(secret, 'selection', source.bindingInput);
  const reasons = [];
  if (scriptUnsupported(original.payload)) reasons.push('script_proof_unsupported');
  const qaRows = qa.filter(r => r.id === `call-qa-event-${original.event_id}`);
  const qaRow = qaRows.length === 1 && qaValid(qaRows[0], c, original, now) ? qaRows[0] : null;
  if (!qaRow) reasons.push('qa_unverified');
  let memoryStep;
  if (source.text.length < POLICY.minimumChars) {
    const skip = verifyCallMemorySkipEvidence({ original, calls: source.call ? [source.call] : [],
      receipt: skipReceipt, secret, revision, now });
    if (skip.verified) memoryStep = { id: 'memory', outcome: skip.outcome,
      artifactRef: skip.artifactRef, binding: skip.binding, executedAt: skip.executedAt };
    else reasons.push('memory_skip_unverified');
  } else {
    const rows = memory.filter(row => row.call_id === c.callId && memoryValid(row, c, source.text, now));
    // Multiple current proofs are not arbitrarily selected for an approval-bound manifest.
    if (rows.length === 1) memoryStep = artifact(secret, 'memory', rows[0], time(rows[0].updated_at, now).iso);
    else reasons.push('memory_unverified');
  }
  if (reasons.length) return blocked(reasons, selectionBinding);
  const policyVersion = POLICY.version;
  const manifest = { schemaVersion: 'pbk-dead-letter-handler-manifest-v1', recordRef, originalBinding,
    selectionBinding, policyVersion, steps: [artifact(secret, 'qa', qaRow, time(qaRow.created_at, now).iso), memoryStep,
      { id: 'scriptOutcome', outcome: 'not_applicable', artifactRef: null, executedAt: null,
        binding: closureBinding(secret, 'script-outcome-applicability', { recordRef, originalBinding,
          selectionBinding, policyVersion, stepId: 'scriptOutcome', outcome: 'not_applicable' }) }] };
  requireThat(validateClosureManifest(manifest));
  return { ok: true, verified: true, result: 'handler_evidence_verified', counts: null, ...GUARD,
    recordRef, originalBinding, selectionBinding, eligible: true, reasons: [], manifest };
}

/** Pure fixture seam; not an authorization or historical-execution claim. */
export function verifyDeadLetterHandlerEvidence(input) {
  try {
    const a = options(input);
    authority(a.secret, a.revision, a.now);
    safeRow(a.original, a.secret);
    for (const rows of [a.calls, a.qa, a.memory]) list(rows).forEach(row => safeRow(row, a.secret));
    if (a.skipReceipt !== null) safeRow(a.skipReceipt, a.secret);
    return evaluate(a);
  } catch (e) {
    return { ...unavailable(reason(e)), eligible: false, reasons: [reason(e)], manifest: null,
      recordRef: null, originalBinding: null, selectionBinding: null };
  }
}

// Every source is a bounded JSON projection: preserve PG timestamp strings and complete rows.
const DEAD_SQL = `SELECT octet_length(to_jsonb(d)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(d)::text) <= 65536 THEN to_jsonb(d) ELSE NULL END AS original
  FROM public.event_dead_letters d WHERE d.tenant_id = 'pbk' ORDER BY d.id LIMIT 65`;
const CALL_SQL = `SELECT octet_length(to_jsonb(c)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(c)::text) <= 65536 THEN to_jsonb(c) ELSE NULL END AS original
  FROM public.calls c WHERE c.workspace_id = 'pbk' AND (c.id = ANY($1::text[])
    OR c.telnyx_call_control_id = ANY($1::text[]) OR c.telnyx_call_leg_id = ANY($1::text[])
    OR c.telnyx_call_session_id = ANY($1::text[])) ORDER BY c.id LIMIT 65`;
const QA_SQL = `SELECT octet_length(to_jsonb(q)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(q)::text) <= 65536 THEN to_jsonb(q) ELSE NULL END AS original
  FROM public.pbk_call_qa_scores q WHERE q.tenant_id = 'pbk' AND q.id = ANY($1::text[])
  ORDER BY q.id LIMIT 65`;
const MEMORY_SQL = `SELECT octet_length(to_jsonb(e)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(e)::text) <= 65536 THEN to_jsonb(e) ELSE NULL END AS original
  FROM public.call_embeddings e WHERE e.workspace_id = 'pbk' AND e.call_id = ANY($1::text[])
  ORDER BY e.id LIMIT 65`;
const SKIP_SQL = `SELECT octet_length(to_jsonb(r)::text) AS bytes,
  CASE WHEN octet_length(to_jsonb(r)::text) <= 65536 THEN to_jsonb(r) || jsonb_build_object(
    'created_at_exact', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    ELSE NULL END AS original
  FROM public.pbk_eval_runs r WHERE r.tenant_id = 'pbk' AND r.id = ANY($1::text[])
  ORDER BY r.id LIMIT 65`;
const COLLISION_SQL = `SELECT EXISTS(SELECT 1 FROM public.calls c
  WHERE c.workspace_id IS DISTINCT FROM 'pbk' AND (c.id = ANY($1::text[])
    OR c.telnyx_call_control_id = ANY($1::text[]) OR c.telnyx_call_leg_id = ANY($1::text[])
    OR c.telnyx_call_session_id = ANY($1::text[])))
  OR EXISTS(SELECT 1 FROM public.pbk_call_qa_scores q
    WHERE q.tenant_id IS DISTINCT FROM 'pbk' AND q.id = ANY($2::text[]))
  OR EXISTS(SELECT 1 FROM public.call_embeddings e
    WHERE e.workspace_id IS DISTINCT FROM 'pbk' AND e.call_id = ANY($1::text[]))
  OR EXISTS(SELECT 1 FROM public.pbk_eval_runs r
    WHERE r.tenant_id IS DISTINCT FROM 'pbk' AND r.id = ANY($3::text[]))
  OR EXISTS(SELECT 1 FROM public.event_dead_letters d
    WHERE d.tenant_id IS DISTINCT FROM 'pbk' AND (d.event_id = ANY($4::text[])
      OR d.id = ANY($5::text[]))) AS outside_scope`;
function skipSlot(secret, eventId) {
  const ref = createHmac('sha256', secret).update('pbk:call-memory-skip:v1:event-ref\0')
    .update(canonicalJson(eventId)).digest('hex');
  return `call-memory-skip-v1:${ref}`;
}

function collectionShape(row, kind) {
  const keys = {
    original: ['id', 'tenant_id', 'event_id', 'event_type', 'source', 'payload', 'created_at'],
    call: ['id', 'workspace_id', 'provider', 'transcript', 'notes', 'created_at', 'updated_at'],
    qa: ['id', 'tenant_id', 'call_id', 'score', 'grade', 'breakdown', 'transcript_snippet', 'metadata', 'created_at'],
    memory: ['id', 'workspace_id', 'call_id', 'source_text', 'transcript_hash', 'synthetic',
      'embedding_model', 'embedding', 'metadata', 'created_at', 'updated_at'],
    skip: ['id', 'tenant_id', 'suite_name', 'source', 'ok', 'total', 'passed', 'failed',
      'created_at', 'created_at_exact', 'report'],
  }[kind];
  requireThat(keys.every(k => Object.hasOwn(row, k)));
}

/** query(text, values) belongs to the caller's bounded transaction/fence; no client lifecycle here. */
export async function collectDeadLetterClosureEvidence(input) {
  try {
    const { query, secret, revision, now, recordRefs } = options(input);
    authority(secret, revision, now);
    requireThat(typeof query === 'function', 'invalid_input');
    if (recordRefs !== undefined) {
      list(recordRefs); requireThat(recordRefs.every(hex) && new Set(recordRefs).size === recordRefs.length, 'invalid_input');
    }
    const deadline = performance.now() + LIMITS.collectionMs;
    const remaining = () => {
      const ms = Math.floor(deadline - performance.now());
      requireThat(ms > 0, 'collection_timeout'); return ms;
    };
    const read = async (sql, values = []) => {
      const ms = Math.min(LIMITS.queryMs, remaining());
      let timer;
      try {
        const r = await Promise.race([Promise.resolve().then(() => query(sql, values)), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('query_failed')), ms);
        })]);
        remaining();
        requireThat(!types.isProxy(r) && plain(r));
        const d = Object.getOwnPropertyDescriptor(r, 'rows');
        requireThat(d && Object.hasOwn(d, 'value'));
        return list(d.value);
      } finally { clearTimeout(timer); }
    };
    const rows = async (sql, values, kind) => (await read(sql, values)).map(row => {
      safeRow(row, secret);
      requireThat(Number.isSafeInteger(row.bytes) && row.bytes >= 0);
      requireThat(row.bytes <= LIMITS.maxBytes, 'source_overflow');
      const original = safeRow(row.original, secret);
      collectionShape(original, kind);
      return original;
    });
    const originals = await rows(DEAD_SQL, [], 'original');
    for (const row of originals) {
      requireThat(row.tenant_id === 'pbk' && id(row.id) && id(row.event_id) && plain(row.payload));
      time(row.created_at, now);
    }
    requireThat(new Set(originals.map(r => r.event_id)).size === originals.length
      && new Set(originals.map(r => r.id)).size === originals.length, 'source_ambiguous');
    const selected = recordRefs === undefined ? originals : originals.filter(row =>
      recordRefs.includes(closureBinding(secret, 'dead-letter-ref', row.id)));
    const calls = [...new Set(selected.flatMap(r => ['callId', 'call_id'].map(k => r.payload[k]).filter(id)))];
    const qaIds = selected.map(r => `call-qa-event-${r.event_id}`);
    const slots = selected.map(r => skipSlot(secret, r.event_id));
    if (!selected.length) return { ok: true, verified: false, result: 'handler_evidence_collected',
      counts: { cases: 0, eligible: 0, blocked: 0 }, cases: [], ...GUARD };
    const collisions = await read(COLLISION_SQL, [calls, qaIds, slots,
      selected.map(r => r.event_id), selected.map(r => r.id)]);
    requireThat(collisions.length === 1);
    safeRow(collisions[0], secret);
    requireThat(collisions[0].outside_scope === false, 'source_unverified');
    const canonical = await rows(CALL_SQL, [calls], 'call');
    const qa = await rows(QA_SQL, [qaIds], 'qa');
    const memory = await rows(MEMORY_SQL, [calls], 'memory');
    const skips = await rows(SKIP_SQL, [slots], 'skip');
    const cases = selected.map((original, i) => {
      const receipts = skips.filter(r => r.id === slots[i]);
      requireThat(receipts.length <= 1, 'source_ambiguous');
      return evaluate({ original, calls: canonical, qa, memory, skipReceipt: receipts[0] || null, secret, revision, now });
    });
    const eligible = cases.filter(r => r.eligible).length;
    const report = { ok: true, verified: cases.length > 0 && eligible === cases.length,
      result: 'handler_evidence_collected', counts: { cases: cases.length, eligible, blocked: cases.length - eligible },
      cases, ...GUARD };
    requireThat(Buffer.byteLength(JSON.stringify(report)) <= LIMITS.maxBytes, 'report_overflow');
    remaining(); return report;
  } catch (e) { return unavailable(reason(e)); }
}
