-- Ava quality gates: script tests, outcome reports, suggestions, and knowledge verification.

CREATE TABLE IF NOT EXISTS public.pbk_script_tests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  objection_type TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  success_metric TEXT NOT NULL DEFAULT 'close_rate',
  sample_size_target INTEGER NOT NULL DEFAULT 50,
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_script_test_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  test_id TEXT NOT NULL DEFAULT '',
  variant_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'exposure',
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  outcome_label TEXT NOT NULL DEFAULT '',
  success BOOLEAN,
  deal_value NUMERIC NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_outcome_reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  period_days INTEGER NOT NULL DEFAULT 7,
  summary TEXT NOT NULL DEFAULT '',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_improvement_suggestions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  title TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'proposed',
  evidence TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  success_metric TEXT NOT NULL DEFAULT '',
  rollback_condition TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_knowledge_verifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  subject TEXT NOT NULL DEFAULT '',
  predicate TEXT NOT NULL DEFAULT '',
  object TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT 'needs_review',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_fact_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_script_tests_lookup_idx
  ON public.pbk_script_tests (tenant_id, objection_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_script_test_events_lookup_idx
  ON public.pbk_script_test_events (tenant_id, test_id, variant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_script_test_events_outcome_idx
  ON public.pbk_script_test_events (tenant_id, outcome_label, success, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_outcome_reports_created_idx
  ON public.pbk_outcome_reports (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_improvement_suggestions_status_idx
  ON public.pbk_improvement_suggestions (tenant_id, status, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_knowledge_verifications_lookup_idx
  ON public.pbk_knowledge_verifications (tenant_id, verdict, risk_level, created_at DESC);

