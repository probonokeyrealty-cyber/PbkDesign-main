CREATE TABLE IF NOT EXISTS public.agent_registry (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'active',
  endpoint TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  health_checked_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_registry_capabilities_idx
  ON public.agent_registry USING gin (capabilities);

CREATE INDEX IF NOT EXISTS agent_registry_status_idx
  ON public.agent_registry (tenant_id, status, updated_at DESC);

ALTER TABLE public.agent_registry ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_registry TO service_role;
  END IF;
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

DROP TRIGGER IF EXISTS agent_registry_set_updated_at ON public.agent_registry;
CREATE TRIGGER agent_registry_set_updated_at
  BEFORE UPDATE ON public.agent_registry
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

INSERT INTO public.agent_registry (id, name, description, capabilities, status, endpoint, version, metadata)
VALUES
  ('ava', 'Ava', 'Primary PBK acquisition closer and voice supervisor.', ARRAY['voice','negotiation','closing','bant','path_locking','rag','memory_retrieval','turn_coordination'], 'active', '', 'v2.1', '{"orchestrationRole":"supervisor","supervises":["rex","hermes"],"local":true}'::jsonb),
  ('rex', 'Rex', 'PBK strategist, research, revenue alignment, and memory agent.', ARRAY['strategy','research','revenue_alignment','market_intel','rex_decisions','memory_synthesis'], 'active', '', 'v3.0', '{"orchestrationRole":"worker","supervisor":"ava","local":true}'::jsonb),
  ('hermes', 'Hermes', 'Suggest-only analyst lane for transcript, feedback, and pattern diagnosis.', ARRAY['analysis','suggestions','feedback_review','risk_review','pattern_detection'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"ava","suggestOnly":true,"local":true}'::jsonb),
  ('call-analyzer', 'Call Analyzer', 'Reviews Ava call transcripts, scores quality, tags failures, and proposes improvements.', ARRAY['analysis','post_call','quality_scoring','failure_tags','coaching'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"rex","local":true}'::jsonb),
  ('prosody-tuner', 'Prosody Tuner', 'Builds and evaluates Ava voice stability, speed, emotion, and prosody choices.', ARRAY['voice_tuning','prosody','emotion','ml','tts_quality'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"rex","local":true}'::jsonb),
  ('script-rotator', 'Script Rotator', 'Selects and rotates scripts, trust builders, objections, and war-manual lines.', ARRAY['script_management','objection_handling','trust_builders','war_manual','anti_repeat'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"ava","local":true}'::jsonb),
  ('bant-enforcer', 'BANT Enforcer', 'Tracks budget, authority, need, timeline, urgency, and call qualification completeness.', ARRAY['qualification','bant','goal_inference','clarifying_questions','path_locking'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"ava","local":true}'::jsonb),
  ('qa-agent', 'QA Agent', 'Validates tool outputs, audits provider proof, and escalates silent failures.', ARRAY['qa','tool_validation','audit','approval_escalation','reliability'], 'active', '', 'v1.0', '{"orchestrationRole":"worker","supervisor":"rex","local":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  capabilities = ARRAY(SELECT DISTINCT capability FROM unnest(public.agent_registry.capabilities || EXCLUDED.capabilities) AS capability),
  status = COALESCE(NULLIF(public.agent_registry.status, ''), EXCLUDED.status),
  version = COALESCE(NULLIF(public.agent_registry.version, ''), EXCLUDED.version),
  metadata = public.agent_registry.metadata || EXCLUDED.metadata,
  updated_at = NOW();
