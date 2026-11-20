import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlUrl = new URL('./migrations/20261116-targeted-readiness.sql', import.meta.url);
const sql = readFileSync(sqlUrl, 'utf8');
const sha256 = createHash('sha256').update(sql).digest('hex');

// Deliberately separate from ambient runtime and full-batch migration variables.
export function validateTargetedMigrationConfig(env = {}) {
  const required = (suffix) => {
    const value = String(env[`PBK_TARGETED_MIGRATION_${suffix}`] || '').trim();
    if (!value) throw new Error(`Missing PBK_TARGETED_MIGRATION_${suffix}; ambient database variables are intentionally ignored.`);
    return value;
  };
  const databaseUrl = required('DATABASE_URL');
  const target = required('TARGET');
  const host = required('EXPECT_HOST');
  const expectedDatabase = required('EXPECT_DATABASE');
  const expectedRole = required('EXPECT_ROLE');
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('Invalid targeted migration PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error('Targeted migration URL must use PostgreSQL without query overrides or fragments');
  }
  if (url.hostname !== host) throw new Error('Targeted migration host mismatch');
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid targeted migration port');
  if (decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase || !/^[a-zA-Z0-9_-]+$/.test(expectedDatabase)) {
    throw new Error('Targeted migration database mismatch or invalid database name');
  }
  if (decodeURIComponent(url.username) !== expectedRole || !/^[a-zA-Z0-9_-]+$/.test(expectedRole)) {
    throw new Error('Targeted migration role mismatch or invalid role name');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const render = /^dpg-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.render\.com$/.test(host)
    || /^dpg-[a-z0-9-]+-[a-z]$/.test(host);
  if (!((target === 'local' && local) || (target === 'render' && render))) {
    throw new Error('Host does not match intended local/Render migration target');
  }
  return { databaseUrl, target, host, port, expectedDatabase, expectedRole, local };
}

// A dedicated connected client is required, not a pool: transaction affinity matters.
export async function applyTargetedReadinessMigration(client, { expectedDatabase, expectedRole } = {}) {
  if (!expectedDatabase || !expectedRole) throw new Error('Explicit expected database and role identity required');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '5min'");
    const { rows } = await client.query('SELECT current_database() AS database, current_user AS role');
    if (rows[0]?.database !== expectedDatabase || rows[0]?.role !== expectedRole) {
      throw new Error('Connected database/role identity mismatch; no schema changes applied');
    }
    await client.query("SELECT set_config('pbk.targeted_migration_context', '20261116-targeted-readiness', true)");
    await client.query(sql);
    await client.query('COMMIT');
    return { ok: true, migration: path.basename(fileURLToPath(sqlUrl)), sha256 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && !/^--confirm-sha256=[a-f0-9]{64}$/.test(arg))
      || new Set(args).size !== args.length) throw new Error('Invalid targeted migration arguments');
  const apply = args.includes('--apply');
  if (apply && !args.includes(`--confirm-sha256=${sha256}`)) {
    throw new Error('Explicit apply requires --confirm-sha256=<reviewed dry-run checksum>');
  }
  const target = validateTargetedMigrationConfig(process.env);
  const plan = {
    mode: apply ? 'apply' : 'dry-run', target: target.target, host: target.host,
    port: target.port, database: target.expectedDatabase, role: target.expectedRole,
    migrations: [{ file: path.basename(fileURLToPath(sqlUrl)), sha256 }],
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const { default: pg } = await import('pg');
  // Build connection options explicitly; pg environment defaults cannot override the target.
  const url = new URL(target.databaseUrl);
  const client = new pg.Client({
    host: target.host.replace(/^\[|\]$/g, ''), port: target.port,
    database: target.expectedDatabase, user: target.expectedRole,
    password: decodeURIComponent(url.password),
    ssl: target.local ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000, application_name: 'pbk-targeted-readiness-migration',
  });
  try {
    await client.connect();
    const result = await applyTargetedReadinessMigration(client, target);
    process.stdout.write(`${JSON.stringify({ ...plan, ...result }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never log the connection URL, password, environment, or driver's error object.
    console.error(`Targeted migration refused/failed: ${error.message}`);
    process.exitCode = 1;
  });
}
