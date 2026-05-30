CREATE TABLE IF NOT EXISTS public.pbk_qa_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  tool_name TEXT NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  skipped BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  validator TEXT NOT NULL DEFAULT '',
  retry_count INT NOT NULL DEFAULT 0,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  qa JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_qa_audit_tool_idx
  ON public.pbk_qa_audit (tenant_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_qa_audit_failed_idx
  ON public.pbk_qa_audit (tenant_id, passed, skipped, created_at DESC);

ALTER TABLE public.pbk_qa_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_qa_audit TO service_role;
  END IF;
END $$;
