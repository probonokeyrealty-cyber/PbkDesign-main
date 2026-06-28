const PROJECTABLE_SOURCE_CHANNELS = new Set(['call', 'sms', 'email', 'analyzer', 'manual']);

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function clampConfidence(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

export function buildLeadFieldProvenance(input = {}) {
  return {
    workspaceId: normalizeText(input.workspaceId, 'pbk') || 'pbk',
    leadId: normalizeText(input.leadId),
    fieldName: normalizeText(input.fieldName),
    fieldValue: input.fieldValue ?? null,
    sourceChannel: normalizeText(input.sourceChannel, 'unknown') || 'unknown',
    sourceId: normalizeText(input.sourceId),
    sourceExcerpt: normalizeText(input.sourceExcerpt).slice(0, 500),
    confidence: clampConfidence(input.confidence),
    reason: normalizeText(input.reason).slice(0, 500),
    actorType: normalizeText(input.actorType, 'ava') || 'ava',
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function canProjectLeadField(input = {}) {
  const provenance = buildLeadFieldProvenance(input);
  if (!provenance.leadId || !provenance.fieldName) return false;
  if (provenance.confidence < 0.7) return false;
  return PROJECTABLE_SOURCE_CHANNELS.has(provenance.sourceChannel);
}
