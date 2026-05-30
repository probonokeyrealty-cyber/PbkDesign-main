-- Phase 3/4: Autonomous Rex + context-aware script rotation metrics.

ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deal_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_selected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_outcome_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS scripts_context_rotation_idx
  ON public.scripts (workspace_id, path_key, active, conversion_count DESC, usage_count DESC);

CREATE TABLE IF NOT EXISTS public.pbk_rex_autonomy_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  run_type TEXT NOT NULL DEFAULT 'goal_discovery',
  kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'complete',
  source TEXT NOT NULL DEFAULT 'rex-autonomy',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_rex_autonomy_runs_lookup_idx
  ON public.pbk_rex_autonomy_runs (tenant_id, run_type, created_at DESC);

ALTER TABLE public.pbk_rex_autonomy_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pbk_rex_autonomy_runs'
      AND policyname = 'pbk_rex_autonomy_runs_service_role_all'
  ) THEN
    CREATE POLICY pbk_rex_autonomy_runs_service_role_all
      ON public.pbk_rex_autonomy_runs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

UPDATE public.agent_registry
SET
  description = 'PBK strategist, research, autonomous goals, proactive triggers, revenue alignment, and memory agent.',
  capabilities = ARRAY(
    SELECT DISTINCT capability
    FROM unnest(capabilities || ARRAY['autonomous_goal_setting','proactive_triggers']) AS capability
  ),
  updated_at = NOW()
WHERE id = 'rex';

UPDATE public.agent_registry
SET
  description = 'Selects and rotates scripts, trust builders, objections, and war-manual lines using sentiment, objection history, and measured outcomes.',
  capabilities = ARRAY(
    SELECT DISTINCT capability
    FROM unnest(capabilities || ARRAY['context_aware_rotation','ab_testing']) AS capability
  ),
  updated_at = NOW()
WHERE id = 'script-rotator';
