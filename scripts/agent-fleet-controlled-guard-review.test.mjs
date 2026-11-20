import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { PGlite } from '@electric-sql/pglite';
import { controlledExecution, createScopedState, createControlledPool, remapControlledSql,
  assertControlledToolAllowed } from './controlled-execution-scope.mjs';
import { createControlledAgentStorage, saveControlledAgentResult, readControlledAgentQualification } from './controlled-agent-storage.mjs';
import { isAgentHandlerCompletion } from './agent-fleet-measurement.mjs';
import { runControlledAgentWorkflow } from './controlled-agent-workflow.mjs';
import { workflowTestOutputs } from './controlled-workflow-test-fixtures.mjs';
import { isDirectQualificationFounder } from './release-qualification.mjs';

const monolith = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
function actualFunction(name) {
  const start = monolith.indexOf(`async function ${name}(`);
  assert(start >= 0, `Missing ${name}`);
  const end = monolith.indexOf('\n}', start) + 2;
  assert(end > start, `Incomplete ${name}`);
  return monolith.slice(start, end);
}

test('independent review: actual SQL writes and reread leave organic sentinel untouched', async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.calls(id text PRIMARY KEY, transcript text); INSERT INTO public.calls VALUES ('organic-sentinel', 'Never export'); CREATE SCHEMA pbk_q_abc; CREATE TABLE pbk_q_abc.calls(LIKE public.calls);");
    const scope = { schema: 'pbk_q_abc', tables: new Set(['calls']), blockedSql: 0 };
    const pool = createControlledPool(db, scope);
    await pool.query('INSERT INTO public.calls(id, transcript) VALUES ($1, $2)', ['fixture', 'Synthetic transcript']);
    await pool.query('UPDATE public.calls SET transcript = $1 WHERE id = $2', ['Synthetic update', 'fixture']);
    const readback = await pool.query('SELECT id, transcript FROM public.calls');
    assert.deepEqual(readback.rows.map((row) => [row.id, row.transcript]), [['fixture', 'Synthetic update']]);
    const organic = await db.query('SELECT id, transcript FROM public.calls');
    assert.deepEqual(organic.rows.map((row) => [row.id, row.transcript]), [['organic-sentinel', 'Never export']]);
    await pool.drain();
  } finally { await db.close(); }
}, 30000);

for (const sql of [
  "SELECT (SELECT pg_notify('customer', 'contact')) FROM public.calls",
  "INSERT INTO public.calls(id) SELECT 'value'::public.customer_type",
  "UPDATE public.calls SET transcript = current_setting('secret')",
  "DELETE FROM public.calls WHERE id IN (SELECT id FROM public.customers)",
  "SELECT * FROM public.calls; SELECT * FROM other.calls",
  "SELECT ARRAY['public.calls'::regclass]",
  "SELECT * FROM public.calls WHERE public.send_message(id)",
  'COPY public.calls TO PROGRAM \'contact\'',
  'SET search_path TO public',
  'CREATE TABLE public.export AS SELECT * FROM public.calls',
]) {
  test(`independent review rejects nested or alternate SQL escape: ${sql}`, () => {
    assert.throws(() => remapControlledSql(sql, 'pbk_q_abc', new Set(['calls'])));
  });
}

test('independent review: overlapping asynchronous scopes cannot mutate organic or sibling state', async () => {
  const organic = { calls: [{ id: 'organic' }], status: {} };
  const state = createScopedState(organic);
  let release;
  const gate = new Promise((done) => { release = done; });
  const first = controlledExecution.run({ state: { calls: [{ id: 'first' }], status: {} } }, async () => {
    await gate;
    assert.equal(state.calls[0].id, 'first');
    state.calls[0].id = 'first-changed';
    for (const tool of ['telnyx_call', 'telnyx_sms', 'sendColdEmail', 'sendDocuSign', 'createApproval', 'addPbkMemory',
      'startNurtureSequence', 'processDueNurtureSteps', 'executeLocalCommand', 'admin_update_env_var']) {
      assert.throws(() => assertControlledToolAllowed(tool, { dryRun: true, approved: true }));
    }
  });
  const second = controlledExecution.run({ state: { calls: [{ id: 'second' }], status: {} } }, async () => {
    state.calls[0].id = 'second-changed';
    release();
    await Promise.resolve();
    assert.equal(state.calls[0].id, 'second-changed');
  });
  await Promise.all([first, second]);
  assert.equal(state.calls[0].id, 'organic');
  assert.equal(organic.calls.length, 1);
});

test('monolith wiring: actual analyzer never selects organic call under controlled scope', async () => {
  const state = { calls: [{ id: 'customer', transcript: 'Private' }, { id: 'fixture', transcript: 'Synthetic' }], callAnalyses: [] };
  const analyzed = [];
  const sandbox = vm.createContext({ controlledExecution, state, sortNewest: (rows) => rows,
    toNumber: (value, fallback) => Number(value) || fallback,
    buildCallFailureAnalysis: (call) => { analyzed.push(call.id); return { id: `analysis-${call.id}`, callId: call.id }; },
    upsertById: (_state, _collection, value) => state.callAnalyses.push(value), persistCallAnalysisToPg: async () => {},
    limitStateArrays() {}, addActivity() {}, makeActivity: (value) => value, persistState: async () => {}, summarizeFailureTags: () => ({}) });
  vm.runInContext(actualFunction('analyzeRecentAvaCalls'), sandbox);
  const output = await controlledExecution.run({ fixture: { callId: 'fixture' } }, () => sandbox.analyzeRecentAvaCalls({ limit: 80 }));
  assert.deepEqual(analyzed, ['fixture']);
  assert.equal(output.analyzed, 1);
  assert.equal(output.analyses[0].callId, 'fixture');
});

test('monolith wiring: actual event publisher does not reach shared event bus under controlled scope', async () => {
  let dispatched = false;
  const sandbox = vm.createContext({ controlledExecution, console,
    publishEventBusEvent: async () => { dispatched = true; } });
  vm.runInContext(actualFunction('publishPbkEvent'), sandbox);
  const output = await controlledExecution.run({}, () => sandbox.publishPbkEvent('customer_contact', {}, 'test'));
  assert.equal(dispatched, false);
  assert.equal(output.skipped, true);
});

test('monolith wiring: fetch denial happens inside async scope before any network dispatch', async () => {
  const start = monolith.indexOf('const unscopedFetch = globalThis.fetch;');
  const end = monolith.indexOf('\n};', start) + 3;
  assert(start >= 0 && end > start);
  let dispatched = false;
  const sandbox = vm.createContext({ controlledExecution, fetch: async () => { dispatched = true; } });
  vm.runInContext(monolith.slice(start, end), sandbox);
  const scope = { blockedNetwork: 0 };
  await controlledExecution.run(scope, async () => {
    await Promise.resolve();
    await assert.rejects(sandbox.fetch('https://example.com/contact'), /controlled_network_blocked/);
  });
  assert.equal(dispatched, false);
  assert.equal(scope.blockedNetwork, 1);
});

test('independent durable review rejects an ID-only task and corrupted stored run identity', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE public.lead_profiles(id text PRIMARY KEY); CREATE TABLE public.pbk_tasks(id text PRIMARY KEY, metadata jsonb, status text, created_at timestamptz, updated_at timestamptz); CREATE TABLE public.bridge_state(id text PRIMARY KEY, data jsonb, updated_at timestamptz);');
    const storage = await createControlledAgentStorage(db, { tables: ['lead_profiles', 'pbk_tasks', 'bridge_state'] });
    const pool = createControlledPool(db, { ...storage, blockedSql: 0 });
    await pool.query('INSERT INTO public.pbk_tasks(id,metadata) VALUES($1,$2::jsonb)', ['task-only-id', JSON.stringify({ workOrder: { id: 'task-only-id' } })]);
    const data = { agentId: 'ava', runId: 'corrupted-run', workOrderId: 'task-only-id', contextId: 'missing-context',
      leadId: 'wrong-lead', callId: 'wrong-call', completed: true, operational: true, completedAt: new Date().toISOString(),
      criteria: { conversationalResponse: true }, evidenceRecordIds: ['nonexistent-record'] };
    await saveControlledAgentResult(db, storage, 'ava', data, { ok: true }, {});
    const report = await readControlledAgentQualification(db, storage.runId);
    assert.equal(report.agents[0].durable, false, 'ID-only workorder cannot prove durable run/agent/context/output correlation');
  } finally { await db.close(); }
}, 30000);

test('actual controlled execution loop enters atomic fixture scope for every one of eleven handlers', async () => {
  const calls = [];
  const saved = [];
  const fixture = { runId: 'pbk-q-unit', leadId: 'fixture-lead', callId: 'fixture-call', leadName: 'Fixture',
    sourceUpdatedAt: new Date().toISOString(), transcript: 'Synthetic relocation conversation',
    bant: { budget: '100000', authority: 'owner', need: 'moving', timeline: '30 days', urgency: 'deadline' } };
  const storage = { runId: fixture.runId, schema: 'pbk_q_abc', fixture, tables: new Set() };
  const outputs = workflowTestOutputs(fixture);
  const stored = new Map();
  const sandbox = vm.createContext({ controlledExecution, isAgentHandlerCompletion, runControlledAgentWorkflow,
    readControlledWorkflowPredecessor: async (_pool, _storage, id) => stored.get(id), BRIDGE_API_KEY: 'unit-key', DATABASE_URL: 'unit-only',
    runtimeStateBootstrap: { ready: true }, getPgPool: () => ({}), createControlledAgentStorage: async () => storage,
    process: { env: {} }, BUILD_REVISION: 'unit-revision', buildDefaultState: () => ({ status: {}, calls: [{ id: 'seed' }],
      approvals: [{ id: 'seed' }], brainDocs: [{ id: 'seed' }], agentTasks: [], leadImports: [] }),
    buildDefaultAgentFleet: () => [], getCurrentAgentRegistry: () => [], createControlledPool: () => ({ drain: async () => {} }),
    invokeAgentFromRegistry: async ({ agentId, payload }) => {
      const scope = controlledExecution.getStore();
      assert(scope, `${agentId}: invocation escaped scope`);
      assert.equal(scope.agentId, agentId);
      assert.equal(scope.state.calls.length, 1);
      assert.equal(scope.state.calls[0].id, fixture.callId);
      assert.equal(scope.state.approvals.length, 0);
      assert.equal(payload.diagnostic, true);
      assert.equal(payload.operational, false);
      assert.equal(payload.phone, '');
      assert.equal(payload.email, '');
      for (const key of ['transcript', 'bant', 'score', 'stage']) {
        if (!Object.hasOwn(scope.workflowInput, key)) assert.equal(Object.hasOwn(payload, key), false, `${agentId}: stale fixture ${key}`);
      }
      calls.push(agentId);
      return { output: outputs[agentId], workOrder: { id: `work-${agentId}` }, pbkIntelligenceContext: { contextId: `${fixture.runId}:${agentId}` } };
    }, isoNow: () => new Date().toISOString(),
    saveControlledAgentResult: async (_pool, _storage, agentId, data, output) => {
      assert.equal(controlledExecution.getStore(), undefined); saved.push(agentId);
      stored.set(agentId, { agentId, workOrderId: data.workOrderId, output });
    },
    readControlledAgentQualification: async () => ({ runId: fixture.runId }),
  });
  vm.runInContext(`let controlledQualificationRunning = false;\n${actualFunction('executeControlledAgentQualification')}`, sandbox);
  await sandbox.executeControlledAgentQualification();
  assert.equal(calls.length, 11);
  assert.equal(new Set(calls).size, 11);
  assert.deepEqual(saved, calls);
  assert.equal(calls.at(-1), 'hermes');
});

for (const [scenario, headers, expectedStatus] of [
  ['missing-auth', {}, 403],
  ['team-auth', { 'x-pbk-team-token': 'unit-team' }, 403],
  ['bearer-with-team-token', { authorization: 'Bearer unit-key', 'x-pbk-team-token': 'unit-team' }, 403],
  ['bearer-with-proxy-header', { authorization: 'Bearer unit-key', 'x-pbk-netlify-proxy': 'pbk-bridge-proxy' }, 403],
  ['bearer-with-empty-team-header', { Authorization: 'Bearer unit-key', 'X-PBK-Team-Token': '' }, 403],
  ['bearer-with-empty-proxy-header', { Authorization: 'Bearer unit-key', 'X-PBK-Netlify-Proxy': '' }, 403],
  ['client-fixture', { authorization: 'Bearer unit-key' }, 400],
  ['client-flags', { authorization: 'Bearer unit-key' }, 400],
  ['empty-post', { authorization: 'Bearer unit-key' }, 200],
]) {
  test(`actual qualification route enforces founder auth and server fixture only: ${scenario}`, async () => {
    const start = monolith.indexOf("    if (pathname === '/api/agents/controlled-qualification') {");
    const end = monolith.indexOf("\n    if (request.method === 'GET' && matchesPath(pathname, ['/api/agents/orchestration'", start);
    assert(start >= 0 && end > start);
    let executed = false;
    let bodyReads = 0;
    let status;
    let payload;
    const body = scenario === 'client-fixture' ? { leadId: 'customer' } : scenario === 'client-flags' ? { dryRun: true, approved: true } : {};
    const sandbox = vm.createContext({ isDirectQualificationFounder, BRIDGE_API_KEY: 'unit-key', pathname: '/api/agents/controlled-qualification',
      request: { method: 'POST', headers },
      response: {}, url: new URL('https://example.com/api/agents/controlled-qualification'),
      readBody: async () => { bodyReads++; return body; }, json: (_response, code, data) => { status = code; payload = data; },
      executeControlledAgentQualification: async () => { executed = true; return {}; },
    });
    vm.runInContext(`async function reviewedRoute() {\n${monolith.slice(start, end)}\n}`, sandbox);
    await sandbox.reviewedRoute();
    assert.equal(executed, scenario === 'empty-post');
    assert.equal(status, expectedStatus);
    assert.equal(bodyReads, expectedStatus === 403 ? 0 : 1, 'Founder authentication must precede body reads');
    if (expectedStatus === 403) assert.equal(payload.result, 'controlled_founder_auth_required');
    if (expectedStatus === 400) assert.equal(payload.result, 'controlled_server_fixture_only');
  });
}

async function persistedReviewCase(db, agentId, output, corruptWorkOrder = false) {
  await db.exec('CREATE TABLE public.lead_profiles(id text PRIMARY KEY); CREATE TABLE public.pbk_tasks(id text PRIMARY KEY, metadata jsonb, status text, created_at timestamptz, updated_at timestamptz); CREATE TABLE public.bridge_state(id text PRIMARY KEY, data jsonb, updated_at timestamptz);');
  const storage = await createControlledAgentStorage(db, { tables: ['lead_profiles', 'pbk_tasks', 'bridge_state'] });
  const fixture = storage.fixture;
  const contextId = `${storage.runId}:${agentId}`;
  const completedAt = new Date().toISOString();
  const workOrderId = `work-${agentId}`;
  const identity = { leadId: fixture.leadId, callId: fixture.callId, sourceUpdatedAt: fixture.sourceUpdatedAt };
  const metadata = { operational: false, workOrder: { id: workOrderId, agentId: corruptWorkOrder ? 'wrong-agent' : agentId,
    source: corruptWorkOrder ? 'unmarked' : 'controlled-qualification', payload: { leadId: fixture.leadId, callId: fixture.callId } },
    qualification: { ...identity, runId: storage.runId, agentId, contextId },
    executionEvidence: { operational: false, handlerCompletionVerified: true, completedAt }, pbkIntelligenceContext: { contextId } };
  const pool = createControlledPool(db, { ...storage, blockedSql: 0 });
  await pool.query("INSERT INTO public.pbk_tasks(id,metadata,status) VALUES($1,$2::jsonb,'complete')", [workOrderId, JSON.stringify(metadata)]);
  const data = { ...identity, agentId, runId: storage.runId, workOrderId, contextId, completedAt, operational: false };
  await saveControlledAgentResult(db, storage, agentId, data, output, { contextId, identity });
  return readControlledAgentQualification(db, storage.runId);
}

test('durable correlation rejects mismatched actual workorder agent and unmarked source', async () => {
  const db = new PGlite();
  try {
    const report = await persistedReviewCase(db, 'ava', { ok: true, routedTo: 'agent_brain', response: { ok: true, answer: 'Fixture answer' } }, true);
    assert.equal(report.agents[0].durable, false);
  } finally { await db.close(); }
}, 30000);

test('prosody decision persistence requires an actual decision artifact, not correlated output JSON only', async () => {
  const db = new PGlite();
  try {
    const report = await persistedReviewCase(db, 'prosody-tuner', { ok: true, result: 'prosody_advice',
      prosody: { emotion: 'worried', speed: 0.9, stability: 0.6, similarityBoost: 0.8 } });
    assert.equal(report.agents[0].criteria.fixtureDecisionPersisted, false);
  } finally { await db.close(); }
}, 30000);
