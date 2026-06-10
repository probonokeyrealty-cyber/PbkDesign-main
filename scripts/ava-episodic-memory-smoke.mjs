import assert from 'node:assert/strict';
import {
  buildVectorTableReadiness,
  isExcludedEpisodicCall,
  selectBestEpisodicTranscript,
} from './ava-episodic-memory.mjs';

const emptyReadyStore = buildVectorTableReadiness({
  exists: true,
  dimensions: 1536,
  embeddedCount: 0,
  vectorIndexMethod: 'hnsw',
});

assert.equal(emptyReadyStore.infrastructureReady, true);
assert.equal(emptyReadyStore.populated, false);
assert.equal(emptyReadyStore.ready, false);
assert.equal(emptyReadyStore.status, 'awaiting_data');

const populatedStore = buildVectorTableReadiness({
  exists: true,
  dimensions: 1536,
  embeddedCount: 4,
  vectorIndexMethod: 'hnsw',
});

assert.equal(populatedStore.infrastructureReady, true);
assert.equal(populatedStore.populated, true);
assert.equal(populatedStore.ready, true);
assert.equal(populatedStore.status, 'ready');

assert.equal(
  selectBestEpisodicTranscript([
    'Okay.',
    [
      { speaker: 'Seller', text: 'The roof is failing and I need to close before the end of July.' },
      { speaker: 'Ava', text: 'Let us compare the repair burden with a direct sale.' },
    ],
  ]),
  'Seller: The roof is failing and I need to close before the end of July. Ava: Let us compare the repair burden with a direct sale.'
);

assert.equal(isExcludedEpisodicCall({ id: 'call-diane-live' }), true);
assert.equal(isExcludedEpisodicCall({ id: 'call-123', synthetic: true }), true);
assert.equal(
  isExcludedEpisodicCall({
    id: 'v3:real-telnyx-call',
    source: 'telnyx',
    leadName: 'John Smith',
  }),
  false
);

console.log('ava-episodic-memory-smoke: ok');
