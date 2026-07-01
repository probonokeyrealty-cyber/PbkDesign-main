import assert from 'node:assert/strict';

import {
  buildLeadCommitEnvelope,
  buildLeadFieldProvenance,
  canCommitLeadEnvelope,
  canProjectLeadField,
} from './lead-field-provenance.mjs';

const provenance = buildLeadFieldProvenance({
  leadId: 'lead-1',
  fieldName: 'timeline',
  fieldValue: 'ready this month',
  sourceChannel: 'call',
  sourceId: 'call-1',
  sourceExcerpt: 'I can close this month',
  confidence: 0.91,
  reason: 'seller stated timeline directly',
});

assert.equal(provenance.workspaceId, 'pbk', 'workspace defaults to pbk');
assert.equal(provenance.actorType, 'ava', 'actor type defaults to ava');
assert.equal(provenance.confidence, 0.91, 'confidence is preserved');
assert.equal(canProjectLeadField(provenance), true, 'high confidence call field can project');
assert.equal(
  canProjectLeadField({ ...provenance, confidence: 0.4 }),
  false,
  'low confidence is blocked'
);

const clamped = buildLeadFieldProvenance({
  ...provenance,
  confidence: 4,
  sourceExcerpt: 'x'.repeat(700),
  reason: 'y'.repeat(700),
});

assert.equal(clamped.confidence, 1, 'confidence is clamped to 1');
assert.equal(clamped.sourceExcerpt.length, 500, 'source excerpt is truncated');
assert.equal(clamped.reason.length, 500, 'reason is truncated');

assert.equal(
  canProjectLeadField({ ...provenance, sourceChannel: 'unknown' }),
  false,
  'unsupported source channel is blocked'
);
assert.equal(
  canProjectLeadField({ ...provenance, fieldName: '' }),
  false,
  'missing field name is blocked'
);

const commitEnvelope = buildLeadCommitEnvelope({
  leadId: 'lead-1',
  source: 'analyzer-deal-sync',
  sourceChannel: 'analyzer',
  sourceId: 'analyzer-run-1',
  actorType: 'ava',
  reason: 'Analyzer saved deal numbers to the lead profile.',
  confidence: 0.92,
  patch: {
    seller: { phone: '+16575001765' },
    property: { address: '202 Cherry Ln', mao: 180000 },
    analyzer: { selectedPath: 'cash', mao: 180000 },
    contractContext: { readyForDraft: true },
    approvalContext: { requiredForContract: true },
  },
});

assert.equal(commitEnvelope.schema, 'pbk.lead.commit_envelope.v1', 'lead commit envelope should be versioned');
assert.equal(commitEnvelope.leadId, 'lead-1', 'lead commit envelope should retain lead id');
assert.equal(commitEnvelope.sourceChannel, 'analyzer', 'lead commit envelope should retain source channel');
assert.equal(commitEnvelope.fieldProvenance.length >= 4, true, 'lead commit envelope should create field provenance rows');
assert.equal(
  commitEnvelope.fieldProvenance.every((field) => field.sourceChannel === 'analyzer' && field.confidence === 0.92),
  true,
  'lead commit field provenance should carry source and confidence'
);
assert.equal(
  commitEnvelope.projectionProof.projectedFields.includes('property.address'),
  true,
  'lead commit projection proof should list projected fields'
);
assert.equal(commitEnvelope.contractContext.present, true, 'lead commit envelope should prove contract context presence');
assert.equal(commitEnvelope.approvalContext.present, true, 'lead commit envelope should prove approval context presence');
assert.equal(canCommitLeadEnvelope(commitEnvelope), true, 'projectable lead commit envelope should be accepted');

const lowConfidenceEnvelope = buildLeadCommitEnvelope({
  leadId: 'lead-1',
  sourceChannel: 'call',
  confidence: 0.4,
  patch: { motivation: { timeline: 'maybe later' } },
});

assert.equal(canCommitLeadEnvelope(lowConfidenceEnvelope), false, 'low-confidence lead commit envelope should fail projection');
assert.equal(
  lowConfidenceEnvelope.projectionProof.blockedFields.includes('motivation.timeline'),
  true,
  'low-confidence fields should be visible as blocked projection fields'
);

console.log('[lead-field-provenance-smoke] ok');
