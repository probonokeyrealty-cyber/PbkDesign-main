-- PBK Ava 2.0 inbound routing and hourly self-learning memory.
-- Additive only: safe to apply after the existing PBK bridge/brain schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'unified_messages'
  ) THEN
    ALTER TABLE public.unified_messages
      ADD COLUMN IF NOT EXISTS processed_for_learning BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS learning_processed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS learning_session_id TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS learning_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ava_learning_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  minutes_budget INTEGER NOT NULL DEFAULT 60,
  candidates_processed INTEGER NOT NULL DEFAULT 0,
  lessons_extracted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ava_active_memories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  memory_type TEXT NOT NULL DEFAULT 'ava-call-lesson',
  objection_tag TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  score NUMERIC NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'observed',
  source TEXT NOT NULL DEFAULT 'ava-self-learning',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inbound_call_routes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  call_control_id TEXT NOT NULL DEFAULT '',
  from_phone TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL DEFAULT '',
  lead_id TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT 'ava_qualify',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received',
  prompt_context TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'unified_messages'
  ) THEN
    CREATE INDEX IF NOT EXISTS unified_messages_learning_idx
      ON public.unified_messages (workspace_id, channel, processed_for_learning, created_at DESC)
      WHERE channel IN ('call', 'voice', 'recording');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ava_learning_sessions_workspace_idx
  ON public.ava_learning_sessions (workspace_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS ava_active_memories_lookup_idx
  ON public.ava_active_memories (workspace_id, objection_tag, score DESC);

CREATE INDEX IF NOT EXISTS inbound_call_routes_workspace_idx
  ON public.inbound_call_routes (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inbound_call_routes_call_control_idx
  ON public.inbound_call_routes (workspace_id, call_control_id)
  WHERE call_control_id <> '';

DROP TRIGGER IF EXISTS ava_learning_sessions_set_updated_at ON public.ava_learning_sessions;
CREATE TRIGGER ava_learning_sessions_set_updated_at
  BEFORE UPDATE ON public.ava_learning_sessions
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS ava_active_memories_set_updated_at ON public.ava_active_memories;
CREATE TRIGGER ava_active_memories_set_updated_at
  BEFORE UPDATE ON public.ava_active_memories
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS inbound_call_routes_set_updated_at ON public.inbound_call_routes;
CREATE TRIGGER inbound_call_routes_set_updated_at
  BEFORE UPDATE ON public.inbound_call_routes
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON TABLE public.ava_learning_sessions IS 'Hourly Ava self-learning runs that extract call lessons into coach memory.';
COMMENT ON TABLE public.ava_active_memories IS 'Fast active-memory cache for Ava inbound and live call prompts.';
COMMENT ON TABLE public.inbound_call_routes IS 'Inbound Telnyx routing ledger for Ava qualification, transfers, and after-hours voicemail.';
