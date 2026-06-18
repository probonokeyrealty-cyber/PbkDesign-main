CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assigned_agent TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  last_event_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  unread_count INTEGER NOT NULL DEFAULT 0,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  spam_reported_at TIMESTAMPTZ,
  merged_into_thread_id UUID REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_thread_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  thread_id UUID NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('phone', 'email')),
  normalized_value TEXT NOT NULL,
  display_value TEXT NOT NULL DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'bridge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.communication_sender_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  provider TEXT NOT NULL,
  provider_identity_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'call')),
  address TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  lifecycle_status TEXT NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN (
      'active', 'warming', 'paused', 'quarantined',
      'retired', 'release_pending', 'released'
    )),
  health_status TEXT NOT NULL DEFAULT 'unknown',
  health_score NUMERIC,
  is_workspace_default BOOLEAN NOT NULL DEFAULT FALSE,
  inbound_grace_until TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  thread_id UUID NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'system',
  direction TEXT NOT NULL DEFAULT 'internal',
  source_table TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  sender_identity_id UUID REFERENCES public.communication_sender_identities(id)
    ON DELETE SET NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  hidden_at TIMESTAMPTZ,
  spam_reported_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_threads_workspace_lead_uidx
  ON public.conversation_threads (workspace_id, lead_id)
  WHERE lead_id IS NOT NULL AND merged_into_thread_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conversation_thread_identity_uidx
  ON public.conversation_thread_identities
    (workspace_id, identity_type, normalized_value, thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS sender_identity_provider_address_uidx
  ON public.communication_sender_identities
    (workspace_id, provider, channel, normalized_address);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_events_source_uidx
  ON public.conversation_events (workspace_id, source_table, source_id, event_type)
  WHERE source_table <> '' AND source_id <> '';
CREATE INDEX IF NOT EXISTS conversation_events_thread_occurred_idx
  ON public.conversation_events (thread_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS conversation_threads_activity_idx
  ON public.conversation_threads (workspace_id, archived_at, last_event_at DESC);
CREATE INDEX IF NOT EXISTS conversation_threads_lead_activity_idx
  ON public.conversation_threads (lead_id, last_event_at DESC)
  WHERE lead_id IS NOT NULL AND merged_into_thread_id IS NULL;
CREATE INDEX IF NOT EXISTS conversation_identity_lookup_idx
  ON public.conversation_thread_identities
    (workspace_id, identity_type, normalized_value);
CREATE INDEX IF NOT EXISTS conversation_identity_lead_lookup_idx
  ON public.conversation_thread_identities (lead_id, identity_type, normalized_value)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_events_lead_occurred_idx
  ON public.conversation_events (lead_id, occurred_at DESC, id DESC)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_events_workspace_channel_occurred_idx
  ON public.conversation_events (workspace_id, channel, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sender_identity_channel_status_idx
  ON public.communication_sender_identities
    (workspace_id, channel, lifecycle_status, health_status, updated_at DESC);

ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_thread_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_sender_identities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.conversation_threads FROM anon;
    REVOKE ALL ON public.conversation_thread_identities FROM anon;
    REVOKE ALL ON public.conversation_events FROM anon;
    REVOKE ALL ON public.communication_sender_identities FROM anon;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.conversation_threads FROM authenticated;
    REVOKE ALL ON public.conversation_thread_identities FROM authenticated;
    REVOKE ALL ON public.conversation_events FROM authenticated;
    REVOKE ALL ON public.communication_sender_identities FROM authenticated;
  END IF;
END $$;
