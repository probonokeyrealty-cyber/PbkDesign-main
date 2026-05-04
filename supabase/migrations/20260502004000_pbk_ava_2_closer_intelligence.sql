-- Ava 2.0 closer intelligence: BANT+, call context, persona evolution, stories.

CREATE SCHEMA IF NOT EXISTS pbk_agent;

ALTER TABLE IF EXISTS public.lead_profiles
  ADD COLUMN IF NOT EXISTS bant JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS call_context JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    ALTER TABLE public.leads
      ADD COLUMN IF NOT EXISTS bant JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS call_context JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  agent_name TEXT NOT NULL,
  parent_agent TEXT NOT NULL DEFAULT 'ava-closer-v2',
  persona JSONB NOT NULL DEFAULT '{}'::jsonb,
  archetype TEXT,
  region TEXT,
  likability_score NUMERIC(4,1),
  outcome_score NUMERIC(5,2),
  status TEXT NOT NULL DEFAULT 'candidate',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_workspace_status
  ON public.agent_versions (workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_versions_likability
  ON public.agent_versions (likability_score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS pbk_agent.ava_stories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  topic TEXT NOT NULL,
  market TEXT,
  trigger_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  story_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'pbk',
  source_url TEXT,
  score NUMERIC(5,2) NOT NULL DEFAULT 0.75,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ava_stories_workspace_topic
  ON pbk_agent.ava_stories (workspace_id, topic, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ava_stories_keywords
  ON pbk_agent.ava_stories USING GIN (trigger_keywords);

INSERT INTO pbk_agent.ava_stories (
  id, topic, market, trigger_keywords, story_text, source, score
) VALUES
  (
    'ava-story-repairs-columbus',
    'repairs',
    'Columbus',
    ARRAY['roof','furnace','repairs','condition'],
    'I remember a Columbus seller who felt buried by roof and furnace repairs. We kept the process simple, bought as-is, and they were able to move without managing contractors.',
    'pbk-default',
    0.82
  ),
  (
    'ava-story-probate-akron',
    'probate',
    'Akron',
    ARRAY['probate','estate','executor','family'],
    'Just last month, an Akron family wanted dignity and speed more than a complicated listing. We slowed the conversation down, explained every step, and made the close feel manageable.',
    'pbk-default',
    0.85
  ),
  (
    'ava-story-timing-cleveland',
    'timeline',
    'Cleveland',
    ARRAY['quick','deadline','foreclosure','taxes','vacant'],
    'I have seen Cleveland sellers choose certainty because every extra month meant taxes, utilities, and stress. A clean date mattered as much as the number.',
    'pbk-default',
    0.80
  )
ON CONFLICT (id) DO UPDATE SET
  topic = EXCLUDED.topic,
  market = EXCLUDED.market,
  trigger_keywords = EXCLUDED.trigger_keywords,
  story_text = EXCLUDED.story_text,
  source = EXCLUDED.source,
  score = EXCLUDED.score,
  updated_at = NOW();
