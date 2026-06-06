CREATE TABLE IF NOT EXISTS public.provider_action_dispatches (
  approval_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  tool_name TEXT NOT NULL,
  binding_hash TEXT NOT NULL DEFAULT '',
  attempt_token UUID NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('dispatching', 'completed', 'reconciliation_required')
  ),
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  error TEXT NOT NULL DEFAULT '',
  dispatch_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reconciliation_required_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS provider_action_dispatches_workspace_status_idx
  ON public.provider_action_dispatches (workspace_id, status, updated_at DESC);

ALTER TABLE public.provider_action_dispatches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.provider_action_dispatches FROM anon;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.provider_action_dispatches FROM authenticated;
  END IF;
END $$;

COMMENT ON TABLE public.provider_action_dispatches IS
  'Server-only idempotency and reconciliation ledger for approval-gated provider actions.';
