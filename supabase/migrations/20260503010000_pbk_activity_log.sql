-- Durable activity feed for lead-scoped CRM, document, call, and approval events.
-- This is intentionally additive and keeps bridge_state as the local/offline source of truth.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT,
  lead_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'System',
  category TEXT NOT NULL DEFAULT 'INFO',
  status TEXT NOT NULL DEFAULT 'success',
  text TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'runtime',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_lead_created_idx
  ON public.activity_log (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_workspace_category_idx
  ON public.activity_log (workspace_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_workspace_status_idx
  ON public.activity_log (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_metadata_gin_idx
  ON public.activity_log USING GIN (metadata);

DROP TRIGGER IF EXISTS activity_log_set_updated_at ON public.activity_log;
CREATE TRIGGER activity_log_set_updated_at
  BEFORE UPDATE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON TABLE public.activity_log IS 'Durable PBK activity feed for lead-scoped CRM, PDF, email, call, DocuSign, and approval events.';
