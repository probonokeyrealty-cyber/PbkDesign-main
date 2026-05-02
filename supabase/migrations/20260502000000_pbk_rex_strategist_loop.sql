-- PBK Rex Strategist closed-loop optimization.
-- Stores Rex proposals, approvals, applied changes, baselines, and measured outcomes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pbk_agent_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.rex_decisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source TEXT NOT NULL DEFAULT 'rex-strategist',
  tool TEXT NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::JSONB,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  target_type TEXT,
  target_id TEXT,
  approval_id TEXT,
  baseline JSONB NOT NULL DEFAULT '{}'::JSONB,
  outcome JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  success BOOLEAN,
  proposed_by TEXT,
  approved_by TEXT,
  applied_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.rex_decision_baselines (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  decision_id TEXT NOT NULL REFERENCES public.rex_decisions(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rex_decisions_status_created ON public.rex_decisions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rex_decisions_tool ON public.rex_decisions(tool);
CREATE INDEX IF NOT EXISTS idx_rex_decisions_target ON public.rex_decisions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_rex_decisions_approval_id ON public.rex_decisions(approval_id)
  WHERE approval_id IS NOT NULL AND approval_id <> '';
CREATE INDEX IF NOT EXISTS idx_rex_decisions_pending_evaluation ON public.rex_decisions(applied_at)
  WHERE success IS NULL AND applied_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rex_decision_baselines_decision_id ON public.rex_decision_baselines(decision_id);
