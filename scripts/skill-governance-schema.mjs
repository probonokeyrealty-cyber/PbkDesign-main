export const SKILL_VERSION_STATES = Object.freeze([
  'candidate',
  'needs_review',
  'test_ready',
  'testing',
  'failed',
  'ready_for_approval',
  'approved_inactive',
  'canary',
  'active',
  'paused',
  'rolled_back',
  'retired',
]);

export const EXECUTABLE_SKILL_STATES = new Set(['canary', 'active']);
export const ACTIVE_ACTIVATION_STATES = new Set(['canary', 'active']);

export const SKILL_GOVERNANCE_SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS public.skill_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    owner_id TEXT NOT NULL DEFAULT '',
    risk_class TEXT NOT NULL DEFAULT 'medium'
      CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
    source TEXT NOT NULL DEFAULT 'operator',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    UNIQUE (workspace_id, slug)
  );

  CREATE TABLE IF NOT EXISTS public.skill_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    skill_definition_id UUID NOT NULL
      REFERENCES public.skill_definitions(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    lifecycle_state TEXT NOT NULL DEFAULT 'candidate'
      CHECK (lifecycle_state IN (
        'candidate', 'needs_review', 'test_ready', 'testing', 'failed',
        'ready_for_approval', 'approved_inactive', 'canary', 'active',
        'paused', 'rolled_back', 'retired'
      )),
    content_hash TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    trigger_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    source_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    safety_scan JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (skill_definition_id, version_number),
    UNIQUE (skill_definition_id, content_hash)
  );

  CREATE TABLE IF NOT EXISTS public.skill_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    subject_hash TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    approver_id TEXT NOT NULL,
    evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.agent_skill_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    agent_id TEXT NOT NULL,
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    scope JSONB NOT NULL DEFAULT '{"type":"global"}'::jsonb,
    priority INTEGER NOT NULL DEFAULT 100,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.skill_activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    subject_type TEXT NOT NULL CHECK (subject_type IN ('skill_version', 'chain_version')),
    subject_version_id UUID NOT NULL,
    environment TEXT NOT NULL DEFAULT 'production',
    rollout_mode TEXT NOT NULL DEFAULT 'canary'
      CHECK (rollout_mode IN ('canary', 'full')),
    rollout_percent INTEGER NOT NULL DEFAULT 10
      CHECK (rollout_percent BETWEEN 0 AND 100),
    status TEXT NOT NULL DEFAULT 'canary'
      CHECK (status IN ('canary', 'active', 'paused', 'rolled_back', 'retired')),
    rollback_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
    activated_by TEXT NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS public.skill_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS public.skill_projection_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL DEFAULT 'pbk',
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    authority_version BIGINT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    dedupe_key TEXT NOT NULL UNIQUE,
    payload_hash TEXT NOT NULL,
    payload JSONB NOT NULL,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    delivered_at TIMESTAMPTZ,
    dead_lettered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS skill_activations_one_live_subject_uidx
    ON public.skill_activations
      (workspace_id, subject_type, subject_version_id, environment)
    WHERE ended_at IS NULL AND status IN ('canary', 'active');
  CREATE INDEX IF NOT EXISTS skill_versions_lifecycle_idx
    ON public.skill_versions (workspace_id, lifecycle_state, created_at DESC);
  CREATE INDEX IF NOT EXISTS skill_assignments_agent_effective_idx
    ON public.agent_skill_assignments
      (workspace_id, agent_id, effective_from, effective_until);
  CREATE INDEX IF NOT EXISTS skill_projection_outbox_claim_idx
    ON public.skill_projection_outbox
      (available_at, lease_expires_at, created_at)
    WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;

  ALTER TABLE public.skill_definitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_versions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_approvals ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.agent_skill_assignments ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_activations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_audit_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.skill_projection_outbox ENABLE ROW LEVEL SECURITY;

  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON public.skill_definitions FROM anon;
      REVOKE ALL ON public.skill_versions FROM anon;
      REVOKE ALL ON public.skill_approvals FROM anon;
      REVOKE ALL ON public.agent_skill_assignments FROM anon;
      REVOKE ALL ON public.skill_activations FROM anon;
      REVOKE ALL ON public.skill_audit_events FROM anon;
      REVOKE ALL ON public.skill_projection_outbox FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON public.skill_definitions FROM authenticated;
      REVOKE ALL ON public.skill_versions FROM authenticated;
      REVOKE ALL ON public.skill_approvals FROM authenticated;
      REVOKE ALL ON public.agent_skill_assignments FROM authenticated;
      REVOKE ALL ON public.skill_activations FROM authenticated;
      REVOKE ALL ON public.skill_audit_events FROM authenticated;
      REVOKE ALL ON public.skill_projection_outbox FROM authenticated;
    END IF;
  END $$;
`;

export async function ensureSkillGovernanceSchema(pool) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  await pool.query(SKILL_GOVERNANCE_SCHEMA_SQL);
  return { ok: true, result: 'skill_governance_schema_ready' };
}
