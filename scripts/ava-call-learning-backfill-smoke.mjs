import assert from 'node:assert/strict';

import { planCallLearningBackfill } from './ava-call-learning-backfill.mjs';

const result = planCallLearningBackfill({
  transcripts: [
    {
      callId: 'call-1',
      transcript: 'Seller said the house needs repairs and they want to close quickly.',
    },
    {
      call_id: 'call-2',
      body: 'Too short.',
    },
    {
      call_id: 'call-3',
      transcript: '',
      body: 'Seller mentioned a preferred closing timeline and confirmed the property condition during the call.',
    },
  ],
});

assert.equal(result.total, 3, 'smoke should inspect all transcript rows.');
assert.equal(result.eligible, 2, 'smoke should identify transcript and body fallback rows.');
assert.equal(result.skipped, 1, 'smoke should skip the short transcript.');
assert.equal(result.callIds[0], 'call-1', 'eligible call id should be retained.');
assert.equal(result.callIds[1], 'call-3', 'empty transcripts should fall through to usable body text.');

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_call_learning_backfill_plan_ready',
      plan: result,
    },
    null,
    2,
  ),
);
