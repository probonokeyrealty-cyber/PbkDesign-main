import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(ast)]));
let unavailable = true;
let loads = 0;
let writes = 0;
let releaseLoad;
const durable = { status: {}, leads: [{ id: 'existing-seller' }] };
const context = vm.createContext({
  DATABASE_URL: 'isolated-test', IS_HOSTED: true, PG_KEEPALIVE_INTERVAL_MS: 10,
  postgresKeepAliveTimer: null, runtimeStateRecoveryPromise: null,
  runtimeStateBootstrap: { ready: false }, runtimeStateProvenance: {},
  state: { status: {}, leads: [] }, console: { warn() {}, error() {}, log() {} },
  isoNow: () => new Date().toISOString(),
  loadState: async () => {
    loads += 1;
    if (unavailable) throw new Error('temporary database startup failure');
    if (releaseLoad) await new Promise((resolve) => { releaseLoad.resolve = resolve; });
    return durable;
  },
  getPgPool: () => ({ query: async () => ({ rows: [{ ok: 1 }] }) }),
  markPostgresHealth() {}, isTransientPostgresConnectionError: () => true,
  buildDefaultState: () => ({ status: {}, leads: [] }), ensureImmutablePbkKnowledge() {},
  updateDerivedStatus() {}, clearBridgeReadCache() {}, scheduleRuntimeStateBroadcast() {},
  persistStateToDb: async () => { writes += 1; return true; },
  syncAgentRegistryFromPg: async () => ({ ok: true }),
  setInterval(callback) { context.tick = callback; return { unref() {} }; },
});
for (const name of ['bootstrapRuntimeStateForLiveness', 'recoverRuntimeStateAfterBootstrapFailure',
  'startPostgresKeepAlive', 'persistState', 'matchesPath', 'isRuntimeStateBootstrapProbe', 'shouldBlockForRuntimeStateBootstrap']) {
  if (functions.has(name)) vm.runInContext(functions.get(name), context);
}

context.state = await context.bootstrapRuntimeStateForLiveness();
assert.equal(context.runtimeStateBootstrap.ready, false);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/api/auth/team'), true);
unavailable = false;
context.startPostgresKeepAlive();
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(context.runtimeStateBootstrap.ready, true, 'A recovered database must reload durable state and unblock auth without a restart.');
assert.equal(context.state, durable, 'Recovery must restore authoritative state, not empty bootstrap placeholders.');
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/invoke'), false);
assert.equal(writes, 0, 'Reloading an existing database must not overwrite it.');

context.runtimeStateBootstrap.ready = false;
await assert.rejects(context.persistState({ status: {}, leads: [] }), { code: 'state_bootstrap_unavailable' });
assert.equal(writes, 0, 'Background persistence must not save empty bootstrap state.');

releaseLoad = {};
const before = loads;
const pending = context.recoverRuntimeStateAfterBootstrapFailure();
const coalesced = context.recoverRuntimeStateAfterBootstrapFailure();
await Promise.resolve();
assert.equal(loads, before + 1, 'Concurrent recovery attempts must share one load.');
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/invoke'), true);
releaseLoad.resolve();
await Promise.all([pending, coalesced]);
assert.equal(context.runtimeStateBootstrap.ready, true);

context.runtimeStateBootstrap.ready = false;
releaseLoad = null;
unavailable = true;
assert.equal(await context.recoverRuntimeStateAfterBootstrapFailure(), false);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/invoke'), true);
unavailable = false;
assert.equal(await context.recoverRuntimeStateAfterBootstrapFailure(), true, 'Failed recovery must not poison future attempts.');
context.runtimeStateBootstrap.ready = false;
context.syncAgentRegistryFromPg = async (options) => {
  assert.equal(options.seed, false, 'Recovery must not overwrite registry configuration with defaults.');
  return { persistence: { ok: false, error: 'registry unavailable' } };
};
assert.equal(await context.recoverRuntimeStateAfterBootstrapFailure(), false);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/invoke'), true, 'Registry restore failure must not unblock agent actions.');
context.syncAgentRegistryFromPg = async () => ({ persistence: { ok: true } });
assert.equal(await context.recoverRuntimeStateAfterBootstrapFailure(), true);
assert.equal(writes, 0);
console.log('PASS: startup outage recovery, durable state reload, auth gating, coalescing, and no placeholder writes.');
