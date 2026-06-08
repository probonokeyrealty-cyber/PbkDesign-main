import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REX_RESEARCH_EMBEDDING_DIMENSIONS,
  buildRexResearchEmbeddingText,
  normalizeRexResearchMemoryRow,
} from './rex-research-memory.mjs';

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const bridge = read('scripts/openclaw-local-server.mjs');
const migration = read('supabase/migrations/20260608010000_pbk_rex_research_vector_memory.sql');
const settings = read('src/app/routes/Settings.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const embeddingText = buildRexResearchEmbeddingText({
  title: 'Probate authority',
  summary: 'Verify executor authority before discussing price.',
  tags: ['probate', 'participant verification'],
  revenueStreams: ['Wholesaling'],
});
assert(
  embeddingText.includes('Title: Probate authority') &&
    embeddingText.includes('Verify executor authority'),
  'Rex embedding text must include normalized title and research substance.'
);
assert(
  REX_RESEARCH_EMBEDDING_DIMENSIONS === 1536,
  'Rex research memory must stay aligned with text-embedding-3-small dimensions.'
);

const normalized = normalizeRexResearchMemoryRow({
  id: 'memory-1',
  title: 'Authority check',
  summary: 'Confirm the executor can decide.',
  similarity: '0.82',
  tags: ['probate'],
});
assert(
  normalized.type === 'rex_vector_memory' && normalized.similarity === 0.82,
  'pgvector rows must normalize into the shared Rex/Ava memory shape.'
);

assert(
  /ADD COLUMN IF NOT EXISTS workspace_id/.test(migration) &&
    /embedding VECTOR\(1536\)/.test(migration) &&
    /USING hnsw \(embedding vector_cosine_ops\)/.test(migration),
  'Migration must add workspace isolation, 1536-dimension embeddings, and an HNSW index.'
);
assert(
  /CREATE OR REPLACE FUNCTION public\.match_brain_blog_posts/.test(migration) &&
    /workspace_id = workspace_filter/.test(migration) &&
    /SECURITY INVOKER/.test(migration),
  'Migration must expose a workspace-scoped, invoker-safe semantic match function.'
);
assert(
  /ALTER TABLE public\.brain_blog_posts ENABLE ROW LEVEL SECURITY/.test(migration) &&
    /REVOKE ALL ON TABLE public\.brain_blog_posts FROM PUBLIC/.test(migration),
  'Rex research memory must be bridge-only and RLS-protected.'
);

assert(
  /async function embedAndPersistBrainBlogPost/.test(bridge) &&
    /async function retrieveRexResearchMemories/.test(bridge) &&
    /async function backfillRexResearchEmbeddings/.test(bridge) &&
    /async function runRexResearchMemoryCanary/.test(bridge),
  'Bridge must implement ingestion, retrieval, backfill, and semantic canary paths.'
);
assert(
  /embedAndPersistBrainBlogPost\(post/.test(bridge) &&
    /rexVectorMemoryCount/.test(bridge) &&
    /mergeRexSemanticMemory/.test(bridge),
  'Rex embeddings must feed both Ava live RAG and Rex conversational retrieval.'
);
assert(
  /\/api\/brain\/vector\/backfill/.test(bridge) &&
    /\/api\/brain\/vector\/canary/.test(bridge),
  'Protected operational endpoints must exist for production backfill and canary verification.'
);
assert(
  /rexResearchReady/.test(bridge) &&
    /run_rex_vector_canary/.test(bridge) &&
    /Rex research memory is not production-ready/.test(bridge),
  'Capacity status must remain honest until the complete readiness gate passes.'
);

assert(
  /rexResearch\?:/.test(runtimeBridge) &&
    /Rex semantic memory/.test(settings) &&
    /Needs proof/.test(settings),
  'Settings must show Rex readiness separately instead of implying all pgvector memory is live.'
);
assert(
  /POST \/api\/brain\/vector\/backfill/.test(dataMap) &&
    /POST \/api\/brain\/vector\/canary/.test(dataMap),
  'The bridge data map must document the real Rex vector operations.'
);

console.log('rex-research-vector-memory-smoke: ok');
