import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_GOVERNANCE_SCHEMA_SQL } from './skill-governance-schema.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const migrationPath = resolve(root, 'supabase/migrations/20260609000000_skill_governance.sql');
const rollbackPath = resolve(root, 'supabase/rollbacks/20260609000000_skill_governance.down.sql');
const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');

for (const token of [
  'public.skill_definitions',
  'public.skill_versions',
  'public.skill_approvals',
  'public.agent_skill_assignments',
  'public.skill_activations',
  'public.skill_audit_events',
  'public.skill_projection_outbox',
  'skill_activations_one_live_subject_uidx',
  'skill_projection_outbox_claim_idx',
]) {
  assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${token} missing from migration`);
  assert.match(
    SKILL_GOVERNANCE_SCHEMA_SQL,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `${token} missing from runtime ensure SQL`,
  );
}

assert.match(migration, /ALTER TABLE public\.skill_definitions ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON public\.skill_versions FROM authenticated/);
assert.match(rollback, /DROP TABLE IF EXISTS public\.skill_projection_outbox/);

const accidentalDownMigrations = readdirSync(resolve(root, 'supabase/migrations')).filter((name) =>
  /\.down\.sql$/i.test(name),
);
assert.deepEqual(accidentalDownMigrations, [], 'Rollback files must not live in supabase/migrations.');

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'skill_governance_migration_smoke_passed',
      migration: 'supabase/migrations/20260609000000_skill_governance.sql',
      rollback: 'supabase/rollbacks/20260609000000_skill_governance.down.sql',
    },
    null,
    2,
  ),
);
