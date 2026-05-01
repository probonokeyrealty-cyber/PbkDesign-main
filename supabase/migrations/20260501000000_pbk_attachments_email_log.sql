-- PBK attachment storage and outbound recording-email audit trail.
-- Additive only: safe to apply after the brain/workflow/recordings migration.

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
    VALUES ('attachments', 'attachments', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = FALSE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  lead_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_bucket TEXT NOT NULL DEFAULT 'attachments',
  storage_path TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'stored',
  extraction_status TEXT NOT NULL DEFAULT 'stored-only',
  extraction_parser TEXT NOT NULL DEFAULT '',
  extraction_error TEXT NOT NULL DEFAULT '',
  text_characters INTEGER NOT NULL DEFAULT 0,
  brain_doc_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  lead_name TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  email_type TEXT NOT NULL DEFAULT 'transactional',
  provider TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  live BOOLEAN NOT NULL DEFAULT FALSE,
  storage_path TEXT NOT NULL DEFAULT '',
  signed_url_expires_in INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attachments_lead_idx
  ON public.attachments (workspace_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attachments_storage_idx
  ON public.attachments (workspace_id, storage_bucket, storage_path);

CREATE INDEX IF NOT EXISTS email_log_lead_idx
  ON public.email_log (workspace_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_log_message_idx
  ON public.email_log (workspace_id, message_id, email_type);

DROP TRIGGER IF EXISTS attachments_set_updated_at ON public.attachments;
CREATE TRIGGER attachments_set_updated_at
  BEFORE UPDATE ON public.attachments
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS email_log_set_updated_at ON public.email_log;
CREATE TRIGGER email_log_set_updated_at
  BEFORE UPDATE ON public.email_log
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON TABLE public.attachments IS 'Private Supabase Storage attachment metadata with extraction status for Rex/Brain ingest.';
COMMENT ON TABLE public.email_log IS 'Outbound email audit ledger for recording shares, seller document sends, and follow-up packages.';
