// Kept outside Jest discovery because these checks spawn the standalone migration CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(repoRoot, 'scripts', 'apply-supabase-migrations.mjs');
const knownMigration = '20260611082111_lock_down_public_data_api.sql';

function run(env = {}) {
  return spawnSync(process.execPath, [runner], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PBK_MIGRATION_DATABASE_URL: '',
      PBK_MIGRATION_TARGET: '',
      PBK_MIGRATION_EXPECT_HOST: '',
      PBK_MIGRATION_ALLOWLIST: '',
      PBK_MIGRATION_APPLY: '',
      ...env,
    },
  });
}

test('migration runner ignores ambient runtime database variables', () => {
  const result = run({
    PBK_DATABASE_URL: 'postgresql://runtime:secret@dpg-runtime/render',
    DATABASE_URL: 'postgresql://ambient:secret@db.example.com/default',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing PBK_MIGRATION_DATABASE_URL/);
  assert.match(result.stderr, /intentionally ignored/);
});

test('migration runner requires an explicit allowlist', () => {
  const result = run({
    PBK_MIGRATION_DATABASE_URL: 'postgresql://postgres:secret@db.demo.supabase.co/postgres',
    PBK_MIGRATION_TARGET: 'supabase',
    PBK_MIGRATION_EXPECT_HOST: 'db.demo.supabase.co',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing PBK_MIGRATION_ALLOWLIST/);
});

test('migration runner rejects a target and host mismatch', () => {
  const result = run({
    PBK_MIGRATION_DATABASE_URL: 'postgresql://postgres:secret@dpg-example.render.com/pbk',
    PBK_MIGRATION_TARGET: 'supabase',
    PBK_MIGRATION_EXPECT_HOST: 'dpg-example.render.com',
    PBK_MIGRATION_ALLOWLIST: knownMigration,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the declared supabase migration target/);
});

test('migration runner defaults to a non-connecting dry run', () => {
  const result = run({
    PBK_MIGRATION_DATABASE_URL: 'postgresql://postgres:secret@db.demo.supabase.co/postgres',
    PBK_MIGRATION_TARGET: 'supabase',
    PBK_MIGRATION_EXPECT_HOST: 'db.demo.supabase.co',
    PBK_MIGRATION_ALLOWLIST: knownMigration,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"mode": "dry-run"/);
  assert.match(result.stdout, new RegExp(knownMigration.replaceAll('.', '\\.')));
  assert.match(result.stdout, /dry-run only/);
  assert.doesNotMatch(result.stdout, /connected target=/);
});
