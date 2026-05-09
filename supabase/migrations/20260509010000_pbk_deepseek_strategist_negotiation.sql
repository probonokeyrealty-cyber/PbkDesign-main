-- PBK DeepSeek strategist + negotiation intelligence.
-- Safe to run repeatedly; mirrors the bridge's ensurePgSchema additions.

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

CREATE TABLE IF NOT EXISTS public.pbk_learning_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  agent_name TEXT NOT NULL DEFAULT 'Ava',
  situation TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  confidence NUMERIC NOT NULL DEFAULT 0,
  attempted_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  strategist_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  provider TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_repair_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  item_category TEXT NOT NULL DEFAULT 'general',
  estimated_cost NUMERIC NOT NULL DEFAULT 0,
  urgency TEXT NOT NULL DEFAULT 'medium',
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pbk_offer_overrides (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT NOT NULL DEFAULT '',
  approved_offer NUMERIC NOT NULL DEFAULT 0,
  original_mao NUMERIC NOT NULL DEFAULT 0,
  is_above_mao BOOLEAN NOT NULL DEFAULT FALSE,
  rationale TEXT NOT NULL DEFAULT '',
  approved_by TEXT NOT NULL DEFAULT '',
  approval_id TEXT NOT NULL DEFAULT '',
  ava_script TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pbk_learning_requests_lookup_idx
  ON public.pbk_learning_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_learning_requests_lead_idx
  ON public.pbk_learning_requests (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_repair_items_lead_idx
  ON public.pbk_repair_items (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_repair_items_category_idx
  ON public.pbk_repair_items (tenant_id, item_category, urgency);

CREATE INDEX IF NOT EXISTS pbk_offer_overrides_lead_idx
  ON public.pbk_offer_overrides (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_offer_overrides_approval_idx
  ON public.pbk_offer_overrides (tenant_id, approval_id)
  WHERE approval_id <> '';

DROP TRIGGER IF EXISTS pbk_learning_requests_set_updated_at ON public.pbk_learning_requests;
CREATE TRIGGER pbk_learning_requests_set_updated_at
  BEFORE UPDATE ON public.pbk_learning_requests
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_repair_items_set_updated_at ON public.pbk_repair_items;
CREATE TRIGGER pbk_repair_items_set_updated_at
  BEFORE UPDATE ON public.pbk_repair_items
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_offer_overrides_set_updated_at ON public.pbk_offer_overrides;
CREATE TRIGGER pbk_offer_overrides_set_updated_at
  BEFORE UPDATE ON public.pbk_offer_overrides
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();
