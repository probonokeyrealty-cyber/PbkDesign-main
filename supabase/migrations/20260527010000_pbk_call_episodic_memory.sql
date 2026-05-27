-- PBK Ava episodic call memory.
-- Stores outcome-weighted call transcript embeddings so Ava can retrieve
-- similar past winning calls during live-call strategy resolution.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.call_embeddings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  call_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'unknown',
  sentiment NUMERIC,
  source_text TEXT NOT NULL DEFAULT '',
  transcript_hash TEXT NOT NULL DEFAULT '',
  embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  embedding VECTOR(1536),
  synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, call_id, embedding_model)
);

ALTER TABLE public.call_embeddings
  ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS call_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sentiment NUMERIC,
  ADD COLUMN IF NOT EXISTS source_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transcript_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS synthetic BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS call_embeddings_workspace_call_model_idx
  ON public.call_embeddings (workspace_id, call_id, embedding_model);

CREATE INDEX IF NOT EXISTS call_embeddings_lead_created_idx
  ON public.call_embeddings (workspace_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS call_embeddings_outcome_idx
  ON public.call_embeddings (workspace_id, outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS call_embeddings_text_idx
  ON public.call_embeddings
  USING GIN (to_tsvector('english', source_text));

CREATE INDEX IF NOT EXISTS call_embeddings_embedding_idx
  ON public.call_embeddings
  USING hnsw (embedding vector_cosine_ops);

DROP TRIGGER IF EXISTS call_embeddings_set_updated_at ON public.call_embeddings;
CREATE TRIGGER call_embeddings_set_updated_at
  BEFORE UPDATE ON public.call_embeddings
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

ALTER TABLE public.call_embeddings ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_call_embeddings(
  query_embedding VECTOR(1536),
  match_threshold DOUBLE PRECISION DEFAULT 0.72,
  match_count INT DEFAULT 3,
  exclude_lead_id TEXT DEFAULT '',
  exclude_call_id TEXT DEFAULT ''
)
RETURNS TABLE (
  call_id TEXT,
  lead_id TEXT,
  outcome TEXT,
  source_text TEXT,
  similarity DOUBLE PRECISION,
  metadata JSONB,
  synthetic BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ce.call_id,
    ce.lead_id,
    ce.outcome,
    ce.source_text,
    1 - (ce.embedding <=> query_embedding) AS similarity,
    ce.metadata,
    ce.synthetic,
    ce.created_at
  FROM public.call_embeddings ce
  WHERE ce.workspace_id = 'pbk'
    AND ce.embedding IS NOT NULL
    AND (exclude_lead_id = '' OR ce.lead_id <> exclude_lead_id)
    AND (exclude_call_id = '' OR ce.call_id <> exclude_call_id)
    AND 1 - (ce.embedding <=> query_embedding) >= match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 10));
$$;

COMMENT ON TABLE public.call_embeddings IS
  'Outcome-weighted episodic call memory for Ava. Each row is a memory capsule from a prior call transcript.';

COMMENT ON FUNCTION public.match_call_embeddings(VECTOR, DOUBLE PRECISION, INT, TEXT, TEXT) IS
  'Returns similar past call memory capsules by cosine similarity for Ava live-call resolver retrieval.';
