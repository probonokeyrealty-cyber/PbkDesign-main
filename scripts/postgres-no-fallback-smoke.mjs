import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');

assert(
  /const PG_TRANSIENT_GRACE_MS = 0;/.test(bridge),
  'Production Postgres health must not use a transient grace window that marks a failed DB as ready.'
);
assert(
  /const ready = DATABASE_URL \? postgresHealth\.ready === true : false;/.test(bridge),
  'Postgres health readiness must be true only after a successful direct database check.'
);
assert(
  !/transient_postgres_recovering/.test(bridge) &&
    !/runtime falls back where supported/.test(bridge) &&
    !/bridge is treating this as recoverable/.test(bridge),
  'Production health copy must not describe Postgres failures as recoverable fallback states.'
);
assert(
  /const PG_KEEPALIVE_INTERVAL_MS/.test(bridge) &&
    /function startPostgresKeepAlive/.test(bridge) &&
    /SELECT 1 AS ok/.test(bridge) &&
    /startPostgresKeepAlive\(\);/.test(bridge),
  'The bridge must actively keep the Postgres pool warm and update health from a direct keepalive query.'
);

const ensurePgSchemaStart = bridge.indexOf('async function ensurePgSchema()');
const ensurePgSchemaEnd = bridge.indexOf('async function ensureCallEmbeddingsSchema', ensurePgSchemaStart);
assert(ensurePgSchemaStart >= 0 && ensurePgSchemaEnd > ensurePgSchemaStart, 'ensurePgSchema must be present.');
const ensurePgSchemaSource = bridge.slice(ensurePgSchemaStart, ensurePgSchemaEnd);
assert(
  !/continuing with runtime fallback/.test(ensurePgSchemaSource) &&
    !/return embeddingsReady \|\| warManualReady;/.test(ensurePgSchemaSource),
  'Postgres schema failures must fail closed instead of declaring partial runtime fallback readiness.'
);

const loadStateStart = bridge.indexOf('async function loadState()');
const loadStateEnd = bridge.indexOf('async function recordPbkToolUsage', loadStateStart);
assert(loadStateStart >= 0 && loadStateEnd > loadStateStart, 'loadState must be present.');
const loadStateSource = bridge.slice(loadStateStart, loadStateEnd);
const dbLoadBranch = loadStateSource.slice(
  loadStateSource.indexOf('if (DATABASE_URL) {'),
  loadStateSource.indexOf('\n\n  const runtimeState = await loadStateFromRuntimeFile()')
);
assert(
    !/runtime-file-fallback/.test(dbLoadBranch) &&
    !/runtime-default-fallback/.test(dbLoadBranch) &&
    !/loadStateFromRuntimeFile/.test(dbLoadBranch) &&
    /new Error\('postgres_state_load_required'\)/.test(dbLoadBranch) &&
    /throw error;/.test(dbLoadBranch),
  'Hosted Postgres state load must fail closed instead of loading runtime file/default fallbacks.'
);

const persistStateStart = bridge.indexOf('async function persistState(nextState)');
const persistStateEnd = bridge.indexOf('async function persistCampaignRecord', persistStateStart);
assert(persistStateStart >= 0 && persistStateEnd > persistStateStart, 'persistState must be present.');
const persistStateSource = bridge.slice(persistStateStart, persistStateEnd);
const dbPersistBranch = persistStateSource.slice(
  persistStateSource.indexOf('if (DATABASE_URL) {'),
  persistStateSource.indexOf('\n  await ensureRuntimeDir();')
);
assert(
  /new Error\('postgres_state_persist_required'\)/.test(dbPersistBranch) &&
    /throw error;/.test(dbPersistBranch) &&
    !/runtime-file-fallback/.test(dbPersistBranch) &&
    !/writeFile\(STATE_FILE/.test(dbPersistBranch),
  'Hosted Postgres state persist must fail closed instead of writing a runtime-file fallback.'
);

console.log('[postgres-no-fallback-smoke] ok');
