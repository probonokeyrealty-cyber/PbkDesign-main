-- PBK fuzzy lead lookup for Ava and Command Center search.
-- Additive only: enables pg_trgm and creates a reusable lookup function.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.lead_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  file_name TEXT NOT NULL DEFAULT '',
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_profiles_lead_name_trgm_idx
  ON public.lead_profiles USING GIN (LOWER(lead_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lead_profiles_address_trgm_idx
  ON public.lead_profiles USING GIN (LOWER(address) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lead_profiles_email_trgm_idx
  ON public.lead_profiles USING GIN (LOWER(email) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lead_imports_payload_seller_name_trgm_idx
  ON public.lead_imports USING GIN (
    LOWER(COALESCE(payload->'seller'->>'name', payload->>'leadName', payload->>'name', '')) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS lead_imports_payload_property_address_trgm_idx
  ON public.lead_imports USING GIN (
    LOWER(COALESCE(payload->'property'->>'address', payload->>'address', payload->>'propertyAddress', '')) gin_trgm_ops
  );

CREATE OR REPLACE FUNCTION public.pbk_fuzzy_lead_lookup(
  search_query TEXT,
  match_threshold DOUBLE PRECISION DEFAULT 0.3,
  max_results INTEGER DEFAULT 8
)
RETURNS TABLE (
  lead_id TEXT,
  source TEXT,
  lead_name TEXT,
  address TEXT,
  email TEXT,
  phone TEXT,
  stage TEXT,
  score NUMERIC,
  similarity_score REAL,
  raw JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH input AS (
    SELECT
      LOWER(TRIM(COALESCE(search_query, ''))) AS query,
      GREATEST(0.05::DOUBLE PRECISION, LEAST(1::DOUBLE PRECISION, COALESCE(match_threshold, 0.3))) AS threshold,
      GREATEST(1, LEAST(50, COALESCE(max_results, 8))) AS result_limit
  ),
  profile_candidates AS (
    SELECT
      lp.id::TEXT AS lead_id,
      'lead_profiles'::TEXT AS source,
      lp.lead_name::TEXT AS lead_name,
      lp.address::TEXT AS address,
      lp.email::TEXT AS email,
      lp.phone::TEXT AS phone,
      lp.stage::TEXT AS stage,
      GREATEST(lp.engagement_score, lp.motivation_score)::NUMERIC AS score,
      GREATEST(
        similarity(LOWER(COALESCE(lp.lead_name, '')), input.query),
        similarity(LOWER(COALESCE(lp.address, '')), input.query),
        similarity(LOWER(COALESCE(lp.email, '')), input.query),
        similarity(LOWER(COALESCE(lp.phone, '')), input.query),
        similarity(LOWER(CONCAT_WS(' ', lp.lead_name, lp.address, lp.email, lp.phone)), input.query)
      ) AS similarity_score,
      jsonb_build_object(
        'id', lp.id,
        'workspaceId', lp.workspace_id,
        'source', lp.source,
        'status', lp.status,
        'stage', lp.stage,
        'temperature', lp.temperature,
        'raw', lp.raw
      ) AS raw
    FROM public.lead_profiles lp
    CROSS JOIN input
    WHERE input.query <> ''
  ),
  import_candidates AS (
    SELECT
      li.id::TEXT AS lead_id,
      'lead_imports'::TEXT AS source,
      COALESCE(li.payload->'seller'->>'name', li.payload->>'leadName', li.payload->>'name', '')::TEXT AS lead_name,
      COALESCE(li.payload->'property'->>'address', li.payload->>'address', li.payload->>'propertyAddress', '')::TEXT AS address,
      COALESCE(li.payload->'seller'->>'email', li.payload->>'email', '')::TEXT AS email,
      COALESCE(li.payload->'seller'->>'phone', li.payload->>'phone', '')::TEXT AS phone,
      COALESCE(li.payload->>'stage', li.status, '')::TEXT AS stage,
      CASE
        WHEN COALESCE(li.payload->>'motivationScore', '') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN (li.payload->>'motivationScore')::NUMERIC
        ELSE 0
      END AS score,
      GREATEST(
        similarity(LOWER(COALESCE(li.payload->'seller'->>'name', li.payload->>'leadName', li.payload->>'name', '')), input.query),
        similarity(LOWER(COALESCE(li.payload->'property'->>'address', li.payload->>'address', li.payload->>'propertyAddress', '')), input.query),
        similarity(LOWER(COALESCE(li.payload->'seller'->>'email', li.payload->>'email', '')), input.query),
        similarity(LOWER(COALESCE(li.payload->'seller'->>'phone', li.payload->>'phone', '')), input.query),
        similarity(
          LOWER(CONCAT_WS(
            ' ',
            COALESCE(li.payload->'seller'->>'name', li.payload->>'leadName', li.payload->>'name', ''),
            COALESCE(li.payload->'property'->>'address', li.payload->>'address', li.payload->>'propertyAddress', ''),
            COALESCE(li.payload->'seller'->>'email', li.payload->>'email', ''),
            COALESCE(li.payload->'seller'->>'phone', li.payload->>'phone', '')
          )),
          input.query
        )
      ) AS similarity_score,
      li.payload AS raw
    FROM public.lead_imports li
    CROSS JOIN input
    WHERE input.query <> ''
  ),
  ranked AS (
    SELECT * FROM profile_candidates
    UNION ALL
    SELECT * FROM import_candidates
  )
  SELECT
    ranked.lead_id,
    ranked.source,
    ranked.lead_name,
    ranked.address,
    ranked.email,
    ranked.phone,
    ranked.stage,
    ranked.score,
    ranked.similarity_score,
    ranked.raw
  FROM ranked
  CROSS JOIN input
  WHERE ranked.similarity_score >= input.threshold
  ORDER BY ranked.similarity_score DESC, ranked.score DESC NULLS LAST, ranked.lead_name ASC
  LIMIT (SELECT result_limit FROM input);
$$;

GRANT EXECUTE ON FUNCTION public.pbk_fuzzy_lead_lookup(TEXT, DOUBLE PRECISION, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pbk_fuzzy_lead_lookup(TEXT, DOUBLE PRECISION, INTEGER) TO service_role;
