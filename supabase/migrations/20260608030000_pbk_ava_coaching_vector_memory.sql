-- Canonical pgvector metadata for Ava coaching memory.
-- Render Postgres is the current source of truth; this keeps Supabase schema
-- parity without copying or duplicating coaching rows.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.coach_memory
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedding_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS coach_memory_embedding_idx
  ON public.coach_memory
  USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_coach_memory(
  query_embedding VECTOR(1536),
  match_threshold DOUBLE PRECISION DEFAULT 0.75,
  match_count INT DEFAULT 3,
  memory_type_filter TEXT DEFAULT ''
)
RETURNS TABLE (
  id TEXT,
  memory_type TEXT,
  objection_tag TEXT,
  path_key TEXT,
  prompt TEXT,
  response TEXT,
  score NUMERIC,
  similarity DOUBLE PRECISION,
  metadata JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    cm.id::TEXT,
    cm.memory_type,
    cm.objection_tag,
    cm.path_key,
    cm.prompt,
    cm.response,
    cm.score,
    1 - (cm.embedding <=> query_embedding) AS similarity,
    cm.metadata
  FROM public.coach_memory AS cm
  WHERE cm.workspace_id = 'pbk'
    AND cm.embedding IS NOT NULL
    AND (memory_type_filter = '' OR cm.memory_type = memory_type_filter)
    AND 1 - (cm.embedding <=> query_embedding) >= match_threshold
  ORDER BY cm.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 10));
$$;

REVOKE ALL ON FUNCTION public.match_coach_memory(
  VECTOR,
  DOUBLE PRECISION,
  INTEGER,
  TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.match_coach_memory(
      VECTOR,
      DOUBLE PRECISION,
      INTEGER,
      TEXT
    ) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.match_coach_memory(
      VECTOR,
      DOUBLE PRECISION,
      INTEGER,
      TEXT
    ) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.match_coach_memory(
      VECTOR,
      DOUBLE PRECISION,
      INTEGER,
      TEXT
    ) TO service_role;
  END IF;
END $$;

COMMENT ON COLUMN public.coach_memory.embedding IS
  '1536-dimension semantic representation of Ava coaching context.';
COMMENT ON COLUMN public.coach_memory.embedding_hash IS
  'SHA-256 of the embedding model and canonical coaching text.';
