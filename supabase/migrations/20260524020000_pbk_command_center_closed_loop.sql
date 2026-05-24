-- PBK Command Center closed-loop activation tables.
-- Stores Rex call-analysis sub-agent output, revenue-goal alignment actions,
-- and activation records while keeping provider writes approval-gated.

CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pbk_call_analyses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  call_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT 'ava',
  score NUMERIC NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT '',
  failure_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  prosody_suggestions JSONB NOT NULL DEFAULT '{}'::jsonb,
  script_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'analyzed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_call_analyses
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS call_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'ava',
  ADD COLUMN IF NOT EXISTS score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grade TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS failure_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prosody_suggestions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS script_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tool_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'analyzed',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.pbk_revenue_actions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  action_id TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL DEFAULT 'rex_alignment',
  label TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_review',
  risk_level TEXT NOT NULL DEFAULT 'low',
  source TEXT NOT NULL DEFAULT 'rex',
  reason TEXT NOT NULL DEFAULT '',
  expected_impact TEXT NOT NULL DEFAULT '',
  recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_writes_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_revenue_actions
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS action_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'rex_alignment',
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'rex',
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS expected_impact TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS recommendation JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_writes_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.pbk_command_center_activations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  activated_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  target_monthly_revenue NUMERIC NOT NULL DEFAULT 1000000,
  target_annual_revenue NUMERIC NOT NULL DEFAULT 12000000,
  low_risk_autopilot BOOLEAN NOT NULL DEFAULT TRUE,
  provider_writes_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  loops JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_command_center_activations
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS activated_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS target_monthly_revenue NUMERIC NOT NULL DEFAULT 1000000,
  ADD COLUMN IF NOT EXISTS target_annual_revenue NUMERIC NOT NULL DEFAULT 12000000,
  ADD COLUMN IF NOT EXISTS low_risk_autopilot BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS provider_writes_blocked BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS loops JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS results JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS pbk_call_analyses_call_idx
  ON public.pbk_call_analyses (tenant_id, call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_call_analyses_score_idx
  ON public.pbk_call_analyses (tenant_id, score, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_call_analyses_failure_idx
  ON public.pbk_call_analyses USING gin (failure_tags);

CREATE INDEX IF NOT EXISTS pbk_revenue_actions_status_idx
  ON public.pbk_revenue_actions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_revenue_actions_type_idx
  ON public.pbk_revenue_actions (tenant_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_command_center_activations_status_idx
  ON public.pbk_command_center_activations (tenant_id, status, created_at DESC);

ALTER TABLE public.pbk_call_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_revenue_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_command_center_activations ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS pbk_call_analyses_set_updated_at ON public.pbk_call_analyses;
CREATE TRIGGER pbk_call_analyses_set_updated_at
  BEFORE UPDATE ON public.pbk_call_analyses
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_revenue_actions_set_updated_at ON public.pbk_revenue_actions;
CREATE TRIGGER pbk_revenue_actions_set_updated_at
  BEFORE UPDATE ON public.pbk_revenue_actions
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_command_center_activations_set_updated_at ON public.pbk_command_center_activations;
CREATE TRIGGER pbk_command_center_activations_set_updated_at
  BEFORE UPDATE ON public.pbk_command_center_activations
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_call_analyses TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_revenue_actions TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_command_center_activations TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.pbk_call_analyses IS 'Rex call-analysis sub-agent labels for Ava failures, evidence, and coaching.';
COMMENT ON TABLE public.pbk_revenue_actions IS 'Rex revenue-goal alignment actions toward PBK monthly revenue targets.';
COMMENT ON TABLE public.pbk_command_center_activations IS 'Audit records for closed-loop Command Center activation runs.';
