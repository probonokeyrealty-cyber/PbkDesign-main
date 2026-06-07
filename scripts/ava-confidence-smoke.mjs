import assert from 'node:assert/strict';

import { calibrateAvaConfidence } from './ava-confidence.mjs';
import {
  applyWarmthDominance,
  selectWarmthDominance,
} from './warmth-dominance.mjs';

const strong = calibrateAvaConfidence({
  pathConfidence: 0.92,
  goalConfidence: 0.88,
  closingConfidence: 0.9,
  transcriptConfidence: 0.94,
  bantComplete: true,
  evidenceCount: 5,
  pathLocked: true,
});
assert.equal(strong.band, 'high');
assert.equal(strong.responseMode, 'proceed');
assert.equal(strong.offerApproval, 'always_required');

const uncertain = calibrateAvaConfidence({
  pathConfidence: 0.52,
  goalConfidence: 0.45,
  closingConfidence: 0.58,
  bantKnown: 1,
  bantMissing: 4,
  evidenceCount: 0,
  pathLocked: false,
  goalUncertaintyHigh: true,
  novelObjection: true,
});
assert.equal(uncertain.band, 'low');
assert.equal(uncertain.responseMode, 'verify');
assert.equal(uncertain.shouldVerify, true);

const handoff = calibrateAvaConfidence({
  pathConfidence: 0.9,
  closingConfidence: 0.9,
  bantComplete: true,
  evidenceCount: 4,
  pathLocked: true,
  shouldHandoff: true,
});
assert.equal(handoff.responseMode, 'handoff');
assert.ok(handoff.score <= 0.42);

const sparse = calibrateAvaConfidence({
  pathConfidence: 0.95,
  goalConfidence: 0.9,
  pathLocked: true,
});
assert.equal(sparse.band, 'low');
assert.equal(sparse.responseMode, 'verify');
assert.ok(sparse.reasons.includes('insufficient_independent_evidence'));

const warm = selectWarmthDominance({
  emotion: 'fear',
  sentiment: 0.32,
  pathLocked: false,
  bantComplete: false,
});
assert.equal(warm.mode, 'warm');

const decisive = selectWarmthDominance({
  emotion: 'positive',
  sentiment: 0.86,
  buyingSignal: 0.9,
  pathLocked: true,
  bantComplete: true,
});
assert.equal(decisive.mode, 'decisive');

const boundary = selectWarmthDominance({ shouldStopContact: true });
assert.equal(boundary.mode, 'boundary');

const applied = applyWarmthDominance(
  { speed: 1, stability: 0.5, similarityBoost: 0.78, pauseMs: 650 },
  warm
);
assert.ok(applied.speed <= 0.9);
assert.ok(applied.stability >= 0.66);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_confidence_and_delivery_ready',
      strong,
      uncertain,
      handoff,
      sparse,
      styles: {
        warm: warm.mode,
        decisive: decisive.mode,
        boundary: boundary.mode,
      },
    },
    null,
    2
  )
);
