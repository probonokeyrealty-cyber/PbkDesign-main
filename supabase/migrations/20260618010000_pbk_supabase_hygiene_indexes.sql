-- PBK Supabase hygiene pass.
--
-- This migration closes non-critical Supabase advisor findings without changing
-- PBK's service-role-only access model:
-- - keep pg_trgm outside the exposed public schema
-- - pin PBK function search_path values
-- - add indexes for foreign keys reported by the performance advisor

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension extension_record
    JOIN pg_namespace extension_namespace
      ON extension_namespace.oid = extension_record.extnamespace
    WHERE extension_record.extname = 'pg_trgm'
      AND extension_record.extrelocatable
      AND extension_namespace.nspname = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA extensions TO service_role;
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.pbk_set_updated_at()
  SET search_path = pg_catalog;

ALTER FUNCTION public.pbk_fuzzy_lead_lookup(TEXT, DOUBLE PRECISION, INTEGER)
  SET search_path = public, extensions, pg_catalog;

CREATE INDEX IF NOT EXISTS appointments_lead_id_fk_idx
  ON public.appointments (lead_id);

CREATE INDEX IF NOT EXISTS approvals_contract_id_fk_idx
  ON public.approvals (contract_id);

CREATE INDEX IF NOT EXISTS approvals_lead_id_fk_idx
  ON public.approvals (lead_id);

CREATE INDEX IF NOT EXISTS campaign_events_campaign_lead_id_fk_idx
  ON public.campaign_events (campaign_lead_id);

CREATE INDEX IF NOT EXISTS contracts_selected_path_fk_idx
  ON public.contracts (selected_path);

CREATE INDEX IF NOT EXISTS conversation_events_lead_id_fk_idx
  ON public.conversation_events (lead_id);

CREATE INDEX IF NOT EXISTS conversation_events_sender_identity_id_fk_idx
  ON public.conversation_events (sender_identity_id);

CREATE INDEX IF NOT EXISTS conversation_thread_identities_lead_id_fk_idx
  ON public.conversation_thread_identities (lead_id);

CREATE INDEX IF NOT EXISTS conversation_thread_identities_thread_id_fk_idx
  ON public.conversation_thread_identities (thread_id);

CREATE INDEX IF NOT EXISTS conversation_threads_lead_id_fk_idx
  ON public.conversation_threads (lead_id);

CREATE INDEX IF NOT EXISTS conversation_threads_merged_into_thread_id_fk_idx
  ON public.conversation_threads (merged_into_thread_id);

CREATE INDEX IF NOT EXISTS crm_sync_events_lead_id_fk_idx
  ON public.crm_sync_events (lead_id);

CREATE INDEX IF NOT EXISTS dnc_entries_lead_id_fk_idx
  ON public.dnc_entries (lead_id);

CREATE INDEX IF NOT EXISTS lead_stage_transitions_appointment_id_fk_idx
  ON public.lead_stage_transitions (appointment_id);

CREATE INDEX IF NOT EXISTS lead_stage_transitions_call_id_fk_idx
  ON public.lead_stage_transitions (call_id);

CREATE INDEX IF NOT EXISTS pbk_bant_sessions_call_id_fk_idx
  ON public.pbk_bant_sessions (call_id);

CREATE INDEX IF NOT EXISTS pbk_bant_sessions_lead_id_fk_idx
  ON public.pbk_bant_sessions (lead_id);

CREATE INDEX IF NOT EXISTS pbk_contract_followups_contract_id_fk_idx
  ON public.pbk_contract_followups (contract_id);

CREATE INDEX IF NOT EXISTS pbk_contract_followups_lead_id_fk_idx
  ON public.pbk_contract_followups (lead_id);

CREATE INDEX IF NOT EXISTS runtime_events_lead_id_fk_idx
  ON public.runtime_events (lead_id);

COMMENT ON EXTENSION pg_trgm IS
  'PBK fuzzy lead lookup support. Extension is intentionally housed in extensions, not public.';

COMMENT ON FUNCTION public.pbk_fuzzy_lead_lookup(TEXT, DOUBLE PRECISION, INTEGER) IS
  'Service-role fuzzy lead lookup for PBK. search_path is pinned to public, extensions, pg_catalog.';

COMMENT ON FUNCTION public.pbk_set_updated_at() IS
  'Shared updated_at trigger helper. search_path is pinned to pg_catalog.';
