-- PBK brain, workflow persistence, and call-recording storage seams.
-- Additive only: safe to apply after the existing operational schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('call_recordings', 'call_recordings', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = FALSE;
  END IF;
END $$;

ALTER TABLE public.unified_messages
  ADD COLUMN IF NOT EXISTS storage_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS audio_content_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC,
  ADD COLUMN IF NOT EXISTS recording_url TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.research_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'article',
  title TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  last_processed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_url)
);

CREATE TABLE IF NOT EXISTS public.coach_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  memory_type TEXT NOT NULL DEFAULT 'objection',
  objection_tag TEXT NOT NULL DEFAULT '',
  path_key TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'pending_approval',
  score NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.n8n_workflow_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  nodes JSONB NOT NULL DEFAULT '[]'::JSONB,
  connections JSONB NOT NULL DEFAULT '{}'::JSONB,
  settings JSONB NOT NULL DEFAULT '{}'::JSONB,
  tags JSONB NOT NULL DEFAULT '[]'::JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_workflow_id TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'draft',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS unified_messages_recordings_idx
  ON public.unified_messages (workspace_id, channel, storage_path)
  WHERE storage_path <> '';

CREATE INDEX IF NOT EXISTS research_sources_status_idx
  ON public.research_sources (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS coach_memory_lookup_idx
  ON public.coach_memory (workspace_id, memory_type, objection_tag, path_key);

CREATE INDEX IF NOT EXISTS n8n_workflow_drafts_updated_idx
  ON public.n8n_workflow_drafts (workspace_id, updated_at DESC);

DROP TRIGGER IF EXISTS research_sources_set_updated_at ON public.research_sources;
CREATE TRIGGER research_sources_set_updated_at
  BEFORE UPDATE ON public.research_sources
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS coach_memory_set_updated_at ON public.coach_memory;
CREATE TRIGGER coach_memory_set_updated_at
  BEFORE UPDATE ON public.coach_memory
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS n8n_workflow_drafts_set_updated_at ON public.n8n_workflow_drafts;
CREATE TRIGGER n8n_workflow_drafts_set_updated_at
  BEFORE UPDATE ON public.n8n_workflow_drafts
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON COLUMN public.unified_messages.storage_path IS 'Private Supabase Storage object path for call recordings or attachments.';
COMMENT ON TABLE public.research_sources IS 'Research agent source freshness and de-duplication ledger.';
COMMENT ON TABLE public.coach_memory IS 'Approved and pending tactical memories used by Ava during calls.';
COMMENT ON TABLE public.n8n_workflow_drafts IS 'Bridge-side workflow draft persistence with optional sync to n8n API.';
