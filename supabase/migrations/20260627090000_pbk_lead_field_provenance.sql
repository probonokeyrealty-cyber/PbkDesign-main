CREATE TABLE IF NOT EXISTS public.lead_field_provenance (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value JSONB NOT NULL,
  source_channel TEXT NOT NULL,
  source_id TEXT NOT NULL DEFAULT '',
  source_excerpt TEXT NOT NULL DEFAULT '',
  confidence NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'ava',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_field_provenance_lead_field_idx
  ON public.lead_field_provenance (workspace_id, lead_id, field_name, created_at DESC);

ALTER TABLE public.lead_field_provenance ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.lead_field_provenance FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.lead_field_provenance FROM authenticated;
  END IF;
END $$;
