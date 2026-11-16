import { createHash } from 'node:crypto';

const VERSION = 'pbk-exact-action-v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CONTROL_KEYS = new Set(['approvalId', 'approval_id', 'actor']);

function canonical(value, top = false) {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined && !(top && CONTROL_KEYS.has(key)))
    .map((key) => [key, canonical(value[key])]));
}

export function hashProviderActionContext(context) {
  return createHash('sha256').update(JSON.stringify(canonical(context))).digest('hex');
}

function digest(approvalId, workspaceId, toolName, params, expiresAt, contextHash = '') {
  return createHash('sha256').update(JSON.stringify({
    version: VERSION, approvalId, workspaceId, toolName, expiresAt, contextHash, params: canonical(params, true),
  })).digest('hex');
}

export function createProviderActionBinding({ approvalId, workspaceId = 'pbk', toolName, params, createdAt, contextHash = '' }) {
  const timestamp = Date.parse(createdAt);
  if (!approvalId || !toolName || !params || typeof params !== 'object' || !Number.isFinite(timestamp)) return null;
  const expiresAt = new Date(timestamp + MAX_AGE_MS).toISOString();
  return { version: VERSION, expiresAt, contextHash, hash: digest(approvalId, workspaceId, toolName, params, expiresAt, contextHash) };
}

export function validateProviderActionAuthorization({ approval, toolName, params, now = Date.now(), contextHash = '' }) {
  const reject = (result) => ({ ok: false, blocked: true, result, providerAttempted: false });
  if (!approval || approval.status !== 'approved') return reject('approval_required');
  const approvedTool = approval.approvalAction || approval.metadata?.requestedTool;
  if (approval.type !== 'provider-action' || approvedTool !== toolName) return reject('approval_binding_mismatch');
  const workspaceId = approval.workspaceId || approval.workspace_id || 'pbk';
  if ((params.workspaceId || params.workspace_id || params.tenantId || params.tenant_id || workspaceId) !== workspaceId) {
    return reject('approval_binding_mismatch');
  }
  const approvedParams = approval.metadata?.executionParams;
  const binding = approval.metadata?.actionBinding;
  if (!binding || binding.version !== VERSION || !approvedParams) return reject('approval_binding_required');
  const createdAt = Date.parse(approval.createdAt);
  const expiresAt = Date.parse(binding.expiresAt);
  if (!Number.isFinite(createdAt) || createdAt > now || !Number.isFinite(expiresAt)
    || expiresAt > createdAt + MAX_AGE_MS || expiresAt <= now) return reject('approval_expired');
  if (binding.contextHash !== contextHash
    || binding.hash !== digest(approval.id, workspaceId, toolName, approvedParams, binding.expiresAt, contextHash)
    || binding.hash !== digest(approval.id, workspaceId, toolName, params, binding.expiresAt, contextHash)) {
    return reject('approval_binding_mismatch');
  }
  return { ok: true, bindingHash: binding.hash };
}

export function validateNegotiationApproval({ approval, leadId, tenantId = 'pbk', finalOffer, avaScript, now = Date.now() }) {
  const timestamp = Date.parse(approval?.createdAt);
  return Boolean(approval?.status === 'approved' && approval.type === 'negotiation'
    && approval.approvalAction === 'approve_negotiation_counter'
    && approval.leadId && approval.leadId === leadId
    && (approval.workspaceId || approval.workspace_id || approval.metadata?.tenantId || 'pbk') === tenantId
    && Number(approval.offerPrice) === finalOffer && finalOffer > 0
    && Number.isFinite(timestamp) && timestamp <= now && now - timestamp < MAX_AGE_MS
    && (!avaScript || avaScript === approval.metadata?.avaFinalScript));
}
