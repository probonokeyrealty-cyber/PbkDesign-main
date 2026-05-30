CREATE TABLE IF NOT EXISTS public.event_dead_letters (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  event_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_dead_letters_type_idx
  ON public.event_dead_letters (tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS event_dead_letters_event_idx
  ON public.event_dead_letters (tenant_id, event_id);

ALTER TABLE public.event_dead_letters ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_dead_letters TO service_role;
  END IF;
END $$;
