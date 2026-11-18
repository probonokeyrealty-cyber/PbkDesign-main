import { createHmac, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { canonicalJson } from './skill-governance-store.mjs';

export const DEAD_LETTER_CLOSURE_POLICY = Object.freeze({
  version: 'dead-letter-handler-v1', requiredSteps: Object.freeze(['qa', 'memory', 'scriptOutcome']),
  minimumChars: 80, embeddingDimensions: 1536,
});
export const DEAD_LETTER_CLOSURE_LIMITS = Object.freeze({
  maxRecords: 64, sentinelRecords: 65, maxBytes: 65536, queryMs: 2000, collectionMs: 15000,
  executionMs: 60000, intentAgeMs: 86400000, maxDepth: 16, maxNodes: 10000,
});

const INTENT_SCHEMA = 'pbk-dead-letter-closure-intent-v1';
const RECEIPT_SCHEMA = 'pbk-dead-letter-closure-v1';
const MANIFEST_SCHEMA = 'pbk-dead-letter-handler-manifest-v1';
const INVALID = 'dead_letter_closure_invalid';
const REASONS = new Set([INVALID, 'closure_intent_expired', 'closure_intent_future', 'closure_revision_mismatch']);
const GUARD = Object.freeze({ counts: null, noContact: true, providerWritesBlocked: true,
  deliveryRetries: false, providerDeliveryVerified: false, launchQualified: false });
const MANIFEST_KEYS = ['schemaVersion', 'recordRef', 'originalBinding', 'selectionBinding', 'policyVersion', 'steps'];
const INTENT_KEYS = ['schemaVersion', 'tenantId', 'approvalRef', 'action', 'recordRef', 'originalBinding',
  'manifestBinding', 'policyVersion', 'predecessor', 'revision', 'createdAt', 'expiresAt', 'attestation'];
const REPORT_KEYS = ['schemaVersion', 'tenantId', 'receiptId', 'ordinal', 'admittedAt', 'insertXid',
  'recordRef', 'originalBinding', 'manifestBinding', 'policyVersion', 'approvalRef', 'intentBinding',
  'decisionBinding', 'action', 'predecessor', 'revision', 'observedAt', 'completedAt', 'approvalExpiresAt',
  'manifest', 'intent', 'guard'];
const ROW_KEYS = ['id', 'tenant_id', 'ordinal', 'admitted_at', 'insert_xid', 'record_ref',
  'approval_ref', 'intent_binding', 'action', 'previous_id', 'report'];
const HEX = /^[0-9a-f]{64}$/;
const ID = /^[a-zA-Z0-9_:-]{1,120}$/;
const REVISION = /^[0-9a-f]{40}$/;
const requireThat = (condition, reason = INVALID) => { if (!condition) throw new Error(reason); };
const isHex = (v) => typeof v === 'string' && HEX.test(v);
const isId = (v) => typeof v === 'string' && ID.test(v);
const isRevision = (v) => typeof v === 'string' && REVISION.test(v);
const isAction = (v) => v === 'close_internal' || v === 'revoke_internal';

// Snapshot descriptors, never caller getters/toJSON. Only the raw PG row's three
// timestamp slots may contain Date instances; all other inputs are plain JSON.
function snapshot(value, pgDates = false) {
  let bytes = 0;
  let nodes = 0;
  const active = new Set();
  const add = (n) => { bytes += n; requireThat(bytes <= DEAD_LETTER_CLOSURE_LIMITS.maxBytes); };
  function visit(item, depth, path) {
    requireThat(!types.isProxy(item));
    requireThat(++nodes <= DEAD_LETTER_CLOSURE_LIMITS.maxNodes && depth <= DEAD_LETTER_CLOSURE_LIMITS.maxDepth);
    if (item === null || typeof item === 'boolean' || typeof item === 'number' || typeof item === 'string') {
      requireThat(typeof item !== 'number' || Number.isFinite(item));
      if (typeof item === 'string') requireThat(item.length <= DEAD_LETTER_CLOSURE_LIMITS.maxBytes);
      add(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    requireThat(typeof item === 'object' && !active.has(item));
    const proto = Object.getPrototypeOf(item);
    if (pgDates && path.length === 1 && ['decided_at', 'created_at', 'updated_at'].includes(path[0])
      && proto === Date.prototype) {
      requireThat(Reflect.ownKeys(item).length === 0);
      const ms = Date.prototype.getTime.call(item);
      requireThat(Number.isFinite(ms));
      const text = new Date(ms).toISOString();
      add(Buffer.byteLength(JSON.stringify(text)));
      return text;
    }
    const array = Array.isArray(item);
    requireThat(proto === (array ? Array.prototype : Object.prototype));
    const keys = Reflect.ownKeys(item);
    requireThat(keys.length <= DEAD_LETTER_CLOSURE_LIMITS.maxNodes);
    const entries = [];
    const length = array ? Object.getOwnPropertyDescriptor(item, 'length').value : 0;
    if (array) requireThat(keys.length === length + 1);
    for (const key of keys) {
      if (array && key === 'length') continue;
      requireThat(typeof key === 'string' && key.length <= DEAD_LETTER_CLOSURE_LIMITS.maxBytes);
      const d = Object.getOwnPropertyDescriptor(item, key);
      requireThat(d.enumerable && Object.hasOwn(d, 'value'));
      if (array) requireThat(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length);
      entries.push([key, d.value]);
    }
    active.add(item);
    add(2);
    const copy = array ? [] : {};
    for (let i = 0; i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (i) add(1);
      if (!array) add(Buffer.byteLength(JSON.stringify(key)) + 1);
      Object.defineProperty(copy, key, { value: visit(entry, depth + 1, [...path, key]),
        enumerable: true, configurable: true, writable: true });
    }
    active.delete(item);
    return copy;
  }
  return visit(value, 0, []);
}

function exact(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  const actual = Object.keys(value);
  requireThat(actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
}
function secretValue(secret) { requireThat(typeof secret === 'string' && secret.length > 0 && secret.length <= 4096); }
function clock(now) { requireThat(Number.isSafeInteger(now) && Number.isFinite(new Date(now).getTime())); return now; }
function time(value, precision = 3) {
  requireThat(typeof value === 'string');
  const pattern = precision === 6 ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  requireThat(pattern.test(value));
  const msText = precision === 6 ? `${value.slice(0, 23)}Z` : value;
  const ms = Date.parse(msText);
  requireThat(Number.isFinite(ms) && new Date(ms).toISOString() === msText);
  return BigInt(ms) * 1000n + (precision === 6 ? BigInt(value.slice(23, 26)) : 0n);
}
function decimal(value, max) {
  requireThat(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value));
  requireThat(BigInt(value) <= max);
}
function predecessor(value) {
  if (value === null) return;
  exact(value, ['id', 'hash']); requireThat(isId(value.id) && isHex(value.hash));
}
function attestation(value, schema) {
  exact(value, ['version', 'signature']); requireThat(value.version === schema && isHex(value.signature));
}
function equalHex(a, b) { return isHex(a) && isHex(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
function signature(secret, kind, schema, body) {
  secretValue(secret);
  const key = createHmac('sha256', secret).update(`pbk.dead-letter-closure.${kind}.key.v1`).digest();
  return createHmac('sha256', key).update(`${schema}\n${canonicalJson(body)}`).digest('hex');
}
function binding(secret, domain, value) {
  secretValue(secret);
  requireThat(typeof domain === 'string' && /^[a-z][a-z0-9-]{0,119}$/.test(domain));
  return signature(secret, 'bindings', `pbk.dead-letter-closure.binding.v1\n${domain}`, value);
}
export function closureBinding(secret, domain, value) {
  try { return binding(secret, domain, snapshot(value)); } catch { throw new Error(INVALID); }
}

function manifestShape(m) {
  exact(m, MANIFEST_KEYS);
  requireThat(m.schemaVersion === MANIFEST_SCHEMA && m.policyVersion === DEAD_LETTER_CLOSURE_POLICY.version);
  requireThat([m.recordRef, m.originalBinding, m.selectionBinding].every(isHex));
  requireThat(Array.isArray(m.steps) && m.steps.length === 3);
  m.steps.forEach((step, index) => {
    exact(step, ['id', 'outcome', 'artifactRef', 'binding', 'executedAt']);
    requireThat(step.id === DEAD_LETTER_CLOSURE_POLICY.requiredSteps[index] && isHex(step.binding));
    if (step.id === 'scriptOutcome') {
      requireThat(step.outcome === 'not_applicable' && step.artifactRef === null && step.executedAt === null);
    } else {
      requireThat(step.outcome === 'completed' || (step.id === 'memory' && step.outcome === 'skipped_short_source'));
      requireThat(isHex(step.artifactRef)); time(step.executedAt);
    }
  });
}
export function validateClosureManifest(value) {
  try { manifestShape(snapshot(value)); return true; } catch { return false; }
}
function applicability(m, secret) {
  requireThat(equalHex(m.steps[2].binding, binding(secret, 'script-outcome-applicability', {
    recordRef: m.recordRef, originalBinding: m.originalBinding, selectionBinding: m.selectionBinding,
    policyVersion: m.policyVersion, stepId: 'scriptOutcome', outcome: 'not_applicable',
  })));
}
function intentShape(intent) {
  exact(intent, INTENT_KEYS);
  requireThat(intent.schemaVersion === INTENT_SCHEMA && intent.tenantId === 'pbk' && isAction(intent.action));
  requireThat([intent.approvalRef, intent.recordRef, intent.originalBinding, intent.manifestBinding].every(isHex));
  requireThat(intent.policyVersion === DEAD_LETTER_CLOSURE_POLICY.version && isRevision(intent.revision));
  predecessor(intent.predecessor);
  requireThat(intent.action !== 'revoke_internal' || intent.predecessor !== null);
  requireThat(time(intent.expiresAt) - time(intent.createdAt) === BigInt(DEAD_LETTER_CLOSURE_LIMITS.intentAgeMs) * 1000n);
  attestation(intent.attestation, INTENT_SCHEMA);
}
function authenticateIntent(intent, secret, revision, now, approvalId) {
  intentShape(intent); secretValue(secret); clock(now);
  requireThat(isRevision(revision) && revision === intent.revision, 'closure_revision_mismatch');
  if (approvalId !== undefined) {
    requireThat(isId(approvalId) && equalHex(intent.approvalRef, binding(secret, 'approval-ref', approvalId)));
  }
  const { attestation: signed, ...body } = intent;
  requireThat(equalHex(signed.signature, signature(secret, 'intents', INTENT_SCHEMA, body)));
  requireThat(time(intent.createdAt) <= BigInt(now) * 1000n, 'closure_intent_future');
  requireThat(BigInt(now) * 1000n < time(intent.expiresAt), 'closure_intent_expired');
}
export function createClosureIntent(input) {
  try {
    const a = snapshot(input);
    exact(a, ['approvalId', 'action', 'recordRef', 'manifest', 'predecessor', 'revision', 'createdAt', 'secret']);
    secretValue(a.secret); manifestShape(a.manifest); applicability(a.manifest, a.secret);
    requireThat(isId(a.approvalId) && isAction(a.action) && isRevision(a.revision) && a.recordRef === a.manifest.recordRef);
    predecessor(a.predecessor); requireThat(a.action !== 'revoke_internal' || a.predecessor !== null);
    const created = time(a.createdAt);
    requireThat(a.manifest.steps.slice(0, 2).every((s) => time(s.executedAt) <= created));
    const intent = {
      schemaVersion: INTENT_SCHEMA, tenantId: 'pbk', approvalRef: binding(a.secret, 'approval-ref', a.approvalId),
      action: a.action, recordRef: a.recordRef, originalBinding: a.manifest.originalBinding,
      manifestBinding: binding(a.secret, 'manifest', a.manifest), policyVersion: DEAD_LETTER_CLOSURE_POLICY.version,
      predecessor: a.predecessor, revision: a.revision, createdAt: a.createdAt,
      expiresAt: new Date(Number(created / 1000n) + DEAD_LETTER_CLOSURE_LIMITS.intentAgeMs).toISOString(),
    };
    intent.attestation = { version: INTENT_SCHEMA, signature: signature(a.secret, 'intents', INTENT_SCHEMA, intent) };
    intentShape(intent);
    return intent;
  } catch { throw new Error(INVALID); }
}
function failure(error) {
  return { ok: false, verified: false, result: REASONS.has(error?.message) ? error.message : INVALID, ...GUARD };
}
export function verifyClosureIntent(input) {
  try {
    const a = snapshot(input); exact(a, ['intent', 'approvalId', 'secret', 'revision', 'now']);
    requireThat(isId(a.approvalId));
    authenticateIntent(a.intent, a.secret, a.revision, a.now, a.approvalId);
    return { ok: true, verified: true, result: 'closure_intent_verified', ...GUARD, intent: a.intent };
  } catch (error) { return failure(error); }
}

function decisionTime(value) {
  requireThat(typeof value === 'string');
  // Raw PG may preserve trailing zero microseconds; nonzero micros lose authority.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}000Z$/.test(value)) value = `${value.slice(0, 23)}Z`;
  time(value); return value;
}
function approvalAliases(value) {
  for (const key of ['workspace_id', 'workspaceId', 'tenant_id', 'tenantId']) {
    if (Object.hasOwn(value, key)) requireThat(value[key] === 'pbk');
  }
  for (const key of ['lead_id', 'leadId', 'contract_id', 'contractId']) {
    if (Object.hasOwn(value, key)) requireThat(value[key] === null || value[key] === '');
  }
}
export function projectClosureApproval(row) {
  try {
    const r = snapshot(row, true);
    requireThat(r && !Array.isArray(r) && isId(r.id) && r.workspace_id === 'pbk' && r.type === 'admin' && r.status === 'approved');
    const p = r.payload;
    requireThat(p && typeof p === 'object' && !Array.isArray(p) && p.id === r.id && p.type === 'admin' && p.status === 'approved'
      && p.approvalAction === 'dead_letter_internal_closure');
    const metadata = p.metadata;
    requireThat(metadata && typeof metadata === 'object' && !Array.isArray(metadata));
    for (const value of [r, p, metadata]) approvalAliases(value);
    intentShape(metadata.deadLetterClosureIntent);
    const decidedAt = decisionTime(r.decided_at);
    const aliases = ['actedAt', 'decidedAt'].filter((k) => Object.hasOwn(p, k));
    requireThat(aliases.length > 0 && aliases.every((k) => decisionTime(p[k]) === decidedAt));
    return { id: r.id, workspaceId: 'pbk', type: 'admin', action: 'dead_letter_internal_closure',
      status: 'approved', decidedAt, intent: metadata.deadLetterClosureIntent };
  } catch { return null; }
}

function reportBody(report, secret) {
  const signed = Object.hasOwn(report, 'attestation');
  exact(report, signed ? [...REPORT_KEYS, 'attestation'] : REPORT_KEYS);
  if (signed) attestation(report.attestation, RECEIPT_SCHEMA);
  requireThat(report.schemaVersion === RECEIPT_SCHEMA && report.tenantId === 'pbk' && isId(report.receiptId));
  decimal(report.ordinal, 9223372036854775807n); decimal(report.insertXid, 18446744073709551615n);
  requireThat([report.recordRef, report.originalBinding, report.manifestBinding, report.approvalRef,
    report.intentBinding, report.decisionBinding].every(isHex));
  requireThat(isAction(report.action) && isRevision(report.revision) && report.policyVersion === DEAD_LETTER_CLOSURE_POLICY.version);
  predecessor(report.predecessor); exact(report.guard, Object.keys(GUARD));
  requireThat(Object.entries(GUARD).every(([key, value]) => report.guard[key] === value));
  manifestShape(report.manifest); applicability(report.manifest, secret);
  const observed = time(report.observedAt);
  const completed = time(report.completedAt);
  const admitted = time(report.admittedAt, 6);
  requireThat(observed <= admitted && admitted <= completed && completed - observed <= BigInt(DEAD_LETTER_CLOSURE_LIMITS.executionMs) * 1000n);
  authenticateIntent(report.intent, secret, report.revision, Number(observed / 1000n));
  requireThat(report.approvalExpiresAt === report.intent.expiresAt);
  requireThat(admitted < time(report.approvalExpiresAt) && completed <= time(report.approvalExpiresAt));
  for (const key of ['recordRef', 'originalBinding', 'policyVersion']) {
    requireThat(report[key] === report.manifest[key] && report[key] === report.intent[key]);
  }
  for (const key of ['manifestBinding', 'action', 'approvalRef', 'revision']) requireThat(report[key] === report.intent[key]);
  requireThat(canonicalJson(report.predecessor) === canonicalJson(report.intent.predecessor));
  requireThat(equalHex(report.manifestBinding, binding(secret, 'manifest', report.manifest))
    && equalHex(report.intentBinding, binding(secret, 'intent', report.intent)));
  requireThat(report.manifest.steps.slice(0, 2).every((step) => time(step.executedAt) <= observed));
  const { attestation: _signed, ...body } = report;
  return body;
}
export function signClosureReceipt(input) {
  try {
    const a = snapshot(input); exact(a, ['report', 'secret']); secretValue(a.secret);
    return signature(a.secret, 'receipts', RECEIPT_SCHEMA, reportBody(a.report, a.secret));
  } catch { throw new Error(INVALID); }
}
export function verifyClosureReceipt(input) {
  try {
    const a = snapshot(input); exact(a, ['row', 'secret', 'revision', 'now']);
    secretValue(a.secret); clock(a.now); requireThat(isRevision(a.revision));
    exact(a.row, ROW_KEYS);
    const r = a.row.report;
    const body = reportBody(r, a.secret);
    attestation(r.attestation, RECEIPT_SCHEMA);
    requireThat(equalHex(r.attestation.signature, signature(a.secret, 'receipts', RECEIPT_SCHEMA, body)));
    requireThat(r.revision === a.revision, 'closure_revision_mismatch');
    requireThat(time(r.completedAt) <= BigInt(a.now) * 1000n);
    const matches = { id: r.receiptId, tenant_id: r.tenantId, ordinal: r.ordinal, admitted_at: r.admittedAt,
      insert_xid: r.insertXid, record_ref: r.recordRef, approval_ref: r.approvalRef,
      intent_binding: r.intentBinding, action: r.action, previous_id: r.predecessor?.id ?? null };
    requireThat(Object.entries(matches).every(([key, value]) => a.row[key] === value));
    // Authentication is historical, not current handler proof or write authority.
    return { ok: true, verified: true, result: 'closure_receipt_authenticated', ...GUARD, receipt: r };
  } catch (error) { return failure(error); }
}
