CREATE TABLE IF NOT EXISTS public.pbk_tool_usage (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT 'Ava',
  tool_name TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT '',
  success BOOLEAN,
  latency_ms INT,
  error_message TEXT NOT NULL DEFAULT '',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_tool_usage_tool_idx
  ON public.pbk_tool_usage (tenant_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_tool_usage_lead_idx
  ON public.pbk_tool_usage (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_tool_usage_context_idx
  ON public.pbk_tool_usage USING gin (context);

ALTER TABLE public.pbk_tool_usage ENABLE ROW LEVEL SECURITY;
