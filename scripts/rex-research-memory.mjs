export const REX_RESEARCH_EMBEDDING_DIMENSIONS = 1536;
export const REX_RESEARCH_EMBEDDING_MODEL = 'text-embedding-3-small';

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeList(value = []) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(
    new Set(
      items
        .map((item) => normalizeText(item))
        .filter(Boolean)
    )
  );
}

/**
 * Builds the canonical text embedded for Rex research memory.
 */
export function buildRexResearchEmbeddingText(post = {}) {
  const sections = [
    ['Title', post.title],
    ['Source', post.sourceName || post.source || post.sourceUrl],
    ['Sales mentor', post.salesMentor],
    ['Technique', post.techniqueType],
    ['Revenue streams', normalizeList(post.revenueStreams || post.revenue_streams).join(', ')],
    ['Tags', normalizeList(post.tags).join(', ')],
    ['Summary', post.summary || post.excerpt],
    ['Key takeaways', normalizeList(post.keyTakeaways || post.key_takeaways).join('; ')],
    ['Content', post.content || post.body || post.transcript],
  ]
    .map(([label, value]) => {
      const text = normalizeText(value);
      return text ? `${label}: ${text}` : '';
    })
    .filter(Boolean);

  return sections.join('\n').slice(0, 8000);
}

/**
 * Converts a pgvector match row into the shared Rex/Ava memory shape.
 */
export function normalizeRexResearchMemoryRow(row = {}) {
  const similarity = Number(row.similarity || 0);
  return {
    id: String(row.id || ''),
    type: 'rex_vector_memory',
    title: normalizeText(row.title || 'Rex research memory'),
    source: normalizeText(row.source_name || row.source_url || 'PBK Brain Blog'),
    sourceUrl: normalizeText(row.source_url),
    summary: normalizeText(row.summary || row.content),
    content: normalizeText(row.content || row.summary),
    tags: normalizeList(row.tags),
    revenueStreams: normalizeList(row.revenue_streams),
    salesMentor: normalizeText(row.sales_mentor),
    techniqueType: normalizeText(row.technique_type),
    similarity: Number.isFinite(similarity) ? similarity : 0,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at || null,
  };
}

/**
 * Ensures the canonical Rex research vector schema exists at bridge startup.
 */
export async function ensureRexResearchMemorySchema(pool) {
  if (!pool) return false;

  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS public.brain_blog_posts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
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
      embedding_model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
      embedding_hash TEXT NOT NULL DEFAULT '',
      embedded_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    DROP TRIGGER IF EXISTS pbk_brain_blog_posts_updated_at ON public.brain_blog_posts;
    CREATE TRIGGER pbk_brain_blog_posts_updated_at
      BEFORE UPDATE ON public.brain_blog_posts
      FOR EACH ROW
      EXECUTE FUNCTION public.pbk_set_updated_at();
  `);

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS brain_blog_posts_embedding_hnsw_idx
        ON public.brain_blog_posts
        USING hnsw (embedding vector_cosine_ops)
        WHERE embedding IS NOT NULL;
    `);
  } catch (error) {
    console.warn(
      '[pbk-local-openclaw] Rex research HNSW index unavailable; falling back to IVFFlat:',
      error?.message || error
    );
    await pool.query(`
      CREATE INDEX IF NOT EXISTS brain_blog_posts_embedding_ivfflat_idx
        ON public.brain_blog_posts
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        WHERE embedding IS NOT NULL;
    `);
  }

  await pool.query(`
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

    REVOKE ALL ON TABLE public.brain_blog_posts FROM PUBLIC;
    REVOKE ALL ON TABLE public.pbk_vector_canary_runs FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.match_brain_blog_posts(VECTOR, DOUBLE PRECISION, INTEGER, TEXT, TEXT) FROM PUBLIC;

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
        GRANT EXECUTE ON FUNCTION public.match_brain_blog_posts(VECTOR, DOUBLE PRECISION, INTEGER, TEXT, TEXT) TO service_role;
      END IF;
    END $$;
  `);

  return true;
}
