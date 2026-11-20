import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { controlledExecution, createScopedState } from './controlled-execution-scope.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map((node) => [node.name.text, node.getText(ast)]));
let unavailable = true;
let loads = 0;
let writes = 0;
let coverageSamplerCreations = 0;
let releaseLoad;
const durable = { status: {}, leads: [{ id: 'existing-seller' }] };
const context = vm.createContext({
  controlledExecution, createScopedState,
  DATABASE_URL: 'isolated-test', IS_HOSTED: true, PG_KEEPALIVE_INTERVAL_MS: 10,
  postgresKeepAliveTimer: null, runtimeStateRecoveryPromise: null,
  runtimeStateBootstrap: { ready: false }, runtimeStateProvenance: {},
  runtimeCoverageStopped: false, runtimeCoverageStarted: false,
  process: { env: { PBK_RUNTIME_COVERAGE_ENABLED: 'false' } },
  createRuntimeCoverageSampler() { coverageSamplerCreations += 1; throw new Error('Coverage must stay disabled in this fixture.'); },
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
  'startPostgresKeepAlive', 'startRuntimeCoverageIfReady', 'persistState', 'matchesPath', 'isRuntimeStateBootstrapProbe', 'shouldBlockForRuntimeStateBootstrap']) {
  if (functions.has(name)) vm.runInContext(functions.get(name), context);
}

context.state = await context.bootstrapRuntimeStateForLiveness();
assert.equal(context.runtimeStateBootstrap.ready, false);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/api/auth/team'), true);
unavailable = false;
context.startPostgresKeepAlive();
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(context.runtimeStateBootstrap.ready, true, 'A recovered database must reload durable state and unblock auth without a restart.');
assert.equal(context.state.leads, durable.leads, 'Recovery must expose authoritative records through the scoped state wrapper.');
assert.deepEqual(JSON.parse(JSON.stringify(context.state)), durable, 'Recovery must restore authoritative state, not empty bootstrap placeholders.');
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
assert.equal(context.runtimeCoverageStarted, false, 'Recovering state must not enable opt-in coverage collection.');
assert.equal(coverageSamplerCreations, 0, 'Disabled coverage must not construct a sampler during recovery or keepalive.');

context.DATABASE_URL = '';
context.loadStateFromRuntimeFile = async () => { throw new Error('Hosted startup must not read a runtime file.'); };
context.ensureRuntimeDir = async () => { throw new Error('Hosted startup must not initialize file storage.'); };
vm.runInContext(functions.get('loadState'), context);
context.state = await context.bootstrapRuntimeStateForLiveness();
assert.equal(context.runtimeStateBootstrap.ready, false);
assert.equal(context.runtimeStateBootstrap.code, 'hosted_postgres_not_configured');
assert.equal(context.shouldBlockForRuntimeStateBootstrap('GET', '/health'), false);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('GET', '/state'), true);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('POST', '/api/assistant/chat'), true);
assert.equal(context.shouldBlockForRuntimeStateBootstrap('UPGRADE', '/ws/state'), true);
const upgradeRegistration = ast.statements.find((node) => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === 'server.on'
  && node.expression.arguments[0]?.text === 'upgrade');
assert.ok(upgradeRegistration, 'The bridge must register a WebSocket upgrade handler.');
let upgradeHandler;
context.server = { on(_event, handler) { upgradeHandler = handler; } };
context.URL = URL;
vm.runInContext(upgradeRegistration.getText(ast), context);
for (const url of ['/ws/state', '/api/voice/browser/stream', '/api/webhooks/telnyx/media', '/ws/sidecar']) {
  let response = '';
  upgradeHandler({ url, headers: { host: 'localhost' } }, { end(value) { response = value; } });
  assert.match(response, /^HTTP\/1\.1 503 Service Unavailable\r\n/);
}
await assert.rejects(context.persistState({ status: {} }, { allowBootstrap: true }), {
  code: 'hosted_postgres_not_configured',
});

context.IS_HOSTED = false;
context.ensureRuntimeDir = async () => {};
context.SHOULD_RESET = false;
context.loadStateFromRuntimeFile = async () => durable;
assert.equal((await context.loadState()).leads, durable.leads, 'Local mode may still load its file.');
assert.equal(context.shouldBlockForRuntimeStateBootstrap('GET', '/state'), false);
console.log('PASS: startup recovery, durable reload, hosted Postgres requirement, HTTP/WebSocket gating, and no placeholder writes.');
