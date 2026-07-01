const PROJECTABLE_SOURCE_CHANNELS = new Set(['call', 'sms', 'email', 'analyzer', 'manual']);
const COMMIT_CONTEXT_KEYS = new Set([
  'approvalContext',
  'approval_context',
  'approvals',
  'contractContext',
  'contract_context',
  'contracts',
  'fieldProvenance',
  'field_provenance',
  'leadCommitEnvelope',
  'lead_commit_envelope',
]);

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function clampConfidence(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function stableHash(value = '') {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeSourceChannel(value = '', source = '') {
  const channel = normalizeText(value).toLowerCase();
  if (PROJECTABLE_SOURCE_CHANNELS.has(channel)) return channel;
  const sourceText = normalizeText(source).toLowerCase();
  if (/(call|deepgram|telnyx-voice|voice)/.test(sourceText)) return 'call';
  if (/(sms|text|telnyx)/.test(sourceText)) return 'sms';
  if (/(email|instantly|mail)/.test(sourceText)) return 'email';
  if (/(analyzer|deal)/.test(sourceText)) return 'analyzer';
  return 'manual';
}

function flattenPatchFields(value = {}, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const fields = [];
  for (const [key, raw] of Object.entries(value)) {
    if (COMMIT_CONTEXT_KEYS.has(key)) continue;
    const fieldName = prefix ? `${prefix}.${key}` : key;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      fields.push(...flattenPatchFields(raw, fieldName));
    } else if (raw !== undefined) {
      fields.push({ fieldName, fieldValue: raw });
    }
  }
  return fields;
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

export function buildLeadCommitEnvelope(input = {}) {
  const patch = input.patch && typeof input.patch === 'object' && !Array.isArray(input.patch)
    ? input.patch
    : {};
  const source = normalizeText(input.source, 'manual-lead-commit') || 'manual-lead-commit';
  const sourceChannel = normalizeSourceChannel(input.sourceChannel, source);
  const leadId = normalizeText(input.leadId || patch.leadId || patch.lead_id || patch.id);
  const confidence = clampConfidence(input.confidence ?? (sourceChannel === 'manual' ? 0.9 : 0.84));
  const createdAt = input.createdAt || new Date().toISOString();
  const fieldProvenance = flattenPatchFields(patch).map((field) =>
    buildLeadFieldProvenance({
      workspaceId: input.workspaceId,
      leadId,
      fieldName: field.fieldName,
      fieldValue: field.fieldValue,
      sourceChannel,
      sourceId: input.sourceId,
      sourceExcerpt: input.sourceExcerpt,
      confidence,
      reason: input.reason || `Projected ${field.fieldName} from ${source}.`,
      actorType: input.actorType || 'ava',
      createdAt,
    })
  );
  const projectedFields = fieldProvenance
    .filter((field) => canProjectLeadField(field))
    .map((field) => field.fieldName);
  const blockedFields = fieldProvenance
    .filter((field) => !canProjectLeadField(field))
    .map((field) => field.fieldName);
  const contractContext =
    patch.contractContext || patch.contract_context || patch.contracts || input.contractContext || {};
  const approvalContext =
    patch.approvalContext || patch.approval_context || patch.approvals || input.approvalContext || {};

  const commitSeed = JSON.stringify({
    leadId,
    source,
    sourceChannel,
    sourceId: input.sourceId || '',
    fields: fieldProvenance.map((field) => field.fieldName),
    createdAt,
  });

  return {
    schema: 'pbk.lead.commit_envelope.v1',
    commitId: `lead-commit-${stableHash(commitSeed)}`,
    workspaceId: normalizeText(input.workspaceId, 'pbk') || 'pbk',
    leadId,
    source,
    sourceChannel,
    sourceId: normalizeText(input.sourceId),
    actorType: normalizeText(input.actorType, 'ava') || 'ava',
    confidence,
    reason: normalizeText(input.reason).slice(0, 500),
    fieldProvenance,
    projectionProof: {
      schema: 'pbk.lead.projection_proof.v1',
      eligible: Boolean(leadId && fieldProvenance.length && blockedFields.length === 0),
      fieldCount: fieldProvenance.length,
      projectedFields,
      blockedFields,
      generatedAt: createdAt,
    },
    contractContext: {
      present: Boolean(contractContext && typeof contractContext === 'object' && Object.keys(contractContext).length),
      keys: contractContext && typeof contractContext === 'object' ? Object.keys(contractContext).sort() : [],
    },
    approvalContext: {
      present: Boolean(approvalContext && typeof approvalContext === 'object' && Object.keys(approvalContext).length),
      keys: approvalContext && typeof approvalContext === 'object' ? Object.keys(approvalContext).sort() : [],
    },
    createdAt,
  };
}

export function canCommitLeadEnvelope(input = {}) {
  const envelope = input?.schema === 'pbk.lead.commit_envelope.v1'
    ? input
    : buildLeadCommitEnvelope(input);
  return Boolean(
    envelope.leadId &&
      envelope.fieldProvenance?.length &&
      envelope.projectionProof?.eligible === true &&
      envelope.fieldProvenance.every((field) => canProjectLeadField(field))
  );
}
