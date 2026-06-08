-- Keep Ava episodic-memory retrieval inside one embedding model's semantic
-- space. Different models can share VECTOR(1536) dimensions without producing
-- comparable coordinates.

DROP FUNCTION IF EXISTS public.match_call_embeddings(
  VECTOR,
  DOUBLE PRECISION,
  INT,
  TEXT,
  TEXT
);

CREATE OR REPLACE FUNCTION public.match_call_embeddings(
  query_embedding VECTOR(1536),
  match_threshold DOUBLE PRECISION DEFAULT 0.72,
  match_count INT DEFAULT 3,
  exclude_lead_id TEXT DEFAULT '',
  exclude_call_id TEXT DEFAULT '',
  embedding_model_filter TEXT DEFAULT ''
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
SECURITY INVOKER
SET search_path = public
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
    AND (embedding_model_filter = '' OR ce.embedding_model = embedding_model_filter)
    AND (exclude_lead_id = '' OR ce.lead_id <> exclude_lead_id)
    AND (exclude_call_id = '' OR ce.call_id <> exclude_call_id)
    AND 1 - (ce.embedding <=> query_embedding) >= match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 10));
$$;

REVOKE ALL ON FUNCTION public.match_call_embeddings(
  VECTOR,
  DOUBLE PRECISION,
  INT,
  TEXT,
  TEXT,
  TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.match_call_embeddings(
      VECTOR,
      DOUBLE PRECISION,
      INT,
      TEXT,
      TEXT,
      TEXT
    ) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.match_call_embeddings(
  VECTOR,
  DOUBLE PRECISION,
  INT,
  TEXT,
  TEXT,
  TEXT
) IS 'Returns same-model past call memory capsules by cosine similarity for Ava live-call resolver retrieval.';

DROP FUNCTION IF EXISTS public.match_brain_blog_posts(
  VECTOR,
  DOUBLE PRECISION,
  INTEGER,
  TEXT
);

CREATE OR REPLACE FUNCTION public.match_brain_blog_posts(
  query_embedding VECTOR(1536),
  match_threshold DOUBLE PRECISION DEFAULT 0.45,
  match_count INTEGER DEFAULT 5,
  workspace_filter TEXT DEFAULT 'pbk',
  embedding_model_filter TEXT DEFAULT ''
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
    AND (embedding_model_filter = '' OR post.embedding_model = embedding_model_filter)
    AND post.status <> 'hidden'
    AND 1 - (post.embedding <=> query_embedding) >= match_threshold
  ORDER BY post.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 20));
$$;

REVOKE ALL ON FUNCTION public.match_brain_blog_posts(
  VECTOR,
  DOUBLE PRECISION,
  INTEGER,
  TEXT,
  TEXT
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.match_brain_blog_posts(
      VECTOR,
      DOUBLE PRECISION,
      INTEGER,
      TEXT,
      TEXT
    ) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.match_brain_blog_posts(
  VECTOR,
  DOUBLE PRECISION,
  INTEGER,
  TEXT,
  TEXT
) IS 'Returns same-model Rex research memories by cosine similarity.';
