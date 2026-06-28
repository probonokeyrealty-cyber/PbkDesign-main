import assert from 'node:assert/strict';

import {
  buildLeadFieldProvenance,
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

console.log('[lead-field-provenance-smoke] ok');
