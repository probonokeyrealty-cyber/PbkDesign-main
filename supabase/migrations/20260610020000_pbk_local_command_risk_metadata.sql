-- PBK local command trust metadata.
-- Binds operator approval to immutable command contents and keeps the
-- read-only auto-run lane narrow enough for production desktop control.

ALTER TABLE public.pbk_local_commands
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS risk_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS classification_version TEXT NOT NULL DEFAULT 'local-command-risk-v1',
  ADD COLUMN IF NOT EXISTS command_digest TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_digest TEXT NOT NULL DEFAULT '';

ALTER TABLE public.pbk_local_commands
  DROP CONSTRAINT IF EXISTS pbk_local_commands_risk_level_check;

ALTER TABLE public.pbk_local_commands
  ADD CONSTRAINT pbk_local_commands_risk_level_check
  CHECK (risk_level IN ('low', 'medium', 'high'));

CREATE INDEX IF NOT EXISTS pbk_local_commands_risk_idx
  ON public.pbk_local_commands (tenant_id, risk_level, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_local_commands_digest_idx
  ON public.pbk_local_commands (tenant_id, command_digest);

COMMENT ON COLUMN public.pbk_local_commands.risk_level IS
  'Server-owned local command risk tier: only low may auto-dispatch without approval.';

COMMENT ON COLUMN public.pbk_local_commands.command_digest IS
  'SHA-256 digest of immutable command/action/params used to bind approval decisions.';
