-- PBK revenue-agent foundations: market intel, nurture, simulations, buyers,
-- buyer matches, and cost/reliability audits. These tables support
-- approval-gated production mode and do not enable unsafe provider writes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.market_intel (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  market TEXT NOT NULL,
  zip_code TEXT,
  property_type TEXT,
  competitive_offer_index NUMERIC,
  buyer_demand TEXT,
  median_investor_mao_pct NUMERIC,
  days_on_market_signal NUMERIC,
  confidence NUMERIC,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'live',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead_nurture_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT,
  lead_name TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'approval_required',
  cadence_days JSONB NOT NULL DEFAULT '[]'::JSONB,
  channels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  steps JSONB NOT NULL DEFAULT '[]'::JSONB,
  approval_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.deal_simulations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lead_id TEXT,
  lead_name TEXT,
  address TEXT,
  path_type TEXT,
  base_arv NUMERIC,
  base_repairs NUMERIC,
  offer_price NUMERIC,
  expected_profit NUMERIC,
  probability_of_loss NUMERIC,
  profit_range JSONB NOT NULL DEFAULT '{}'::JSONB,
  recommendation TEXT,
  scenarios JSONB NOT NULL DEFAULT '[]'::JSONB,
  assumptions JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.buyers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  zip_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  markets TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  property_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  price_min NUMERIC,
  price_max NUMERIC,
  desired_roi NUMERIC,
  max_repairs NUMERIC,
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.buyer_matches (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  deal JSONB NOT NULL DEFAULT '{}'::JSONB,
  matches JSONB NOT NULL DEFAULT '[]'::JSONB,
  top_buyer JSONB,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.system_audit_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status TEXT NOT NULL DEFAULT 'healthy',
  estimated_monthly_ai_cost NUMERIC,
  cost_per_lead NUMERIC,
  error_rate NUMERIC,
  avg_latency_ms NUMERIC,
  recommendations TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_intel_zip_idx ON public.market_intel (zip_code);
CREATE INDEX IF NOT EXISTS market_intel_created_at_idx ON public.market_intel (created_at DESC);
CREATE INDEX IF NOT EXISTS lead_nurture_plans_lead_id_idx ON public.lead_nurture_plans (lead_id);
CREATE INDEX IF NOT EXISTS deal_simulations_address_idx ON public.deal_simulations (address);
CREATE INDEX IF NOT EXISTS buyers_zip_codes_gin_idx ON public.buyers USING GIN (zip_codes);
CREATE INDEX IF NOT EXISTS buyers_property_types_gin_idx ON public.buyers USING GIN (property_types);
CREATE INDEX IF NOT EXISTS buyer_matches_created_at_idx ON public.buyer_matches (created_at DESC);
CREATE INDEX IF NOT EXISTS system_audit_reports_created_at_idx ON public.system_audit_reports (created_at DESC);

DROP TRIGGER IF EXISTS market_intel_set_updated_at ON public.market_intel;
CREATE TRIGGER market_intel_set_updated_at BEFORE UPDATE ON public.market_intel
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS lead_nurture_plans_set_updated_at ON public.lead_nurture_plans;
CREATE TRIGGER lead_nurture_plans_set_updated_at BEFORE UPDATE ON public.lead_nurture_plans
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS deal_simulations_set_updated_at ON public.deal_simulations;
CREATE TRIGGER deal_simulations_set_updated_at BEFORE UPDATE ON public.deal_simulations
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS buyers_set_updated_at ON public.buyers;
CREATE TRIGGER buyers_set_updated_at BEFORE UPDATE ON public.buyers
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS buyer_matches_set_updated_at ON public.buyer_matches;
CREATE TRIGGER buyer_matches_set_updated_at BEFORE UPDATE ON public.buyer_matches
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS system_audit_reports_set_updated_at ON public.system_audit_reports;
CREATE TRIGGER system_audit_reports_set_updated_at BEFORE UPDATE ON public.system_audit_reports
FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();
