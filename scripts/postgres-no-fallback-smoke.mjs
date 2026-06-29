import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8').replace(
  /\r\n/g,
  '\n'
);
const renderYaml = readFileSync(resolve(root, 'render.yaml'), 'utf8').replace(/\r\n/g, '\n');

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
assert(
  /function isTransientPostgresStatePersistError/.test(bridge) &&
    /57P01[\s\S]*57P02[\s\S]*57P03/.test(bridge) &&
    /function getStatePersistRetryAttempts/.test(bridge) &&
    /PBK_STATE_PERSIST_RETRY_ATTEMPTS/.test(bridge) &&
    /await sleep\(getStatePersistRetryDelayMs\(attempt\)\)/.test(bridge),
  'Hosted Postgres state persistence must retry transient connection-startup failures before failing closed.'
);
assert(
  /const PG_QUERY_TIMEOUT_MS/.test(bridge) &&
    /const PG_STATEMENT_TIMEOUT_MS/.test(bridge) &&
    /const PG_LOCK_TIMEOUT_MS/.test(bridge) &&
    /const PG_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS/.test(bridge) &&
    /PBK_PG_CONNECTION_TIMEOUT_MS \|\| \(IS_HOSTED \? 6000 : 5000\)/.test(bridge) &&
    /PBK_PG_QUERY_TIMEOUT_MS \|\| \(IS_HOSTED \? 12000 : 5000\)/.test(bridge) &&
    /query_timeout:\s*PG_QUERY_TIMEOUT_MS/.test(bridge) &&
    /statement_timeout:\s*PG_STATEMENT_TIMEOUT_MS/.test(bridge) &&
    /lock_timeout:\s*PG_LOCK_TIMEOUT_MS/.test(bridge) &&
    /idle_in_transaction_session_timeout:\s*PG_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS/.test(
      bridge
    ),
  'Hosted Postgres operations must have bounded client, statement, lock, and idle-transaction timeouts.'
);
assert(
  /function getPgPoolPressureSnapshot/.test(bridge) &&
    /waitingCount/.test(bridge) &&
    /idleCount/.test(bridge) &&
    /totalCount/.test(bridge) &&
    /hardCap: PG_POOL_HARD_CAP/.test(bridge) &&
    /poolHardCap: PG_POOL_HARD_CAP/.test(bridge) &&
    /poolPressure: getPgPoolPressureSnapshot\(\)/.test(bridge),
  'Postgres health must expose pool pressure so connection exhaustion cannot hide behind generic timeouts.'
);
assert(
  /const PG_POOL_HARD_CAP/.test(bridge) &&
    /PBK_PG_POOL_HARD_CAP \|\| \(IS_HOSTED \? 4 : 20\)/.test(bridge) &&
    /PBK_PG_POOL_MAX \|\| \(IS_HOSTED \? 4 : 10\)/.test(bridge) &&
    /Number\(process\.env\.PBK_PG_POOL_MIN \|\| 0\)/.test(bridge),
  'Hosted bridge must cap Postgres pools to protect small Render databases even when env vars are missing.'
);
assert(
  !/PBK_PG_CONNECTION_TIMEOUT_MS\s*\n\s*value:\s*"10000"/.test(renderYaml) &&
    /PBK_PG_POOL_MAX\s*\n\s*value:\s*"4"/.test(renderYaml) &&
    /PBK_PG_POOL_MIN\s*\n\s*value:\s*"0"/.test(renderYaml) &&
    /PBK_PG_POOL_HARD_CAP\s*\n\s*value:\s*"4"/.test(renderYaml) &&
    /PBK_PG_CONNECTION_TIMEOUT_MS\s*\n\s*value:\s*"6000"/.test(renderYaml) &&
    /PBK_PG_QUERY_TIMEOUT_MS\s*\n\s*value:\s*"12000"/.test(renderYaml) &&
    /PBK_PG_OPERATION_TIMEOUT_MS\s*\n\s*value:\s*"15000"/.test(renderYaml) &&
    /PBK_PG_STATEMENT_TIMEOUT_MS\s*\n\s*value:\s*"12000"/.test(renderYaml) &&
    /PBK_PG_LOCK_TIMEOUT_MS\s*\n\s*value:\s*"1000"/.test(renderYaml) &&
    /PBK_PG_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS\s*\n\s*value:\s*"10000"/.test(
      renderYaml
    ) &&
    /PBK_PG_KEEPALIVE_INITIAL_DELAY_MS\s*\n\s*value:\s*"2000"/.test(renderYaml) &&
    /PBK_PG_KEEPALIVE_INTERVAL_MS\s*\n\s*value:\s*"10000"/.test(renderYaml) &&
    /PBK_PG_TRANSIENT_GRACE_MS\s*\n\s*value:\s*"0"/.test(renderYaml),
  'Render Postgres env must use bounded fail-closed timeouts and no transient readiness grace.'
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

const getBrainStateStart = bridge.indexOf('async getBrainState(params = {})');
const getBrainStateEnd = bridge.indexOf('\n\n  async launchBrowserResearch', getBrainStateStart);
assert(
  getBrainStateStart >= 0 && getBrainStateEnd > getBrainStateStart,
  'getBrainState handler must be present.'
);
const getBrainStateSource = bridge.slice(getBrainStateStart, getBrainStateEnd);
assert(
  /const isReadOnlyBrainQuery\s*=[\s\S]*isReadableSummaryIntent[\s\S]*params\.readOnly === true[\s\S]*params\.noProviderWrites === true[\s\S]*params\.providerWrites === false/.test(
    getBrainStateSource
  ) &&
    /const persistBrainState = async \(\) => \{\s*if \(!isReadOnlyBrainQuery\) await persistState\(state\);\s*\};/.test(
      getBrainStateSource
    ) &&
    /const storeBrainMemory = async \(result\) => \{[\s\S]*Read-only Brain request/.test(
      getBrainStateSource
    ),
  'Hosted read-only Brain summaries must not persist full runtime state or create durable Rex memory.'
);

console.log('[postgres-no-fallback-smoke] ok');
