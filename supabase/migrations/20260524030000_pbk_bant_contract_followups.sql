-- PBK BANT and contract follow-up loop tables.
-- These make Ava's call qualification and post-DocuSign follow-up measurable.

CREATE OR REPLACE FUNCTION public.pbk_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.pbk_bant_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  call_id TEXT REFERENCES public.calls(id) ON DELETE SET NULL,
  budget_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  authority TEXT NOT NULL DEFAULT '',
  need TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  urgency TEXT NOT NULL DEFAULT '',
  bant JSONB NOT NULL DEFAULT '{}'::jsonb,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_bant_sessions
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_id TEXT REFERENCES public.calls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS budget_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS authority TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS need TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS timeline TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS urgency TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bant JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.pbk_contract_followups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'pbk',
  contract_id TEXT REFERENCES public.contracts(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  envelope_id TEXT NOT NULL DEFAULT '',
  sent_to_seller_at TIMESTAMPTZ,
  seller_signed_at TIMESTAMPTZ,
  pbk_signed_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ[] NOT NULL DEFAULT ARRAY[]::TIMESTAMPTZ[],
  status TEXT NOT NULL DEFAULT 'sent_to_seller',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pbk_contract_followups
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'pbk',
  ADD COLUMN IF NOT EXISTS contract_id TEXT REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS envelope_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sent_to_seller_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seller_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pbk_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ[] NOT NULL DEFAULT ARRAY[]::TIMESTAMPTZ[],
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent_to_seller',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS pbk_bant_sessions_lead_idx
  ON public.pbk_bant_sessions (tenant_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_bant_sessions_call_idx
  ON public.pbk_bant_sessions (tenant_id, call_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_contract_followups_contract_idx
  ON public.pbk_contract_followups (tenant_id, contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pbk_contract_followups_status_idx
  ON public.pbk_contract_followups (tenant_id, status, created_at DESC);

ALTER TABLE public.pbk_bant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbk_contract_followups ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS pbk_bant_sessions_set_updated_at ON public.pbk_bant_sessions;
CREATE TRIGGER pbk_bant_sessions_set_updated_at
  BEFORE UPDATE ON public.pbk_bant_sessions
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS pbk_contract_followups_set_updated_at ON public.pbk_contract_followups;
CREATE TRIGGER pbk_contract_followups_set_updated_at
  BEFORE UPDATE ON public.pbk_contract_followups
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_bant_sessions TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.pbk_contract_followups TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.pbk_bant_sessions IS 'Per-call BANT+ qualification sessions Ava uses before seller-facing numbers or paperwork.';
COMMENT ON TABLE public.pbk_contract_followups IS 'DocuSign and contract follow-up tracking for seller/PBK signatures and reminders.';
