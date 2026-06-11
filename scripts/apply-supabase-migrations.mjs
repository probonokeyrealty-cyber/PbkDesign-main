import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'supabase', 'migrations');

const databaseUrl = String(process.env.PBK_MIGRATION_DATABASE_URL || '').trim();
const migrationTarget = String(process.env.PBK_MIGRATION_TARGET || '').trim().toLowerCase();
const expectedHost = String(process.env.PBK_MIGRATION_EXPECT_HOST || '').trim().toLowerCase();
const applyChanges = String(process.env.PBK_MIGRATION_APPLY || '').trim().toLowerCase() === 'true';
const allowlist = String(process.env.PBK_MIGRATION_ALLOWLIST || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateConfiguration() {
  if (!databaseUrl) {
    fail(
      'Missing PBK_MIGRATION_DATABASE_URL. PBK_DATABASE_URL and DATABASE_URL are intentionally ignored to prevent cross-database migrations.',
    );
  }

  if (!['supabase', 'render', 'local'].includes(migrationTarget)) {
    fail('PBK_MIGRATION_TARGET must be one of: supabase, render, local.');
  }

  if (!expectedHost) {
    fail('Missing PBK_MIGRATION_EXPECT_HOST. Set it to the exact database hostname you intend to migrate.');
  }

  if (!allowlist.length) {
    fail('Missing PBK_MIGRATION_ALLOWLIST. Refusing to infer or apply every migration in the directory.');
  }

  for (const file of allowlist) {
    if (path.basename(file) !== file || !file.endsWith('.sql')) {
      fail(`Invalid migration allowlist entry: ${file}`);
    }
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail('PBK_MIGRATION_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  const actualHost = parsed.hostname.toLowerCase();
  if (actualHost !== expectedHost) {
    fail(`Migration host mismatch: expected ${expectedHost}, received ${actualHost}.`);
  }

  const validTargetHost =
    (migrationTarget === 'supabase' &&
      (actualHost.endsWith('.supabase.co') || actualHost.endsWith('.pooler.supabase.com'))) ||
    (migrationTarget === 'render' &&
      (actualHost.endsWith('.render.com') || actualHost.startsWith('dpg-'))) ||
    (migrationTarget === 'local' && ['localhost', '127.0.0.1', '::1'].includes(actualHost));

  if (!validTargetHost) {
    fail(`Host ${actualHost} does not match the declared ${migrationTarget} migration target.`);
  }

  return {
    host: actualHost,
    database: decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || '(default)',
  };
}

function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

async function loadPlan() {
  const migrationStat = await stat(migrationsDir).catch(() => null);
  if (!migrationStat?.isDirectory()) {
    fail(`Supabase/Postgres migrations directory not found: ${migrationsDir}`);
  }

  const available = new Set(
    (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')),
  );
  const missing = allowlist.filter((file) => !available.has(file));
  if (missing.length) {
    fail(`Allowlisted migration files not found: ${missing.join(', ')}`);
  }

  return Promise.all(
    allowlist.map(async (file) => {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      return { file, sql, checksum: checksum(sql) };
    }),
  );
}

async function applyPlan(target, plan) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    ssl: target.host === 'localhost' || target.host === '127.0.0.1'
      ? false
      : { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  let lockHeld = false;
  try {
    const identity = await client.query(
      'SELECT current_database() AS database_name, current_user AS database_user',
    );
    console.log(
      `connected target=${migrationTarget} host=${target.host} database=${identity.rows[0].database_name} user=${identity.rows[0].database_user}`,
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.pbk_schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum_sha256 TEXT,
        migration_target TEXT
      );
      ALTER TABLE public.pbk_schema_migrations
        ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT,
        ADD COLUMN IF NOT EXISTS migration_target TEXT;
    `);

    await client.query(`SELECT pg_advisory_lock(hashtext('pbk-schema-migrations'))`);
    lockHeld = true;

    for (const migration of plan) {
      const applied = await client.query(
        `SELECT checksum_sha256
           FROM public.pbk_schema_migrations
          WHERE migration_name = $1
          LIMIT 1`,
        [migration.file],
      );

      if (applied.rowCount) {
        const recordedChecksum = String(applied.rows[0].checksum_sha256 || '');
        if (recordedChecksum && recordedChecksum !== migration.checksum) {
          throw new Error(
            `Checksum mismatch for applied migration ${migration.file}; refusing to continue.`,
          );
        }
        if (!recordedChecksum) {
          await client.query(
            `UPDATE public.pbk_schema_migrations
                SET checksum_sha256 = $2,
                    migration_target = COALESCE(migration_target, $3)
              WHERE migration_name = $1`,
            [migration.file, migration.checksum, migrationTarget],
          );
        }
        console.log(`skip ${migration.file}`);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '5s'`);
        await client.query(`SET LOCAL statement_timeout = '5min'`);
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.pbk_schema_migrations
             (migration_name, checksum_sha256, migration_target)
           VALUES ($1, $2, $3)`,
          [migration.file, migration.checksum, migrationTarget],
        );
        await client.query('COMMIT');
        console.log(`applied ${migration.file}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(
          `failed ${migration.file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    if (lockHeld) {
      await client.query(`SELECT pg_advisory_unlock(hashtext('pbk-schema-migrations'))`).catch(() => {});
    }
    client.release();
    await pool.end();
  }
}

const target = validateConfiguration();
const plan = await loadPlan();

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? 'apply' : 'dry-run',
      target: migrationTarget,
      host: target.host,
      database: target.database,
      migrations: plan.map(({ file, checksum: digest }) => ({ file, checksumSha256: digest })),
    },
    null,
    2,
  ),
);

if (!applyChanges) {
  console.log('dry-run only; set PBK_MIGRATION_APPLY=true to execute this exact allowlist');
  process.exit(0);
}

await applyPlan(target, plan);
