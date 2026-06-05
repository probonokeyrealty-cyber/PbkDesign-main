-- PBK local command queue for Ava Chat -> OpenClaw/ClickUI desktop execution.
-- Commands are written by the bridge with service credentials, approval-gated,
-- then consumed by the local OpenClaw/ClickUI worker through bridge endpoints.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pbk_local_commands (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  command TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'operator_command',
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'ava-chat',
  status TEXT NOT NULL DEFAULT 'pending_approval',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  approval_id TEXT NOT NULL DEFAULT '',
  sidecar_id TEXT NOT NULL DEFAULT '',
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_local_commands
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS command TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'operator_command',
  ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS requested_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ava-chat',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_approval',
  ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approval_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sidecar_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.pbk_local_commands ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS pbk_local_commands_status_idx
  ON public.pbk_local_commands (tenant_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS pbk_local_commands_approval_idx
  ON public.pbk_local_commands (tenant_id, approval_id);

CREATE INDEX IF NOT EXISTS pbk_local_commands_source_idx
  ON public.pbk_local_commands (tenant_id, source, created_at DESC);

COMMENT ON TABLE public.pbk_local_commands IS
  'Approval-gated Ava Chat local command queue consumed by OpenClaw/ClickUI workers.';
