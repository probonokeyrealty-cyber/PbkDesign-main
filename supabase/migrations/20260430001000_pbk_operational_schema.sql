-- PBK operational schema.
-- This migration is additive and intentionally leaves Supabase Auth/RLS for a later pass.
-- The bridge can continue using bridge_state while these tables become the normalized
-- CRM/reporting surface for UI wiring, Streak sync, contracts, and analytics.

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

CREATE TABLE IF NOT EXISTS public.lead_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  external_id TEXT,
  streak_box_key TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'new',
  stage TEXT NOT NULL DEFAULT 'cold',
  temperature TEXT NOT NULL DEFAULT 'cold',
  lead_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  owner_type TEXT NOT NULL DEFAULT '',
  participant_role TEXT NOT NULL DEFAULT '',
  participant_expertise TEXT NOT NULL DEFAULT '',
  engagement_score NUMERIC NOT NULL DEFAULT 0,
  motivation_score NUMERIC NOT NULL DEFAULT 0,
  dnc BOOLEAN NOT NULL DEFAULT FALSE,
  dnc_reason TEXT NOT NULL DEFAULT '',
  assigned_agent TEXT NOT NULL DEFAULT '',
  next_action_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.property_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  address TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT '',
  year_built INTEGER,
  square_feet NUMERIC,
  lot_size NUMERIC,
  bedrooms NUMERIC,
  bathrooms NUMERIC,
  tax_assessment NUMERIC,
  last_sale_price NUMERIC,
  last_sale_date DATE,
  market_value NUMERIC,
  estimated_equity NUMERIC,
  loan_balance NUMERIC,
  tax_delinquent BOOLEAN,
  probate_status BOOLEAN,
  vacancy_status TEXT NOT NULL DEFAULT '',
  motivation_signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  recent_comps JSONB NOT NULL DEFAULT '[]'::JSONB,
  enrichment_source TEXT NOT NULL DEFAULT '',
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  enriched_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, address)
);

CREATE TABLE IF NOT EXISTS public.property_cache (
  address TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  source TEXT NOT NULL DEFAULT 'browseros',
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'fresh',
  expires_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  file_name TEXT NOT NULL DEFAULT '',
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.analyzer_runs (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  address TEXT NOT NULL DEFAULT '',
  deal_path TEXT NOT NULL DEFAULT '',
  arv NUMERIC,
  mao NUMERIC,
  offer_price NUMERIC,
  repairs NUMERIC,
  estimated_profit NUMERIC,
  confidence NUMERIC,
  inputs JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.dnc_entries (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'reply-intent',
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unified_messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  channel TEXT NOT NULL DEFAULT 'email',
  direction TEXT NOT NULL DEFAULT 'inbound',
  status TEXT NOT NULL DEFAULT 'received',
  provider TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  from_phone TEXT NOT NULL DEFAULT '',
  to_phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '',
  sentiment NUMERIC,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.calls (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  direction TEXT NOT NULL DEFAULT 'outbound',
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT NOT NULL DEFAULT 'telnyx',
  assistant_id TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  from_number TEXT NOT NULL DEFAULT '',
  participant_role TEXT NOT NULL DEFAULT '',
  participant_expertise TEXT NOT NULL DEFAULT '',
  participant_confidence NUMERIC,
  telnyx_call_control_id TEXT NOT NULL DEFAULT '',
  telnyx_call_leg_id TEXT NOT NULL DEFAULT '',
  telnyx_call_session_id TEXT NOT NULL DEFAULT '',
  sentiment NUMERIC,
  yell_risk NUMERIC,
  human_joined BOOLEAN NOT NULL DEFAULT FALSE,
  ai_muted BOOLEAN NOT NULL DEFAULT FALSE,
  transcript JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  status TEXT NOT NULL DEFAULT 'requested',
  source TEXT NOT NULL DEFAULT 'reply-intent',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  booking_url TEXT NOT NULL DEFAULT '',
  calendar_provider TEXT NOT NULL DEFAULT '',
  calendar_event_id TEXT NOT NULL DEFAULT '',
  calendar_join_url TEXT NOT NULL DEFAULT '',
  calendar_event_status TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead_stage_transitions (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  from_stage TEXT NOT NULL DEFAULT 'unknown',
  to_stage TEXT NOT NULL DEFAULT 'unknown',
  changed BOOLEAN NOT NULL DEFAULT TRUE,
  intent TEXT NOT NULL DEFAULT '',
  temperature TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'runtime',
  channel TEXT NOT NULL DEFAULT 'email',
  reason TEXT NOT NULL DEFAULT '',
  participant_role TEXT NOT NULL DEFAULT '',
  participant_expertise TEXT NOT NULL DEFAULT '',
  requested_window TEXT NOT NULL DEFAULT '',
  reply_preview TEXT NOT NULL DEFAULT '',
  appointment_id TEXT REFERENCES public.appointments(id) ON DELETE SET NULL,
  approval_id TEXT,
  call_id TEXT REFERENCES public.calls(id) ON DELETE SET NULL,
  follow_up_template_key TEXT NOT NULL DEFAULT '',
  follow_up_status TEXT NOT NULL DEFAULT '',
  calendar_event_id TEXT NOT NULL DEFAULT '',
  calendar_sync_status TEXT NOT NULL DEFAULT '',
  crm_provider TEXT NOT NULL DEFAULT '',
  crm_entity_id TEXT NOT NULL DEFAULT '',
  crm_pipeline_key TEXT NOT NULL DEFAULT '',
  crm_stage_key TEXT NOT NULL DEFAULT '',
  crm_sync_status TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contract_path_templates (
  path_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  folder_path TEXT NOT NULL DEFAULT '',
  template_file TEXT NOT NULL DEFAULT '',
  fields_file TEXT NOT NULL DEFAULT 'fields.json',
  negotiation_file TEXT NOT NULL DEFAULT 'negotiation.md',
  fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version TEXT NOT NULL DEFAULT 'v1',
  updated_by TEXT NOT NULL DEFAULT 'Rex',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contracts (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  amount NUMERIC NOT NULL DEFAULT 0,
  selected_path TEXT REFERENCES public.contract_path_templates(path_key) ON DELETE SET NULL,
  selected_path_label TEXT NOT NULL DEFAULT '',
  timeline TEXT NOT NULL DEFAULT '',
  earnest_deposit TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provider TEXT NOT NULL DEFAULT 'docusign',
  envelope_id TEXT NOT NULL DEFAULT '',
  document_title TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  pdf_url TEXT NOT NULL DEFAULT '',
  master_package_query TEXT NOT NULL DEFAULT '',
  pdf_generated_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  approval_id TEXT,
  template_id TEXT NOT NULL DEFAULT '',
  template_fields JSONB NOT NULL DEFAULT '{}'::JSONB,
  template_field_map JSONB NOT NULL DEFAULT '{}'::JSONB,
  contract_path TEXT NOT NULL DEFAULT '',
  contract_type TEXT NOT NULL DEFAULT '',
  template_path TEXT NOT NULL DEFAULT '',
  template_file TEXT NOT NULL DEFAULT '',
  negotiation_file TEXT NOT NULL DEFAULT '',
  negotiation_prompt TEXT NOT NULL DEFAULT '',
  underwriting_status TEXT NOT NULL DEFAULT '',
  underwriting_reviewer_email TEXT NOT NULL DEFAULT '',
  underwriting_reviewer_name TEXT NOT NULL DEFAULT '',
  seller_notice TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.document_deliveries (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  email TEXT NOT NULL DEFAULT '',
  sender_profile TEXT NOT NULL DEFAULT 'warm',
  documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued',
  subject TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'resend',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  type TEXT NOT NULL DEFAULT 'offer',
  status TEXT NOT NULL DEFAULT 'pending',
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  contract_id TEXT REFERENCES public.contracts(id) ON DELETE SET NULL,
  requested_by TEXT NOT NULL DEFAULT 'Rex',
  summary TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT 'medium',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  provider TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT NOT NULL DEFAULT 'Rex',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  risk TEXT NOT NULL DEFAULT 'medium',
  cost_estimate TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  execution_history JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  task_id TEXT REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'Rex',
  summary TEXT NOT NULL DEFAULT '',
  result JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_sync_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'streak',
  entity_type TEXT NOT NULL DEFAULT 'lead',
  entity_id TEXT NOT NULL DEFAULT '',
  pipeline_key TEXT NOT NULL DEFAULT '',
  stage_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repository_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  repository_path TEXT NOT NULL,
  section_key TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version TEXT NOT NULL DEFAULT 'v1',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, repository_path)
);

CREATE TABLE IF NOT EXISTS public.runtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL DEFAULT 'pbk',
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'bridge',
  lead_id TEXT REFERENCES public.lead_profiles(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_profiles_workspace_stage_idx
  ON public.lead_profiles (workspace_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS lead_profiles_email_idx
  ON public.lead_profiles (LOWER(email));
CREATE INDEX IF NOT EXISTS lead_profiles_phone_idx
  ON public.lead_profiles (phone);
CREATE INDEX IF NOT EXISTS lead_profiles_address_idx
  ON public.lead_profiles (LOWER(address));
CREATE INDEX IF NOT EXISTS property_details_lead_idx
  ON public.property_details (lead_id);
CREATE INDEX IF NOT EXISTS property_details_address_idx
  ON public.property_details (LOWER(address));
CREATE INDEX IF NOT EXISTS property_cache_fetched_idx
  ON public.property_cache (fetched_at DESC);
CREATE INDEX IF NOT EXISTS analyzer_runs_lead_created_idx
  ON public.analyzer_runs (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dnc_entries_email_phone_idx
  ON public.dnc_entries (LOWER(email), phone);
CREATE INDEX IF NOT EXISTS unified_messages_lead_created_idx
  ON public.unified_messages (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS unified_messages_channel_status_idx
  ON public.unified_messages (workspace_id, channel, status, created_at DESC);
CREATE INDEX IF NOT EXISTS calls_lead_started_idx
  ON public.calls (lead_id, started_at DESC);
CREATE INDEX IF NOT EXISTS appointments_status_start_idx
  ON public.appointments (workspace_id, status, start_time);
CREATE INDEX IF NOT EXISTS lead_stage_transitions_lead_created_idx
  ON public.lead_stage_transitions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contracts_lead_updated_idx
  ON public.contracts (lead_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS document_deliveries_lead_created_idx
  ON public.document_deliveries (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS approvals_status_created_idx
  ON public.approvals (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_tasks_status_created_idx
  ON public.agent_tasks (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_task_created_idx
  ON public.admin_audit (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_sync_events_status_created_idx
  ON public.crm_sync_events (workspace_id, provider, status, created_at DESC);
CREATE INDEX IF NOT EXISTS runtime_events_type_created_idx
  ON public.runtime_events (workspace_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS property_details_raw_gin_idx
  ON public.property_details USING GIN (raw);
CREATE INDEX IF NOT EXISTS unified_messages_payload_gin_idx
  ON public.unified_messages USING GIN (payload);
CREATE INDEX IF NOT EXISTS agent_tasks_payload_gin_idx
  ON public.agent_tasks USING GIN (payload);
CREATE INDEX IF NOT EXISTS runtime_events_payload_gin_idx
  ON public.runtime_events USING GIN (payload);

DROP TRIGGER IF EXISTS lead_profiles_set_updated_at ON public.lead_profiles;
CREATE TRIGGER lead_profiles_set_updated_at
  BEFORE UPDATE ON public.lead_profiles
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS property_details_set_updated_at ON public.property_details;
CREATE TRIGGER property_details_set_updated_at
  BEFORE UPDATE ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS property_cache_set_updated_at ON public.property_cache;
CREATE TRIGGER property_cache_set_updated_at
  BEFORE UPDATE ON public.property_cache
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS lead_imports_set_updated_at ON public.lead_imports;
CREATE TRIGGER lead_imports_set_updated_at
  BEFORE UPDATE ON public.lead_imports
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS unified_messages_set_updated_at ON public.unified_messages;
CREATE TRIGGER unified_messages_set_updated_at
  BEFORE UPDATE ON public.unified_messages
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS calls_set_updated_at ON public.calls;
CREATE TRIGGER calls_set_updated_at
  BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS appointments_set_updated_at ON public.appointments;
CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS contract_path_templates_set_updated_at ON public.contract_path_templates;
CREATE TRIGGER contract_path_templates_set_updated_at
  BEFORE UPDATE ON public.contract_path_templates
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS contracts_set_updated_at ON public.contracts;
CREATE TRIGGER contracts_set_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS document_deliveries_set_updated_at ON public.document_deliveries;
CREATE TRIGGER document_deliveries_set_updated_at
  BEFORE UPDATE ON public.document_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS approvals_set_updated_at ON public.approvals;
CREATE TRIGGER approvals_set_updated_at
  BEFORE UPDATE ON public.approvals
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS agent_tasks_set_updated_at ON public.agent_tasks;
CREATE TRIGGER agent_tasks_set_updated_at
  BEFORE UPDATE ON public.agent_tasks
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS crm_sync_events_set_updated_at ON public.crm_sync_events;
CREATE TRIGGER crm_sync_events_set_updated_at
  BEFORE UPDATE ON public.crm_sync_events
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

DROP TRIGGER IF EXISTS repository_documents_set_updated_at ON public.repository_documents;
CREATE TRIGGER repository_documents_set_updated_at
  BEFORE UPDATE ON public.repository_documents
  FOR EACH ROW EXECUTE FUNCTION public.pbk_set_updated_at();

INSERT INTO public.contract_path_templates
  (path_key, label, category, audience, folder_path, template_file, fields_file, negotiation_file)
VALUES
  ('cash-offer', 'Cash Offer', 'cash', 'homeowner-agent-backup', 'contracts/cash-offer', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('retail-buyer-program', 'Retail Buyer Program (RBP)', 'rbp', 'homeowner', 'contracts/retail-buyer-program', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('creative-finance-agent', 'Agent-Preferred Creative Finance (CF)', 'creative-finance', 'agent-preferred', 'contracts/creative-finance-agent', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('mortgage-takeover-agent', 'Agent-Preferred Mortgage Takeover (MT)', 'mortgage-takeover', 'agent-preferred', 'contracts/mortgage-takeover-agent', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('land', 'Land', 'land', 'homeowner-agent', 'contracts/land', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('assignment', 'Assignment of Contract', 'assignment', 'buyer-seller', 'contracts/assignment', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('standard-purchase', 'Standard Purchase Agreement', 'cash', 'homeowner', 'contracts/standard-purchase', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('subto', 'Subject-To Purchase', 'mortgage-takeover', 'homeowner', 'contracts/subto', 'template.pdf', 'fields.json', 'negotiation.md'),
  ('probate-addendum', 'Probate Addendum', 'probate', 'executor', 'contracts/probate-addendum', 'template.pdf', 'fields.json', 'negotiation.md')
ON CONFLICT (path_key) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  audience = EXCLUDED.audience,
  folder_path = EXCLUDED.folder_path,
  template_file = EXCLUDED.template_file,
  fields_file = EXCLUDED.fields_file,
  negotiation_file = EXCLUDED.negotiation_file,
  active = TRUE,
  updated_at = NOW();

COMMENT ON TABLE public.lead_profiles IS 'Normalized PBK lead/seller records. Supabase Auth and RLS are intentionally deferred.';
COMMENT ON TABLE public.property_details IS 'Property snapshot, financials, motivation signals, comps, and enrichment results.';
COMMENT ON TABLE public.property_cache IS 'BrowserOS or provider-backed property data cache for analyzer speed.';
COMMENT ON TABLE public.unified_messages IS 'Inbound/outbound email, SMS, and reply-intent message stream.';
COMMENT ON TABLE public.lead_stage_transitions IS 'Formal cold-to-warm-to-booking stage transitions for Streak/CRM sync.';
COMMENT ON TABLE public.contract_path_templates IS 'Deal-path contract folder registry used by the Contract Lawyer Agent.';
COMMENT ON TABLE public.contracts IS 'Prepared contracts and DocuSign envelope lifecycle.';
COMMENT ON TABLE public.agent_tasks IS 'Rex/admin approval-backed command queue.';
