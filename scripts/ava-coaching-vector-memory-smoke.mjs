import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AVA_COACHING_EMBEDDING_DIMENSIONS,
  buildAvaCoachingEmbeddingText,
  normalizeAvaCoachingMemoryRow,
} from './ava-coaching-memory.mjs';

const text = buildAvaCoachingEmbeddingText({
  memoryType: 'objection',
  objectionTag: 'price-too-low',
  pathKey: 'cash',
  prompt: 'The seller says the offer is too low.',
  response: 'Label the concern, explain the repair math, then ask a calibrated question.',
  outcome: 'positive_signal',
  source: 'ava-self-learning',
  metadata: {
    tactic: 'labeling + calibrated question',
    excerpt: 'I need a higher number.',
    secret: 'must-not-be-embedded',
  },
});

assert.match(text, /Memory type: objection/);
assert.match(text, /Objection: price-too-low/);
assert.match(text, /Recommended response:/);
assert.match(text, /labeling \+ calibrated question/);
assert.doesNotMatch(text, /must-not-be-embedded/);
assert.equal(AVA_COACHING_EMBEDDING_DIMENSIONS, 1536);

const normalized = normalizeAvaCoachingMemoryRow({
  id: 'coach-1',
  workspace_id: 'pbk',
  memory_type: 'objection',
  objection_tag: 'trust-issue',
  has_embedding: true,
  score: '0.82',
});
assert.equal(normalized.id, 'coach-1');
assert.equal(normalized.objectionTag, 'trust-issue');
assert.equal(normalized.hasEmbedding, true);
assert.equal(normalized.score, 0.82);

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20260608030000_pbk_ava_coaching_vector_memory.sql'),
  'utf8'
);

assert.match(bridge, /backfillAvaCoachingMemoryEmbeddings/);
assert.match(bridge, /runAvaCoachingMemoryCanary/);
assert.match(bridge, /memoryType.*ava_coaching/s);
assert.match(bridge, /ANALYZE public\.coach_memory/);
assert.match(
  dockerfile,
  /COPY scripts\/ava-coaching-memory\.mjs \.\/scripts\/ava-coaching-memory\.mjs/
);
assert.match(migration, /embedding VECTOR\(1536\)/);
assert.match(migration, /USING hnsw \(embedding vector_cosine_ops\)/);
assert.ok(packageJson.scripts?.['test:ava-coaching-vector-memory']);
assert.ok(
  packageJson.scripts?.['test:founder']?.includes('test:ava-coaching-vector-memory')
);

console.log('ava-coaching-vector-memory-smoke: ok');
