-- Canonical pgvector memory for Rex research.
-- This migration deliberately extends brain_blog_posts instead of adding a
-- competing memory store.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.brain_blog_posts
  ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS embedding VECTOR(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  ADD COLUMN IF NOT EXISTS embedding_hash TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS brain_blog_posts_workspace_source_url_idx
  ON public.brain_blog_posts (workspace_id, source_url)
  WHERE source_url IS NOT NULL AND source_url <> '';

CREATE UNIQUE INDEX IF NOT EXISTS brain_blog_posts_workspace_content_hash_idx
  ON public.brain_blog_posts (workspace_id, content_hash)
  WHERE content_hash IS NOT NULL AND content_hash <> '';

CREATE INDEX IF NOT EXISTS brain_blog_posts_workspace_created_idx
  ON public.brain_blog_posts (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS brain_blog_posts_search_idx
  ON public.brain_blog_posts
  USING GIN (
    to_tsvector(
      'english',
      COALESCE(title, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content, '')
    )
  );

CREATE INDEX IF NOT EXISTS brain_blog_posts_embedding_hnsw_idx
  ON public.brain_blog_posts
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

ALTER TABLE public.brain_blog_posts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_vector_canary_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  memory_type TEXT NOT NULL DEFAULT 'rex_research',
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  result TEXT NOT NULL DEFAULT 'pending',
  latency_ms INTEGER,
  embedding_model TEXT NOT NULL DEFAULT '',
  dimensions INTEGER NOT NULL DEFAULT 0,
  matched_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_vector_canary_runs_lookup_idx
  ON public.pbk_vector_canary_runs (workspace_id, memory_type, created_at DESC);

ALTER TABLE public.pbk_vector_canary_runs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.match_brain_blog_posts(
  query_embedding VECTOR(1536),
  match_threshold DOUBLE PRECISION DEFAULT 0.45,
  match_count INTEGER DEFAULT 5,
  workspace_filter TEXT DEFAULT 'pbk'
)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  source_url TEXT,
  source_name TEXT,
  summary TEXT,
  content TEXT,
  tags TEXT[],
  revenue_streams TEXT[],
  sales_mentor TEXT,
  technique_type TEXT,
  similarity DOUBLE PRECISION,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    post.id,
    post.title,
    post.source_url,
    post.source_name,
    post.summary,
    post.content,
    post.tags,
    post.revenue_streams,
    post.sales_mentor,
    post.technique_type,
    1 - (post.embedding <=> query_embedding) AS similarity,
    post.metadata,
    post.created_at
  FROM public.brain_blog_posts AS post
  WHERE post.workspace_id = workspace_filter
    AND post.embedding IS NOT NULL
    AND post.status <> 'hidden'
    AND 1 - (post.embedding <=> query_embedding) >= match_threshold
  ORDER BY post.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 20));
$$;

REVOKE ALL ON TABLE public.brain_blog_posts FROM PUBLIC;
REVOKE ALL ON TABLE public.pbk_vector_canary_runs FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_brain_blog_posts(VECTOR, DOUBLE PRECISION, INTEGER, TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.brain_blog_posts FROM anon;
    REVOKE ALL ON TABLE public.pbk_vector_canary_runs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.brain_blog_posts FROM authenticated;
    REVOKE ALL ON TABLE public.pbk_vector_canary_runs FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.brain_blog_posts TO service_role;
    GRANT ALL ON TABLE public.pbk_vector_canary_runs TO service_role;
    GRANT EXECUTE ON FUNCTION public.match_brain_blog_posts(VECTOR, DOUBLE PRECISION, INTEGER, TEXT) TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.pbk_vector_canary_runs IS
  'Recent semantic round-trip evidence used to decide whether Rex research memory is genuinely production-ready.';
