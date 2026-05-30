-- Mission-resilience layer: GOOD goal trajectories, declarative action
-- reconciliation, selective memory curation, and MASEval-style runs.

CREATE TABLE IF NOT EXISTS public.pbk_goal_trajectories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  call_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'goal_inference_updated',
  utterance TEXT NOT NULL DEFAULT '',
  beliefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_goal_trajectories_lookup_idx
  ON public.pbk_goal_trajectories (tenant_id, lead_id, call_id, created_at DESC);

ALTER TABLE public.pbk_goal_trajectories ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_action_intents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  lead_id TEXT NOT NULL DEFAULT '',
  desired_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_observed_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_reconcile',
  attempts INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pbk_action_intents_idempotency_idx
  ON public.pbk_action_intents (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS pbk_action_intents_lookup_idx
  ON public.pbk_action_intents (tenant_id, tool_name, lead_id, status, created_at DESC);

ALTER TABLE public.pbk_action_intents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_memory_curation_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  delete_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_memory_curation_events_lookup_idx
  ON public.pbk_memory_curation_events (tenant_id, created_at DESC);

ALTER TABLE public.pbk_memory_curation_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.pbk_mission_resilience_eval_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  score INT NOT NULL DEFAULT 0,
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage JSONB NOT NULL DEFAULT '[]'::jsonb,
  assertions JSONB NOT NULL DEFAULT '[]'::jsonb,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_mission_resilience_eval_runs_lookup_idx
  ON public.pbk_mission_resilience_eval_runs (tenant_id, ok, created_at DESC);

ALTER TABLE public.pbk_mission_resilience_eval_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_goal_trajectories TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_action_intents TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_memory_curation_events TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_mission_resilience_eval_runs TO service_role;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pbk_goal_trajectories' AND policyname = 'pbk_goal_trajectories_service_role_all'
  ) THEN
    CREATE POLICY pbk_goal_trajectories_service_role_all ON public.pbk_goal_trajectories FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pbk_action_intents' AND policyname = 'pbk_action_intents_service_role_all'
  ) THEN
    CREATE POLICY pbk_action_intents_service_role_all ON public.pbk_action_intents FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pbk_memory_curation_events' AND policyname = 'pbk_memory_curation_events_service_role_all'
  ) THEN
    CREATE POLICY pbk_memory_curation_events_service_role_all ON public.pbk_memory_curation_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pbk_mission_resilience_eval_runs' AND policyname = 'pbk_mission_resilience_eval_runs_service_role_all'
  ) THEN
    CREATE POLICY pbk_mission_resilience_eval_runs_service_role_all ON public.pbk_mission_resilience_eval_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
