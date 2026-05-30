import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bridgePath = resolve('scripts/openclaw-local-server.mjs');
const bridge = readFileSync(bridgePath, 'utf8');
const dockerfile = readFileSync(resolve('Dockerfile.openclaw'), 'utf8');

const synthetic = await import('./synthetic-edge-cases.mjs');
const entries = synthetic.buildSyntheticEdgeCaseObjections({ count: 50 });

assert.equal(entries.length, 50, 'synthetic generator should create 50 edge-case objections.');
assert.equal(new Set(entries.map((entry) => entry.id)).size, 50, 'synthetic objections should have deterministic unique ids.');
assert(entries.every((entry) => entry.source === 'synthetic'), 'synthetic objections should be labeled source=synthetic.');
assert(entries.every((entry) => entry.memoryType === 'objection'), 'synthetic objections should be coach_memory objection rows.');
assert(entries.every((entry) => entry.prompt && entry.response), 'synthetic objections should include prompt and response text.');

assert.match(bridge, /PBK_EMOTION_WORLD_MODEL_RETRAIN_ENABLED/, 'bridge should expose a guarded weekly emotion-world-model retraining flag.');
assert.match(bridge, /weekly-emotion-world-model-export/, 'closed-loop scheduler should include weekly emotion-world-model export.');
assert.match(bridge, /generateSyntheticEdgeCases/, 'bridge should expose a generateSyntheticEdgeCases tool.');
assert.match(bridge, /POST' && pathname === '\/api\/feedback'/, 'bridge should expose POST /api/feedback.');

assert.match(bridge, /EventTypes\.CALL_COMPLETED[\s\S]*upsertCallEmbeddingFromTranscript/, 'call.completed should trigger transcript embedding upsert.');
assert.match(bridge, /async function retrieveLiveBrainKnowledge/, 'live Ava RAG retrieval should remain wired.');
assert.match(bridge, /async getPropertyData/, 'property-data tool should remain wired.');
assert.match(dockerfile, /COPY scripts\/synthetic-edge-cases\.mjs \.\/scripts\/synthetic-edge-cases\.mjs/, 'Render Docker image should copy the synthetic edge-case runtime module.');

console.log('[tier-additives-smoke] ok', {
  syntheticCount: entries.length,
  source: entries[0]?.source,
});
