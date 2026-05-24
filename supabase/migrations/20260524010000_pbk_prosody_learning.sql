-- PBK Ava prosody learning loop.
-- Stores each voice/prosody decision, records real outcomes, and tracks the active
-- lightweight success-average model Rex can use before ONNX data volume exists.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pbk_prosody_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  call_id TEXT DEFAULT '',
  lead_id TEXT DEFAULT '',
  utterance_id TEXT DEFAULT '',
  source TEXT DEFAULT 'ava-tts',
  text_preview TEXT DEFAULT '',
  emotion TEXT NOT NULL DEFAULT 'neutral',
  intensity DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  turn_count INTEGER NOT NULL DEFAULT 0,
  seller_sentiment DOUBLE PRECISION,
  last_objection_seconds_ago DOUBLE PRECISION,
  stability_chosen DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  speed_chosen DOUBLE PRECISION NOT NULL DEFAULT 1,
  similarity_boost_chosen DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  tags_chosen JSONB NOT NULL DEFAULT '[]'::jsonb,
  text_controls JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_id TEXT DEFAULT '',
  voice_id TEXT DEFAULT '',
  outcome_success BOOLEAN,
  outcome_label TEXT NOT NULL DEFAULT 'pending',
  reward DOUBLE PRECISION,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_prosody_decisions
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS call_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS utterance_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ava-tts',
  ADD COLUMN IF NOT EXISTS text_preview TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS emotion TEXT NOT NULL DEFAULT 'neutral',
  ADD COLUMN IF NOT EXISTS intensity DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_sentiment DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_objection_seconds_ago DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stability_chosen DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS speed_chosen DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS similarity_boost_chosen DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS tags_chosen JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS text_controls JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_id TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS outcome_success BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome_label TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reward DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.pbk_prosody_models (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  version BIGINT NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'rule_success_average',
  model_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  onnx_url TEXT DEFAULT '',
  sample_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  accuracy DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'trained',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_prosody_models
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_type TEXT NOT NULL DEFAULT 'rule_success_average',
  ADD COLUMN IF NOT EXISTS model_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS onnx_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS sample_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trained',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.pbk_prosody_models
  ALTER COLUMN version TYPE BIGINT USING version::bigint;

CREATE INDEX IF NOT EXISTS pbk_prosody_decisions_call_idx
  ON public.pbk_prosody_decisions (tenant_id, call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_prosody_decisions_outcome_idx
  ON public.pbk_prosody_decisions (tenant_id, outcome_success, outcome_label, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_prosody_decisions_emotion_idx
  ON public.pbk_prosody_decisions (tenant_id, emotion, intensity, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_prosody_decisions_tags_idx
  ON public.pbk_prosody_decisions USING gin (tags_chosen);

CREATE INDEX IF NOT EXISTS pbk_prosody_models_active_idx
  ON public.pbk_prosody_models (tenant_id, active, trained_at DESC);

DROP TRIGGER IF EXISTS pbk_prosody_decisions_set_updated_at ON public.pbk_prosody_decisions;
CREATE TRIGGER pbk_prosody_decisions_set_updated_at
  BEFORE UPDATE ON public.pbk_prosody_decisions
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_prosody_models_set_updated_at ON public.pbk_prosody_models;
CREATE TRIGGER pbk_prosody_models_set_updated_at
  BEFORE UPDATE ON public.pbk_prosody_models
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

ALTER TABLE public.pbk_prosody_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_prosody_models ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_prosody_decisions TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_prosody_models TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.pbk_prosody_decisions IS 'Ava TTS/prosody decisions with outcomes for adaptive voice learning.';
COMMENT ON TABLE public.pbk_prosody_models IS 'Active lightweight or ONNX prosody models learned from successful calls.';
