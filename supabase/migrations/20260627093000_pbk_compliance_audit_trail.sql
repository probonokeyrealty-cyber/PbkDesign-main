CREATE TABLE IF NOT EXISTS public.compliance_audit_events (
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  approval_id TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT '',
  required_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_status TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_result TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS compliance_audit_events_workspace_created_idx
  ON public.compliance_audit_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS compliance_audit_events_workspace_lead_created_idx
  ON public.compliance_audit_events (workspace_id, lead_id, created_at DESC);

ALTER TABLE public.compliance_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.compliance_audit_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.compliance_audit_events FROM authenticated;
  END IF;
END $$;
