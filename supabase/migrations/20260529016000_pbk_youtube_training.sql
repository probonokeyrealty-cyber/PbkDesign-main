-- PBK YouTube training pipeline.
-- Stores Brain-ingested YouTube call transcripts as reusable eval cases and
-- coach-memory extraction bundles. RLS stays enabled because public is an
-- exposed Supabase schema by default.

CREATE TABLE IF NOT EXISTS public.test_cases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  source TEXT NOT NULL DEFAULT 'youtube',
  source_url TEXT NOT NULL,
  video_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT 'ava',
  title TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  coach_memory_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'ready',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'youtube',
  ADD COLUMN IF NOT EXISTS source_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS video_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'ava',
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS transcript TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS coach_memory_entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS test_cases_tenant_status_idx
  ON public.test_cases (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS test_cases_tenant_agent_idx
  ON public.test_cases (tenant_id, agent_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS test_cases_tenant_source_agent_idx
  ON public.test_cases (tenant_id, source_url, agent_id)
  WHERE source = 'youtube';

CREATE INDEX IF NOT EXISTS test_cases_assertions_gin_idx
  ON public.test_cases USING GIN (assertions);

ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages pbk test cases" ON public.test_cases;
CREATE POLICY "service role manages pbk test cases"
  ON public.test_cases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_cases TO service_role;

DROP TRIGGER IF EXISTS test_cases_set_updated_at ON public.test_cases;
CREATE TRIGGER test_cases_set_updated_at
  BEFORE UPDATE ON public.test_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.pbk_set_updated_at();
