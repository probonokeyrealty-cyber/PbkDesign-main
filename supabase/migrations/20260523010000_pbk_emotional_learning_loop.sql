-- PBK emotional learning loop.
-- Stores seller emotional tags, Ava response/prosody, outcomes, and promoted
-- winning emotional-response memories. The bridge writes through Postgres; if
-- this is later exposed through Supabase Data API, explicit grants below keep
-- access scoped to service_role only.

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

CREATE TABLE IF NOT EXISTS public.pbk_emotional_learning_interactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  seller_utterance TEXT NOT NULL DEFAULT '',
  inferred_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ava_response TEXT NOT NULL DEFAULT '',
  ava_prosody JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'observed',
  success_weight NUMERIC NOT NULL DEFAULT 0.5,
  tags_before JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags_after JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT 'pbk-bridge',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_emotional_learning_memory (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  tag_signature TEXT NOT NULL DEFAULT '',
  seller_utterance TEXT NOT NULL DEFAULT '',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  winning_response TEXT NOT NULL DEFAULT '',
  strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT NOT NULL DEFAULT 'observed',
  success_weight NUMERIC NOT NULL DEFAULT 0.5,
  source_interaction_id TEXT NOT NULL DEFAULT '',
  use_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_emotional_learning_interactions_lookup_idx
  ON public.pbk_emotional_learning_interactions (tenant_id, lead_id, call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_emotional_learning_interactions_outcome_idx
  ON public.pbk_emotional_learning_interactions (tenant_id, outcome, success_weight, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_emotional_learning_interactions_tags_idx
  ON public.pbk_emotional_learning_interactions USING gin (inferred_tags);

CREATE INDEX IF NOT EXISTS pbk_emotional_learning_memory_lookup_idx
  ON public.pbk_emotional_learning_memory (tenant_id, tag_signature, success_weight DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS pbk_emotional_learning_memory_tags_idx
  ON public.pbk_emotional_learning_memory USING gin (tags);

ALTER TABLE public.pbk_emotional_learning_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_emotional_learning_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_emotional_learning_interactions TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_emotional_learning_memory TO service_role;
  END IF;
END $$;

DROP TRIGGER IF EXISTS pbk_emotional_learning_interactions_set_updated_at ON public.pbk_emotional_learning_interactions;
CREATE TRIGGER pbk_emotional_learning_interactions_set_updated_at
  BEFORE UPDATE ON public.pbk_emotional_learning_interactions
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_emotional_learning_memory_set_updated_at ON public.pbk_emotional_learning_memory;
CREATE TRIGGER pbk_emotional_learning_memory_set_updated_at
  BEFORE UPDATE ON public.pbk_emotional_learning_memory
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

COMMENT ON TABLE public.pbk_emotional_learning_interactions IS
  'Outcome-weighted seller emotional tags, Ava responses, and prosody for closed-loop emotional learning.';

COMMENT ON TABLE public.pbk_emotional_learning_memory IS
  'Promoted winning emotional-response memories retrieved by Ava during similar seller objections.';
