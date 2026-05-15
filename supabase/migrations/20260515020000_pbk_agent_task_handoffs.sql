CREATE TABLE IF NOT EXISTS public.pbk_tasks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  from_agent TEXT NOT NULL DEFAULT '',
  to_agent TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT 'handoff',
  status TEXT NOT NULL DEFAULT 'complete',
  summary TEXT NOT NULL DEFAULT '',
  correlation_id TEXT NOT NULL DEFAULT '',
  provider_writes TEXT NOT NULL DEFAULT 'blocked',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_tasks_lookup_idx
  ON public.pbk_tasks (tenant_id, to_agent, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_tasks_correlation_idx
  ON public.pbk_tasks (tenant_id, correlation_id);

CREATE INDEX IF NOT EXISTS pbk_tasks_metadata_idx
  ON public.pbk_tasks USING gin (metadata);

ALTER TABLE public.pbk_tasks ENABLE ROW LEVEL SECURITY;
