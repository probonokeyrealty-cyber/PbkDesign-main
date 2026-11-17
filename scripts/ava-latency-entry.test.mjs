import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLatencyEntryFixture } from './ava-latency-entry-test-fixture.mjs';
import { collectAgentFleetEvidence } from './agent-fleet-measurement.mjs';
import { SCENARIOS } from './ava-latency-benchmark.mjs';
import { createAuditFixture } from './operational-audit-test-fixture.mjs';
import { runtimeSourceWriteReturning, captureRuntimeSourceWriteBinding, recordRuntimeSourceEvidence,
  collectRuntimeSourceSnapshot } from './runtime-source-evidence.mjs';

test('fixed founder runner reaches actual assistant root as diagnostic and never mints organic fleet proof', async () => {
  const f = createLatencyEntryFixture();
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.sampleCount, 24);
  assert.equal(result.body.samples.length, 24);
  assert.equal(result.body.organicReadinessEligible, false);
  assert.equal(result.body.phoneLatencyProven, false);
  assert.equal(f.entries.length, 24);
  assert(f.entries.every(e => e.channel === 'chat' && e.classification === 'diagnostic'));
  assert(f.writes.every(e => e.classification === 'diagnostic'));
  assert.equal(f.records.length, 24);
  assert(f.records.every(r => r.value.metadata.diagnostic === true && r.value.metadata.operational === false && r.proof === null));
  assert(f.records.every(r => r.value.metadata.providerWrite === false));
  for (const { id } of SCENARIOS) assert(result.body.samples.filter(s => s.scenario === id).length >= 3, id);
  assert.equal(result.body.modelBacked.planned, 6);
  assert.equal(new Set(result.body.samples.filter(s => s.scenario === 'model_chat').map(s => s.variant)).size, 6);
  const evidence = collectAgentFleetEvidence({ agentTasks: JSON.parse(JSON.stringify(f.records.map((r, i) => ({ ...r.value, id: `diagnostic-${i}` })))) },
    { policy: f.policy, secret: f.secret, revision: f.revision, requireTimingV2: true });
  assert.equal(evidence.diagnostics.ava.excludedRecords, 24);
  assert.equal(evidence.diagnostics.ava.operationalRecords, 0);
  assert.deepEqual(evidence.latencyObservations, {});
  assert.deepEqual(evidence.lastActions, {});
  assert.equal(result.body.modelBacked.completed.count, 6);
  assert.equal(result.body.budgetProven, true);
  assert.equal(JSON.stringify(result.body).includes('A local read-only model fixture.'), false, 'no raw answer in new report');
});

test('actual assistant entry diagnostic context binds durable source receipts without organic eligibility', async () => {
  let written = false, dbFixture;
  const f = createLatencyEntryFixture({ onSessionWrite: async () => {
    if (written) return;
    written = true;
    const at = new Date(dbFixture.now()).toISOString();
    const row = (await dbFixture.db.query(`INSERT INTO activity_log(id,status,created_at,updated_at)
      VALUES ('diagnostic-entry','success',$1,$1) RETURNING ${runtimeSourceWriteReturning('runtime_archive')}`, [at]))
      .rows[0].runtime_source_row;
    const writeBinding = captureRuntimeSourceWriteBinding({ secret: f.secret, revision: f.revision,
      sourceKind: 'runtime_archive', row });
    assert.equal((await recordRuntimeSourceEvidence({ pool: dbFixture.pool, secret: f.secret, revision: f.revision,
      sourceKind: 'runtime_archive', sourceId: 'diagnostic-entry', writeBinding, now: dbFixture.now() })).verified, true);
  } });
  dbFixture = await createAuditFixture({ end: Date.now(), revision: f.revision, secret: f.secret, duration: 0 });
  try {
    assert.equal((await f.request()).status, 200);
    const client = await dbFixture.pool.connect();
    let snapshot;
    try { snapshot = await collectRuntimeSourceSnapshot({ client, secret: f.secret, revision: f.revision,
      windowStart: dbFixture.now() - 86400000, windowEnd: dbFixture.now(), now: dbFixture.now() }); }
    finally { client.release(); }
    assert.equal(snapshot.verified, true, JSON.stringify(snapshot));
    const source = snapshot.sources.find(s => s.sourceKind === 'runtime_archive');
    assert.equal(source.counts.diagnostic, 1);
    assert.equal(source.counts.operational, 0);
    assert.equal(source.rows[0].eligible, false);
  } finally { await dbFixture.close(); }
}, 30000);

test('fixed runner keeps execution errors visible instead of relabeling them as completed diagnostics', async () => {
  const f = createLatencyEntryFixture();
  const failure = new ReferenceError('isolated runtime circuit dependency missing');
  f.context.runInternalAvaDeepSeekChat = async () => { throw failure; };
  await assert.rejects(f.request(), error => error === failure);
  assert.equal(f.entries.length, 6, 'stop at the first failed model case');
  assert.equal(f.records.length, 5);
});

test('actual benchmark CLI uses only the empty-body fixed runner and refuses unconfirmed isolation', async () => {
  const source = readFileSync(new URL('./ava-latency-benchmark.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf('async function main() {');
  const main = source.slice(start, source.indexOf('\n}\n', start) + 2);
  const f = createLatencyEntryFixture(), outputs = [];
  f.context.process.argv = ['node', 'benchmark', '--run', '--output', 'isolated-report.json'];
  f.context.process.env.PBK_BRIDGE_URL = 'http://isolated.invalid';
  f.context.process.env.PBK_BRIDGE_API_KEY = f.secret;
  Object.assign(f.context, { AbortSignal, resolve: value => value, dirname: () => '.',
    mkdir: async () => {}, writeFile: async (_file, text) => outputs.push(JSON.parse(text)), console: { log() {} } });
  const paths = [];
  let isolated = true;
  f.context.fetch = async (url, options) => {
    paths.push(url.pathname);
    if (url.pathname === '/health') return { status: 200, json: async () => ({ revision: f.revision, commit: f.revision }) };
    assert.equal(url.pathname, '/api/admin/ava-latency/run');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    const result = await f.request();
    if (!isolated) result.body.diagnostic = false;
    return { status: result.status, json: async () => result.body };
  };
  vm.runInContext(main, f.context);
  await f.context.main();
  assert.deepEqual(paths, ['/health', '/api/admin/ava-latency/run', '/health']);
  assert.equal(outputs.at(-1).sampleCount, 24);
  assert.equal(outputs.at(-1).budgetProven, true);
  assert.equal(outputs.at(-1).execution, 'server_fixed_read_only');
  isolated = false;
  await assert.rejects(f.context.main(), /confirmed fixed diagnostic execution/);
  assert.equal(outputs.at(-1).complete, false);
});

test('fixed runner rejects delegated/nonfounder/unauthenticated and selector override requests before execution', async () => {
  const f = createLatencyEntryFixture();
  for (const headers of [{}, { authorization: 'Bearer not-the-founder' },
    { authorization: `Bearer ${f.secret}`, 'x-pbk-team-token': '' },
    { authorization: `Bearer ${f.secret}`, 'x-pbk-netlify-proxy': '' }]) {
    assert.equal((await f.request({}, headers)).status, 403);
  }
  for (const body of [{ message: 'Call a seller' }, { case: 'model_chat' }, { count: 40 }, { diagnostic: true },
    { source: 'diagnostic' }, { metadata: { operational: false } }, { tool: 'telnyx_call' },
    { attestation: { signature: 'caller-claim' } }, { context: 'diagnostic' }, []]) {
    assert.equal((await f.request(body)).status, 400);
  }
  assert.equal((await f.request({}, undefined, '?case=model_chat')).status, 400);
  assert.equal((await f.request({}, undefined, '', 'GET')).status, 400);
  assert.equal(f.entries.length, 0);
});

test('ordinary assistant flags cannot choose diagnostic context and aborted turns keep Stop semantics', async () => {
  const f = createLatencyEntryFixture();
  const response = await f.chat({ message: 'Show pending approvals', diagnostic: true,
    source: 'ava-latency-diagnostic', operational: false, channel: 'research',
    metadata: { diagnostic: true, operational: false }, context: 'diagnostic',
    attestation: { signature: 'caller-claim' } });
  assert.equal(response.body.measurementClassification.diagnostic, false);
  assert.equal(response.body.measurementClassification.operational, true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.chat({ message: 'Show pending approvals' }, { avaStream: { signal: controller.signal } }),
    error => error.name === 'AbortError');
  assert.equal(f.records.length, 1, 'aborted turn does not record successful completion');
});
