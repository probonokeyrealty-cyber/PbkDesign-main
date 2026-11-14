import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
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

const bridgeSource = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const bridgeAst = ts.createSourceFile('bridge.mjs', bridgeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const labelDeclaration = bridgeAst.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'formatEpisodicMemoryLabel'
);
assert(labelDeclaration, 'Bridge must label episodic memory by its observed outcome.');
const label = vm.runInNewContext(`${labelDeclaration.getText(bridgeAst)}; formatEpisodicMemoryLabel;`);
for (const outcome of ['won', 'signed', 'appointment', 'callback']) {
  assert.equal(label({ outcome }), 'Similar past successful call');
}
for (const outcome of ['lost', 'failed', 'dnc', 'unqualified']) {
  assert.equal(label({ outcome }), 'Similar past caution call');
}
assert.equal(label({ metadata: { outcome: 'lost' } }), 'Similar past caution call');
assert.equal(label({}), 'Closest similar past call');
assert.equal(label({ outcome: 'unknown' }, 1), 'Similar past call');

console.log('ava-episodic-memory-smoke: ok');
