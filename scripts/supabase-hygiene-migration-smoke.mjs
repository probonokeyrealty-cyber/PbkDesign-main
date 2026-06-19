import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const hygieneMigrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260618010000_pbk_supabase_hygiene_indexes.sql'
);
const duplicateIndexMigrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260618011000_pbk_drop_duplicate_call_embeddings_index.sql'
);

const migration = readFileSync(hygieneMigrationPath, 'utf8');
const duplicateIndexMigration = readFileSync(duplicateIndexMigrationPath, 'utf8');

const requiredSnippets = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions',
  'ALTER EXTENSION pg_trgm SET SCHEMA extensions',
  'ALTER FUNCTION public.pbk_set_updated_at()',
  'SET search_path = pg_catalog',
  'ALTER FUNCTION public.pbk_fuzzy_lead_lookup(TEXT, DOUBLE PRECISION, INTEGER)',
  'SET search_path = public, extensions, pg_catalog',
  'appointments_lead_id_fk_idx',
  'approvals_contract_id_fk_idx',
  'approvals_lead_id_fk_idx',
  'campaign_events_campaign_lead_id_fk_idx',
  'contracts_selected_path_fk_idx',
  'conversation_events_lead_id_fk_idx',
  'conversation_events_sender_identity_id_fk_idx',
  'conversation_thread_identities_lead_id_fk_idx',
  'conversation_thread_identities_thread_id_fk_idx',
  'conversation_threads_lead_id_fk_idx',
  'conversation_threads_merged_into_thread_id_fk_idx',
  'crm_sync_events_lead_id_fk_idx',
  'dnc_entries_lead_id_fk_idx',
  'lead_stage_transitions_appointment_id_fk_idx',
  'lead_stage_transitions_call_id_fk_idx',
  'pbk_bant_sessions_call_id_fk_idx',
  'pbk_bant_sessions_lead_id_fk_idx',
  'pbk_contract_followups_contract_id_fk_idx',
  'pbk_contract_followups_lead_id_fk_idx',
  'runtime_events_lead_id_fk_idx',
];

for (const snippet of requiredSnippets) {
  assert.match(migration, new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Missing ${snippet}`);
}

assert.doesNotMatch(
  migration,
  /CREATE\s+POLICY/i,
  'This hygiene pass should not create RLS policies because PBK intentionally fails closed for browser roles.'
);

assert.doesNotMatch(
  migration,
  /ALTER\s+PUBLICATION\s+supabase_realtime/i,
  'This hygiene pass should not publish tables to realtime without a product dependency.'
);

assert.match(
  duplicateIndexMigration,
  /DROP\s+INDEX\s+IF\s+EXISTS\s+public\.call_embeddings_workspace_call_model_idx/i,
  'Duplicate call_embeddings standalone index should be dropped while the constraint-backed index remains.'
);

console.log('Supabase hygiene migration smoke passed.');
