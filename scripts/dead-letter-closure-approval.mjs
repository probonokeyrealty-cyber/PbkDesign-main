import { types } from 'node:util';
import { isDirectQualificationFounder } from './release-qualification.mjs';
import { closureBinding, createClosureIntent, projectClosureApproval, verifyClosureIntent } from './dead-letter-closure-protocol.mjs';
import { readDeadLetterClosureProposalContext } from './dead-letter-closure-store.mjs';

const ACTION = 'dead_letter_internal_closure';
const GUARD = Object.freeze({ noContact: true, providerWritesBlocked: true, deliveryRetries: false,
  providerDeliveryVerified: false, launchQualified: false });
const denied = (result, status = 400) => ({ ok: false, result, status, ...GUARD });

export function isDeadLetterClosureApproval(value) {
  if (!value || typeof value !== 'object') return false;
  return [value, value.payload, value.metadata, value.payload?.metadata].some(v => v && (
    Object.hasOwn(v, 'deadLetterClosureIntent') ||
    ['type', 'approvalAction', 'action', 'toolName', 'requestedTool'].some(k => String(v[k] || '').trim().toLowerCase() === ACTION)));
}

export function authorizeClosureProposalRequest(request, apiKey) {
  const headers = request?.headers || {};
  const keys = Object.keys(headers).map(k => k.toLowerCase());
  const raw = request?.rawHeaders || [];
  const rawKeys = raw.filter((_, i) => i % 2 === 0).map(k => String(k).toLowerCase());
  if (new Set(keys).size !== keys.length || new Set(rawKeys).size !== rawKeys.length
    || Object.values(headers).some(v => typeof v !== 'string')
    || keys.some(k => /^(?:x-(?:pbk-)?team-(?:token|passcode)|x-forwarded-authorization|x-pbk-webhook-secret|x-webhook-secret|x-pbk-signature)$/.test(k))
    || !isDirectQualificationFounder(headers, apiKey)) {
    return denied('closure_founder_auth_required', 403);
  }
  const body = request?.body;
  if (request.method !== 'POST' || request.search || !body || types.isProxy(body)
    || Object.getPrototypeOf(body) !== Object.prototype || Reflect.ownKeys(body).length) {
    return denied('closure_fixed_proposal_only');
  }
  return { ok: true };
}

// Raw canonical DB rows only, not queue/cache projections. Pending rows are
// checked using the same identity/association contract as approved decisions.
export function validateDeadLetterClosureApproval({ approval: r, secret, revision, now, pendingOnly = false }) {
  try {
    closureBinding(secret, 'validate-approval-input', r);
    if (!r || !['pending', 'approved', 'rejected', 'needs_revision', 'cancelled'].includes(r.status)
      || (pendingOnly && r.status !== 'pending')) return false;
    const p = r.payload;
    if (!p || p.status !== r.status || p.approvalAction !== ACTION) return false;
    for (const v of [r, p, p.metadata]) {
      if (!v) return false;
      for (const key of ['action', 'approvalAction', 'toolName', 'requestedTool']) {
        if (v[key] && v[key] !== ACTION) return false;
      }
    }
    let projected;
    if (r.status === 'pending') {
      if (r.decided_at != null || p.actedAt || p.decidedAt) return false;
      const at = new Date(now).toISOString();
      projected = projectClosureApproval({ ...r, status: 'approved', decided_at: at,
        payload: { ...p, status: 'approved', actedAt: at } });
    } else projected = projectClosureApproval({ ...r, status: 'approved', payload: { ...p, status: 'approved' } });
    return Boolean(projected && verifyClosureIntent({ intent: projected.intent, approvalId: r.id,
      secret, revision, now: r.status === 'pending' ? now : Date.parse(projected.decidedAt) }).verified);
  } catch { return false; }
}

export async function prepareDeadLetterClosureProposal(input) {
  try {
    if (!input || types.isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return denied('closure_invalid_input');
    const allowed = ['pool', 'secret', 'revision', 'recordRef', 'action', 'approvalId', 'now'];
    for (const k of Reflect.ownKeys(input)) {
      const d = Object.getOwnPropertyDescriptor(input, k);
      if (!allowed.includes(k) || !d.enumerable || !Object.hasOwn(d, 'value')) return denied('closure_invalid_input');
    }
    const { pool, secret, revision, recordRef, action, approvalId, now = Date.now() } = input;
    const context = await readDeadLetterClosureProposalContext({ pool, secret, revision, recordRef, action, now });
    if (!context.ok) return context;
    const intent = createClosureIntent({ approvalId, action, recordRef, manifest: context.manifest,
      predecessor: context.predecessor, revision, createdAt: new Date(now).toISOString(), secret });
    return { ok: true, result: 'closure_proposal_prepared', params: { id: approvalId, type: 'admin',
      status: 'pending', approvalAction: ACTION, leadName: 'PBK internal recovery', address: 'Internal dead-letter closure',
      metadata: { deadLetterClosureIntent: intent } }, ...GUARD };
  } catch { return denied('closure_invalid_input'); }
}
