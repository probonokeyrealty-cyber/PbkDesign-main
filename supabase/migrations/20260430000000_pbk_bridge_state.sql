-- PBK OpenClaw bridge state backend.
-- Render uses PBK_DATABASE_URL to persist the runtime state in Supabase/Postgres.

CREATE TABLE IF NOT EXISTS public.bridge_state (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bridge_state_updated_at_idx
  ON public.bridge_state (updated_at DESC);

COMMENT ON TABLE public.bridge_state IS
  'Singleton JSONB state store for PBK OpenClaw bridge runtime data.';

COMMENT ON COLUMN public.bridge_state.data IS
  'Hydrated PBK runtime state including approvals, messages, calls, contracts, document deliveries, and admin audit entries.';
