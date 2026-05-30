-- MIT-grade evaluation and safety audit layer.

CREATE TABLE IF NOT EXISTS public.pbk_safety_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  tool_name TEXT NOT NULL,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_safety_audit_lookup_idx
  ON public.pbk_safety_audit (tenant_id, tool_name, blocked, created_at DESC);

ALTER TABLE public.pbk_safety_audit ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_eval_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  suite_name TEXT NOT NULL DEFAULT 'ava_canonical',
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  total INT NOT NULL DEFAULT 0,
  passed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_eval_runs_lookup_idx
  ON public.pbk_eval_runs (tenant_id, suite_name, created_at DESC);

ALTER TABLE public.pbk_eval_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_safety_audit TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_eval_runs TO service_role;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pbk_safety_audit'
      AND policyname = 'pbk_safety_audit_service_role_all'
  ) THEN
    CREATE POLICY pbk_safety_audit_service_role_all
      ON public.pbk_safety_audit
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pbk_eval_runs'
      AND policyname = 'pbk_eval_runs_service_role_all'
  ) THEN
    CREATE POLICY pbk_eval_runs_service_role_all
      ON public.pbk_eval_runs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
