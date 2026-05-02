-- PBK outreach campaigns foundation.
-- Stores campaign definitions, attached leads, provider events, and suppression
-- records. Provider writes remain approval-gated by the bridge.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'call', 'sms', 'mixed')),
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  template_id TEXT,
  lead_source TEXT,
  lead_filter JSONB NOT NULL DEFAULT '{}'::JSONB,
  schedule JSONB NOT NULL DEFAULT '{}'::JSONB,
  sequence JSONB NOT NULL DEFAULT '{}'::JSONB,
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB,
  approval_id TEXT,
  approval_status TEXT,
  pending_action TEXT,
  execution_id TEXT,
  provider_campaign_id TEXT,
  last_worker_run_at TIMESTAMPTZ,
  suppression_mode TEXT NOT NULL DEFAULT 'same_channel_active_campaigns',
  conflict_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.campaign_leads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id TEXT,
  lead_name TEXT,
  address TEXT,
  email TEXT,
  phone TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'pending',
  touch_index INTEGER NOT NULL DEFAULT 0,
  last_touch_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  campaign_lead_id TEXT REFERENCES public.campaign_leads(id) ON DELETE SET NULL,
  lead_id TEXT,
  event_type TEXT NOT NULL,
  channel TEXT,
  provider TEXT,
  provider_event_id TEXT,
  provider_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_suppressions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  channel TEXT,
  reason TEXT NOT NULL,
  source TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_executions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  campaign_id TEXT REFERENCES public.campaigns(id) ON DELETE SET NULL,
  approval_id TEXT,
  provider TEXT,
  provider_campaign_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  lead_count INTEGER NOT NULL DEFAULT 0,
  request JSONB NOT NULL DEFAULT '{}'::JSONB,
  response JSONB NOT NULL DEFAULT '{}'::JSONB,
  error TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.campaign_worker_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT NOT NULL,
  result TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  allow_provider_writes BOOLEAN NOT NULL DEFAULT FALSE,
  processed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  processed JSONB NOT NULL DEFAULT '[]'::JSONB,
  skipped JSONB NOT NULL DEFAULT '[]'::JSONB,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status_channel ON public.campaigns(status, channel);
CREATE INDEX IF NOT EXISTS idx_campaigns_updated_at ON public.campaigns(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_campaign_id ON public.campaign_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_leads_lead_id ON public.campaign_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_id ON public.campaign_events(campaign_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_events_type ON public.campaign_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_events_provider_event
  ON public.campaign_events(provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL AND provider_event_id <> '';
CREATE INDEX IF NOT EXISTS idx_campaign_suppressions_lead_channel ON public.campaign_suppressions(lead_id, channel);
CREATE INDEX IF NOT EXISTS idx_campaign_suppressions_email ON public.campaign_suppressions(LOWER(email))
  WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_campaign_suppressions_phone ON public.campaign_suppressions(phone)
  WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_campaign_executions_campaign_id ON public.campaign_executions(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_worker_runs_created_at ON public.campaign_worker_runs(created_at DESC);
