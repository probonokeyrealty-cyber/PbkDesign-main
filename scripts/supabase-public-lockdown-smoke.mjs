import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const migrationsDir = resolve(root, 'supabase', 'migrations');
const migrationNames = readdirSync(migrationsDir)
  .filter(
    (name) =>
      name.endsWith('_lock_down_public_data_api.sql') ||
      name.endsWith('_finish_public_schema_lockdown.sql')
  )
  .sort();
const migrationName = migrationNames.find((name) =>
  name.endsWith('_lock_down_public_data_api.sql')
);

assert(migrationName, 'A public Data API lockdown migration must exist.');

const migration = migrationNames
  .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))
  .join('\n');

assert(
  /ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY/.test(migration),
  'The lockdown must enable RLS for every public base or partitioned table.'
);
assert(
  /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated/.test(
    migration
  ),
  'The lockdown must remove every table privilege from anon and authenticated.'
);
assert(
  /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated/.test(
    migration
  ),
  'The lockdown must remove every sequence privilege from anon and authenticated.'
);
assert(
  /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated/.test(
    migration
  ),
  'The lockdown must close public function execution.'
);
assert(
  /REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated/.test(migration),
  'The lockdown must remove inherited PUBLIC access to the exposed schema.'
);
assert(
  /ALTER EXTENSION vector SET SCHEMA extensions/.test(migration),
  'The pgvector extension must move out of the exposed public schema.'
);
assert(
  /GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role/.test(migration) &&
    /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role/.test(migration),
  'The lockdown must preserve the bridge service-role access path.'
);
assert(
  /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated/.test(
    migration
  ) &&
    /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/.test(
      migration
    ),
  'Future public objects must remain private by default.'
);
assert(
  !/CREATE POLICY[\s\S]*auth\.role\(\)\s*=\s*'authenticated'/.test(migration),
  'The emergency lockdown must not replace public exposure with blanket authenticated access.'
);

console.log(`supabase-public-lockdown-smoke: ok (${migrationName})`);
