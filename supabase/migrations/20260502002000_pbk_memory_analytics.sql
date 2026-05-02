-- PBK Memory & Analytics foundations.
-- These tables let agents publish self-created skills and measurable outcomes
-- without coupling the UI to hardcoded demo cards.

CREATE TABLE IF NOT EXISTS public.skills (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  agent_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'self-learned',
  level TEXT NOT NULL DEFAULT 'candidate',
  status TEXT NOT NULL DEFAULT 'active',
  confidence NUMERIC NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, agent_id, name)
);

CREATE TABLE IF NOT EXISTS public.skill_usage (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  skill_id TEXT REFERENCES public.skills(id) ON DELETE SET NULL,
  skill_name TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT 'unknown',
  success BOOLEAN,
  confidence NUMERIC,
  profit_margin NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS skills_workspace_agent_idx
  ON public.skills (workspace_id, agent_id, status);

CREATE INDEX IF NOT EXISTS skills_workspace_confidence_idx
  ON public.skills (workspace_id, confidence DESC);

CREATE INDEX IF NOT EXISTS skill_usage_workspace_agent_idx
  ON public.skill_usage (workspace_id, agent_id, used_at DESC);

CREATE INDEX IF NOT EXISTS skill_usage_skill_idx
  ON public.skill_usage (skill_id, used_at DESC);

CREATE INDEX IF NOT EXISTS skill_usage_success_idx
  ON public.skill_usage (workspace_id, success, used_at DESC);

DROP TRIGGER IF EXISTS skills_set_updated_at ON public.skills;
CREATE TRIGGER skills_set_updated_at
BEFORE UPDATE ON public.skills
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();
