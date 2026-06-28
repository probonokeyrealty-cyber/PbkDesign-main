function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeBoolean(value) {
  if (typeof value === 'string') {
    return /^(1|true|yes|on)$/i.test(value.trim());
  }
  return Boolean(value);
}

function normalizeTimestamp(value) {
  const text = normalizeText(value);
  if (!text) return new Date().toISOString();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeEvidence(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

export function buildComplianceAuditEvent(input = {}) {
  return {
    workspaceId: normalizeText(input.workspaceId, 'pbk') || 'pbk',
    actorType: normalizeText(input.actorType, 'system') || 'system',
    actorId: normalizeText(input.actorId),
    leadId: normalizeText(input.leadId),
    approvalId: normalizeText(input.approvalId),
    actionType: normalizeText(input.actionType),
    decision: normalizeText(input.decision),
    requiredApproval: normalizeBoolean(input.requiredApproval),
    approvalStatus: normalizeText(input.approvalStatus),
    provider: normalizeText(input.provider),
    providerResult: normalizeText(input.providerResult),
    evidence: normalizeEvidence(input.evidence),
    createdAt: normalizeTimestamp(input.createdAt),
  };
}
