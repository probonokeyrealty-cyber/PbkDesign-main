-- PBK Brain Blog: persistent sales/wholesaling research feed for Rex.
-- Keeps operational Brain state queryable while staying compatible with the
-- bridge's existing text-id runtime records.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.brain_blog_posts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_name TEXT,
  published_at TIMESTAMPTZ,
  content TEXT,
  summary TEXT,
  key_takeaways TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  revenue_streams TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sales_mentor TEXT,
  technique_type TEXT,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  trained_at TIMESTAMPTZ,
  embedding VECTOR(1536),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS brain_blog_posts_source_url_idx
  ON public.brain_blog_posts (source_url)
  WHERE source_url IS NOT NULL AND source_url <> '';

CREATE UNIQUE INDEX IF NOT EXISTS brain_blog_posts_content_hash_idx
  ON public.brain_blog_posts (content_hash)
  WHERE content_hash IS NOT NULL AND content_hash <> '';

CREATE INDEX IF NOT EXISTS brain_blog_posts_published_at_idx
  ON public.brain_blog_posts (published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS brain_blog_posts_created_at_idx
  ON public.brain_blog_posts (created_at DESC);

CREATE INDEX IF NOT EXISTS brain_blog_posts_tags_gin_idx
  ON public.brain_blog_posts USING GIN (tags);

CREATE INDEX IF NOT EXISTS brain_blog_posts_revenue_streams_gin_idx
  ON public.brain_blog_posts USING GIN (revenue_streams);

CREATE INDEX IF NOT EXISTS brain_blog_posts_sales_mentor_idx
  ON public.brain_blog_posts (sales_mentor);

CREATE INDEX IF NOT EXISTS brain_blog_posts_technique_type_idx
  ON public.brain_blog_posts (technique_type);

DROP TRIGGER IF EXISTS pbk_brain_blog_posts_updated_at ON public.brain_blog_posts;
CREATE TRIGGER pbk_brain_blog_posts_updated_at
BEFORE UPDATE ON public.brain_blog_posts
FOR EACH ROW
EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON TABLE public.brain_blog_posts IS
  'PBK Brain Blog posts harvested from RSS, YouTube transcripts, uploads, and manual sales/wholesaling research. Used by Rex RAG and Train Rex actions.';
