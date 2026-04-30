import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'supabase', 'migrations');

const databaseUrl = String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  console.error('Missing PBK_DATABASE_URL or DATABASE_URL. Refusing to run migrations without an explicit database target.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: /(localhost|127\.0\.0\.1)/.test(databaseUrl)
    ? false
    : { rejectUnauthorized: false },
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.pbk_schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM public.pbk_schema_migrations WHERE migration_name = $1 LIMIT 1',
      [file],
    );
    if (alreadyApplied.rowCount) {
      console.log(`skip ${file}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = await readFile(fullPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO public.pbk_schema_migrations (migration_name) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`failed ${file}: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    } finally {
      client.release();
    }
  }
}

try {
  await main();
} finally {
  await pool.end();
}
