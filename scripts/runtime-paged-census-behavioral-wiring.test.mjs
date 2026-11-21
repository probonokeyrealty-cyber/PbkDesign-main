import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule, createContext, runInThisContext } from 'node:vm';
import { beforeAll, test } from '@jest/globals';
import { canonicalJson } from './skill-governance-store.mjs';

// No core, SQL, provider, pool or database implementation is loaded by this harness.
const storeSource = readFileSync(new URL('./runtime-coverage-store.mjs', import.meta.url), 'utf8');
const START = Date.parse('2026-11-17T12:00:00.000Z');
const HEX = 'a'.repeat(64);
const CONTROL_ID = 'runtime-coverage-control-pbk-v1';
const HEALTH = Object.freeze({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
  providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });
// References must retain the store VM's plain-object realm for its shape checks.
const clone = runInThisContext('(value) => JSON.parse(JSON.stringify(value))');
const mutations = {
  'reset-budget': ['loadedRows += rows; loadedBytes += byteCount;', 'loadedRows = 0; loadedBytes = 0;'],
  'reuse-postcommit': ['independent: expected !== undefined', 'independent: false'],
  'ignore-active-lease-bindings': [
    `if (active && (old.bootRef !== bootRef || old.revision !== revision
          || old.instrumentation !== instrumentation(protocol)))`, 'if (false)',
  ],
  'ignore-reference-bindings': [
    'r.policyHash !== policyHash(secret) || r.instrumentation !== instrumentation(protocol) || r.revision !== revision',
    'r.policyHash !== policyHash(secret)',
  ],
  'ignore-closing-lease': ['if (!equal(current, pending) || db >= time(current.expiresAt))', 'if (false)'],
};

// Opt-in RED runs mutate only this VM's source string, never the checked-in store.
function sourceFor(mutation) {
  if (mutation === 'none') return storeSource;
  assert(Object.hasOwn(mutations, mutation), 'Unknown fixture-only wiring mutation');
  const [before, after] = mutations[mutation];
  assert.equal(storeSource.split(before).length, 2, `Mutation ${mutation} must have exactly one target`);
  return storeSource.replace(before, after);
}

let day;
async function createHarness({ seed, budget, swallowBudget = false, failIndependent = false,
  replaceControlOnPrepare, stallFirstQueryMs = 0, stallQuery = 1, rejectStalledQuery = false,
  mutation = process.env.PBK_CENSUS_WIRING_TEST_MUTATION ?? 'none' } = {}) {
  let wall = seed?.wall ?? START, transaction = null, operationFence, operationClient;
  let vmMonotonic = 100, timerCallbacks = 0;
  let records = new Map(seed?.records.map(([id, row]) => [id, clone(row)]) ?? []);
  const trace = [], statements = [], releases = [], faults = [], writes = [], queryTimeouts = [];
  const admission = Object.freeze({ fixture: 'source-admission' });
  let observed;
  const activeRecords = () => transaction ?? records;
  const checkpointCount = () => [...records.values()].filter(r => r.suite_name === 'runtime_coverage_v1').length;
  const record = (name, args) => {
    operationFence ??= args.fence;
    operationClient ??= args.client;
    trace.push({ name, fence: args.fence, client: args.client, inTransaction: transaction !== null,
      independent: args.independent, remaining: args.fence.remainingBudget(), revision: args.revision });
  };
  const spend = args => {
    if (!budget) return;
    try { args.fence.consume(budget === 'rows' ? { rows: 6000 } : { bytes: 9 * 1024 * 1024 }); }
    catch (error) {
      faults.push(error.result);
      if (!swallowBudget) throw error;
    }
  };
  const core = {
    async preparePagedCensusObservation(args) {
      record('prepare', args); spend(args);
      if (replaceControlOnPrepare) activeRecords().set(CONTROL_ID, clone(replaceControlOnPrepare));
      return { verified: true, transactionPending: false, admission };
    },
    async collectPagedCensusSnapshotInTransaction(args) {
      record('snapshot', args); spend(args);
      assert.equal(args.admission, admission);
      observed = { verified: true, transactionPending: true, invalidReceipts: 0,
        schemaVersion: 'pbk-runtime-source-evidence-v2', fingerprint: HEX,
        inventory: { protocol: 'paged-v2', generation: 1 }, historyCompleteFrom: null,
        coverage: { segmentRef: HEX, forwardOnlyFrom: new Date(START).toISOString(), gapFloor: null,
          gapFingerprint: HEX, intersectingGaps: 0, continuous: true }, sources: [] };
      return observed;
    },
    async readPagedCensusIntervalRoots(args) {
      record('intervals', args);
      assert.equal(args.snapshot, observed);
      return args.reports.map(() => HEX);
    },
    async readPagedCensusInventory(args) {
      record('inventory', args);
      return { verified: !(failIndependent && args.independent), fixture: 'inventory' };
    },
  };
  const query = async ({ text, values = [], query_timeout }) => {
    statements.push(text);
    queryTimeouts.push(query_timeout);
    // Simulate elapsed synchronous work while the timer's macrotask cannot run.
    if (stallFirstQueryMs && statements.length === stallQuery) {
      vmMonotonic += stallFirstQueryMs;
      if (rejectStalledQuery) throw new Error('Fixture synchronous overdue query rejection');
    }
    if (text.startsWith('BEGIN')) {
      assert.equal(transaction, null, 'No nested transaction is supported by this fixture');
      // Fixture writes replace rows; a copy-on-write map is enough for rollback.
      transaction = new Map(records);
      return { rows: [] };
    }
    if (text === 'COMMIT') { assert(transaction); records = transaction; transaction = null; return { rows: [] }; }
    if (text === 'ROLLBACK') { transaction = null; return { rows: [] }; }
    if (text.includes('set_config(')) return { rows: [{ configuration: true }] };
    if (text.includes('pg_try_advisory')) return { rows: [{ acquired: true }] };
    if (text.includes('clock_timestamp() AS coverage_now')) return { rows: [{ coverage_now: new Date(wall) }] };
    if (text.startsWith('INSERT INTO public.pbk_eval_runs')) {
      const row = { id: values[0], tenant_id: 'pbk', suite_name: values[1], ok: false, total: 0, passed: 0,
        failed: 0, report: JSON.parse(values[2]), source: values[3], created_at: values[4] };
      writes.push(row.suite_name);
      activeRecords().set(row.id, row);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('WHERE id=$1')) {
      const row = activeRecords().get(values[0]);
      return { rows: row ? [row] : [] };
    }
    if (text.includes('WHERE tenant_id=') && /LIMIT 2\b/.test(text)) {
      return { rows: [...activeRecords().values()].filter(r => r.suite_name === 'runtime_coverage_control_v1') };
    }
    const checkpoints = [...activeRecords().values()].filter(r => r.suite_name === 'runtime_coverage_v1')
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    if (text.includes('SELECT EXISTS')) {
      return { rows: [{ newer: checkpoints.some(r => r.created_at > values[2]) }] };
    }
    if (text.includes('SELECT COUNT(*) AS count') || text.includes('ORDER BY created_at,id LIMIT 2001')) {
      const [,, lower, upper, oldest, headId] = values;
      const left = checkpoints.filter(r => r.created_at <= lower && r.created_at >= oldest).at(-1)?.created_at;
      const selected = checkpoints.filter(r => r.created_at > lower && r.created_at <= upper
        || r.created_at === left || r.id === headId);
      return text.includes('SELECT COUNT(*) AS count')
        ? { rows: [{ count: selected.length, bytes: Buffer.byteLength(JSON.stringify(selected)) }] }
        : { rows: selected.slice(0, 2001) };
    }
    throw new Error('Unexpected parent SQL in isolated wiring fixture');
  };
  const imports = {
    'node:crypto': crypto,
    'node:diagnostics_channel': { channel },
    './skill-governance-store.mjs': { canonicalJson },
    './runtime-evidence-context.mjs': { getRuntimeEvidenceContext: () => ({ classification: 'operator_chat' }) },
    './runtime-source-evidence.mjs': {
      prepareRuntimeSourceObservation: () => { throw new Error('Legacy adapter reached unexpectedly'); },
      collectRuntimeSourceSnapshotInTransaction: () => { throw new Error('Legacy adapter reached unexpectedly'); },
    },
    './runtime-paged-census.mjs': core,
  };
  const context = stallFirstQueryMs ? createContext({ Buffer, AbortController,
    process: { env: {} }, performance: { now: () => vmMonotonic }, clearTimeout,
    setTimeout: (callback, ms) => setTimeout(() => { timerCallbacks++; callback(); }, ms) }) : undefined;
  const module = new SourceTextModule(sourceFor(mutation), { context });
  await module.link(specifier => {
    assert(Object.hasOwn(imports, specifier), 'Unexpected import must not escape the isolated fixture');
    const entries = Object.entries(imports[specifier]);
    return new SyntheticModule(entries.map(([name]) => name), function () {
      for (const [name, value] of entries) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  let acquisitions = 0;
  const pool = { connect: async () => {
    acquisitions++;
    return { query, release: destroy => { releases.push(destroy); if (destroy) transaction = null; } };
  } };
  const input = { pool, secret: 'explicit-isolated-parent-wiring-fixture', revision: 'a'.repeat(40),
    protocol: 'paged-v2', bootId: 'fixture', health: HEALTH, now: () => wall, monotonicNow: () => wall - START + 100 };
  const call = (api, extra = {}) => module.namespace[api]({ ...input,
    ...(api === 'verifyRuntimeCoverageReference' ? { reference: clone(seed.reference) } : {}), ...extra });
  return { call, trace, statements, releases, faults, writes, queryTimeouts, checkpointCount,
    get simulatedElapsedMs() { return vmMonotonic - 100; },
    get timerCallbacks() { return timerCallbacks; },
    get acquisitions() { return acquisitions; },
    get fence() { return operationFence; },
    get client() { return operationClient; },
    advance(ms = 60000) { wall += ms; },
    clearTrace() { trace.length = 0; operationFence = undefined; operationClient = undefined; },
    snapshot(reference) { return { wall, records: [...records].map(([id, row]) => [id, clone(row)]), reference: clone(reference) }; },
  };
}

beforeAll(async () => {
  // Seed a virtual day through the real parent writer once; no core or DB work occurs.
  const fixture = await createHarness({ mutation: 'none' });
  let previous;
  for (let sample = 0; sample <= 1440; sample++) {
    fixture.clearTrace();
    const result = await fixture.call('appendRuntimeCoverageCheckpoint', { previous });
    assert.equal(result.verified, true, result.result);
    previous = result.report;
    if (sample < 1440) fixture.advance();
  }
  fixture.clearTrace();
  const result = await fixture.call('readRuntimeCoverage');
  assert.equal(result.verified, true, result.result);
  assert.equal(result.proof.checkpointCount, 1441);
  day = fixture.snapshot(result.proof.reference);
}, 30000);

const apis = ['appendRuntimeCoverageCheckpoint', 'readRuntimeCoverage', 'verifyRuntimeCoverageReference'];
const cases = apis.flatMap(api => ['rows', 'bytes'].map(budget => [api, budget]));

test('query deadline rejects a 2001ms synchronous stall before the timer callback runs', async () => {
  const fixture = await createHarness({ stallFirstQueryMs: 2001 });
  const result = await fixture.call('appendRuntimeCoverageCheckpoint');
  assert.equal(fixture.simulatedElapsedMs, 2001);
  assert.equal(fixture.timerCallbacks, 0, 'Promise work resolves before the timeout callback can execute');
  assert.equal(result.verified, false, 'A late query result must not become a verified checkpoint');
  assert.equal(result.result, 'coverage_operation_abandoned');
  assert.deepEqual(fixture.statements, ['BEGIN ISOLATION LEVEL REPEATABLE READ']);
  assert.deepEqual(fixture.queryTimeouts, [2000]);
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.checkpointCount(), 0);
  assert.equal(fixture.trace.length, 0);
  assert.deepEqual(fixture.releases, [true]);
});

test.each([1, 2])('query deadline poisons synchronous rejection after 2001ms in query %s without cleanup SQL', async stallQuery => {
  const fixture = await createHarness({ stallFirstQueryMs: 2001, stallQuery, rejectStalledQuery: true });
  const result = await fixture.call('appendRuntimeCoverageCheckpoint');
  assert.equal(fixture.simulatedElapsedMs, 2001);
  assert.equal(fixture.timerCallbacks, 0, 'Rejection reaches Promise.race before the timeout callback');
  assert.equal(fixture.statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ');
  if (stallQuery === 2) assert.match(fixture.statements[1], /^SELECT set_config\(/);
  assert.equal(fixture.statements.length, stallQuery, 'An overdue rejection must not enqueue ROLLBACK or other SQL');
  assert.deepEqual(fixture.releases, [true], 'An overdue rejected query must destroy, not recycle, its client');
  assert.equal(result.verified, false);
  assert.equal(result.result, 'coverage_operation_abandoned');
  assert.deepEqual(fixture.queryTimeouts, Array(stallQuery).fill(2000));
  assert.deepEqual(fixture.writes, []);
  assert.equal(fixture.checkpointCount(), 0);
  assert.equal(fixture.trace.length, 0);
});

test.each(cases)('%s poisons cumulative %s budget before any checkpoint write', async (api, budget) => {
  const fixture = await createHarness({ seed: api === apis[0] ? undefined : day, budget });
  const before = fixture.checkpointCount();
  const result = await fixture.call(api);
  assert.equal(result.result, 'coverage_operation_budget_exceeded');
  assert.equal(result.verified, false);
  assert.equal(fixture.checkpointCount(), before);
  assert.equal(fixture.writes.includes('runtime_coverage_v1'), false);
  assert.deepEqual(fixture.trace.map(t => t.name), ['prepare', 'snapshot']);
  assert.equal(fixture.trace[0].fence, fixture.trace[1].fence);
  assert.equal(fixture.fence.signal.aborted, true);
  assert.deepEqual(fixture.releases, [true]);
  const statements = fixture.statements.length;
  await assert.rejects(fixture.client.query({ text: 'SELECT forbidden_late_continuation' }), /coverage_operation_abandoned/);
  assert.throws(() => fixture.fence.remainingBudget(), /coverage_operation_abandoned/);
  assert.equal(fixture.statements.length, statements, 'Poisoned continuation must not reach the raw client');
});

test.each(['rows', 'bytes'])('caught %s overrun cannot unpoison the inherited fence', async budget => {
  const fixture = await createHarness({ budget, swallowBudget: true });
  const result = await fixture.call(apis[0]);
  assert.deepEqual(fixture.faults, ['coverage_operation_budget_exceeded']);
  assert.equal(result.result, 'coverage_operation_abandoned');
  assert.equal(fixture.writes.includes('runtime_coverage_v1'), false);
  assert.equal(fixture.checkpointCount(), 0);
  assert.deepEqual(fixture.releases, [true]);
});

test.each(apis)('%s reuses its RR view but independently verifies inventory after commit', async api => {
  const fixture = await createHarness({ seed: api === apis[0] ? undefined : day });
  const result = await fixture.call(api);
  assert.equal(result.verified, true, result.result);
  assert.deepEqual(fixture.trace.map(t => t.name), ['prepare', 'snapshot', 'intervals', 'inventory', 'inventory']);
  for (const step of fixture.trace) {
    assert.equal(step.fence, fixture.fence);
    assert.equal(step.client, fixture.client);
    assert.equal(step.revision, 'a'.repeat(40));
  }
  assert.deepEqual(fixture.trace.map(t => t.inTransaction), [false, true, true, true, false]);
  const [inRR, afterCommit] = fixture.trace.slice(-2);
  assert.equal(inRR.independent, false);
  assert.equal(afterCommit.independent, true);
  assert(afterCommit.remaining.rows < inRR.remaining.rows, 'Readback cannot reset the row budget');
  assert(afterCommit.remaining.bytes < inRR.remaining.bytes, 'Readback cannot reset the byte budget');
  assert.equal(fixture.fence.signal.aborted, false);
  if (api !== apis[0]) {
    assert.equal(result.proof.checkpointCount, 1441);
    assert.equal(result.proof.instrumentation, 'runtime-paged-census-v2');
    assert.equal(result.diagnostics.organicCompletions, 0);
    assert.equal(result.diagnostics.fleetQualified, false);
  }
});

test.each(apis)('%s denies a failed independent postcommit inventory read', async api => {
  const fixture = await createHarness({ seed: api === apis[0] ? undefined : day, failIndependent: true });
  const result = await fixture.call(api);
  assert.equal(result.verified, false);
  assert.equal(result.result, 'coverage_source_readback_unverified');
  assert.equal(fixture.trace.at(-1).inTransaction, false);
  assert.equal(fixture.trace.at(-1).independent, true);
});

test.each([
  ['protocol', { protocol: 'legacy-v1' }], ['revision', { revision: 'b'.repeat(40) }], ['boot', { bootId: 'other-boot' }],
])('active lease rejects %s substitution before source work or writes', async (_name, extra) => {
  const fixture = await createHarness({ seed: day });
  const result = await fixture.call(apis[0], extra);
  assert.equal(result.result, 'coverage_lease_busy');
  assert.equal(result.verified, false);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.trace.length, 0);
  assert.equal(fixture.checkpointCount(), 1441);
});

test('closing transaction rejects a substituted signed lease before collecting sources', async () => {
  const fixture = await createHarness({ seed: day, replaceControlOnPrepare: day.records.find(([id]) => id === CONTROL_ID)[1] });
  const result = await fixture.call(apis[0]);
  assert.equal(result.result, 'coverage_lease_lost');
  assert.equal(result.verified, false);
  assert.deepEqual(fixture.trace.map(t => t.name), ['prepare']);
  assert.equal(fixture.writes.includes('runtime_coverage_v1'), false);
  assert.equal(fixture.checkpointCount(), 1441);
});

test.each([
  ['protocol', { protocol: 'legacy-v1' }], ['revision', { revision: 'b'.repeat(40) }],
])('historical reference rejects %s substitution before acquiring a client', async (_name, extra) => {
  const fixture = await createHarness({ seed: day });
  const result = await fixture.call('verifyRuntimeCoverageReference', extra);
  assert.equal(result.result, 'coverage_reference_unverified');
  assert.equal(result.verified, false);
  assert.equal(fixture.acquisitions, 0);
  assert.equal(fixture.trace.length, 0);
});

test.each([
  ['protocol', { protocol: 'legacy-v1' }], ['revision', { revision: 'b'.repeat(40) }],
])('current coverage rejects %s substitution before source work', async (_name, extra) => {
  const fixture = await createHarness({ seed: day });
  const result = await fixture.call('readRuntimeCoverage', extra);
  assert.equal(result.result, 'coverage_latest_unverified');
  assert.equal(result.verified, false);
  assert.equal(fixture.trace.length, 0);
  assert.equal(fixture.writes.length, 0);
});
