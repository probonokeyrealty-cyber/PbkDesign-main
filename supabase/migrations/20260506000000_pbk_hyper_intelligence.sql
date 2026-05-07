-- PBK Hyper Intelligence substrate.
-- Additive only: stores memory, feedback, real-time intent events, and
-- lightweight knowledge graph facts without changing provider execution.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN insufficient_privilege OR undefined_file THEN
    RAISE NOTICE 'pgvector is not available in this database; PBK memory will use text/metadata fallback.';
END $$;

CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pbk_memories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  memory_type TEXT NOT NULL DEFAULT 'episodic',
  content TEXT NOT NULL DEFAULT '',
  importance NUMERIC NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'bridge',
  source_id TEXT NOT NULL DEFAULT '',
  embedding JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_memories
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS lead_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS agent_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'episodic',
  ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS importance NUMERIC NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'bridge',
  ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS embedding JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.pbk_feedback (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT '',
  agent_action TEXT NOT NULL DEFAULT '',
  human_decision TEXT NOT NULL DEFAULT '',
  transcript_snippet TEXT NOT NULL DEFAULT '',
  outcome_label TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_intent_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  transcript_snippet TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT 'neutral',
  confidence NUMERIC NOT NULL DEFAULT 0,
  recommended_action TEXT NOT NULL DEFAULT 'continue_conversation',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_knowledge (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  subject TEXT NOT NULL DEFAULT '',
  predicate TEXT NOT NULL DEFAULT '',
  object TEXT NOT NULL DEFAULT '',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'bridge',
  source_id TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_memories_tenant_lead_idx
  ON public.pbk_memories (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_memories_type_idx
  ON public.pbk_memories (tenant_id, memory_type, importance DESC);

CREATE INDEX IF NOT EXISTS pbk_memories_content_idx
  ON public.pbk_memories
  USING gin (to_tsvector('english', content));

CREATE INDEX IF NOT EXISTS pbk_memories_metadata_idx
  ON public.pbk_memories USING gin (metadata);

CREATE INDEX IF NOT EXISTS pbk_feedback_lead_idx
  ON public.pbk_feedback (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_feedback_decision_idx
  ON public.pbk_feedback (tenant_id, human_decision, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_intent_events_lead_idx
  ON public.pbk_intent_events (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_intent_events_intent_idx
  ON public.pbk_intent_events (tenant_id, intent, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_knowledge_lookup_idx
  ON public.pbk_knowledge (tenant_id, subject, predicate);

CREATE INDEX IF NOT EXISTS pbk_knowledge_object_idx
  ON public.pbk_knowledge (tenant_id, object);

CREATE INDEX IF NOT EXISTS pbk_knowledge_metadata_idx
  ON public.pbk_knowledge USING gin (metadata);

DROP TRIGGER IF EXISTS pbk_memories_set_updated_at ON public.pbk_memories;
CREATE TRIGGER pbk_memories_set_updated_at
  BEFORE UPDATE ON public.pbk_memories
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_knowledge_set_updated_at ON public.pbk_knowledge;
CREATE TRIGGER pbk_knowledge_set_updated_at
  BEFORE UPDATE ON public.pbk_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DELETE FROM public.pbk_knowledge
WHERE id = 'pbk-knowledge-ava-creator-charles'
   OR (tenant_id = 'pbk' AND subject = 'Ava' AND predicate = 'creator' AND object = 'Charles');

INSERT INTO public.pbk_knowledge (
  id, tenant_id, subject, predicate, object, confidence, source, source_id, metadata, created_at, updated_at
)
VALUES (
  'pbk-knowledge-ava-creator-pbk',
  'pbk',
  'Ava',
  'creator',
  'PBK',
  1,
  'pbk-immutable-seed',
  'founder-origin',
  '{"immutable":true,"safety":"identity_anchor"}'::jsonb,
  NOW(),
  NOW()
), (
  'pbk-knowledge-ava-truthful-ai-disclosure',
  'pbk',
  'Ava',
  'ai_identity_protocol',
  'Always disclose truthfully when asked: Ava is PBK AI assistance, offers and actions are real and human-approved, and a human handoff is available.',
  1,
  'pbk-immutable-seed',
  'human-communication-protocol',
  '{"immutable":true,"safety":"truthful_ai_disclosure"}'::jsonb,
  NOW(),
  NOW()
), (
  'pbk-knowledge-ava-humor-policy',
  'pbk',
  'Ava',
  'humor_policy',
  'Use one brief affiliative or self-aware joke only when the seller is curious or playful; never joke during grief, anger, fear, or scam concerns.',
  1,
  'pbk-immutable-seed',
  'human-communication-protocol',
  '{"immutable":true,"safety":"humor_guardrails"}'::jsonb,
  NOW(),
  NOW()
), (
  'pbk-knowledge-ava-grief-policy',
  'pbk',
  'Ava',
  'grief_policy',
  'When a seller is grieving, overwhelmed, or handling an estate, slow down, validate the weight of the situation, avoid humor, and offer one simple burden-relief next step.',
  1,
  'pbk-immutable-seed',
  'human-communication-protocol',
  '{"immutable":true,"safety":"grief_empathy"}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  subject = EXCLUDED.subject,
  predicate = EXCLUDED.predicate,
  object = EXCLUDED.object,
  confidence = EXCLUDED.confidence,
  source = EXCLUDED.source,
  source_id = EXCLUDED.source_id,
  metadata = public.pbk_knowledge.metadata || EXCLUDED.metadata,
  updated_at = NOW();
