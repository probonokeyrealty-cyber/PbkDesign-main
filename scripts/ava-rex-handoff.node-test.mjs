import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';
import { runRexHandoff, readRexHandoff, rexLeadVersion, parseRexResearch, postgresRexHandoffStore } from './ava-rex-handoff.mjs';

const request = { owner: 'operator', requestId: 'request-1', market: 'Tampa, FL', leadId: 'lead-1' };
const evidence = { ok: true, result: 'live', responseId: 'resp_rex_fixture', answer: 'Check recorded sales.', citations: ['County data - https://example.com/sales'] };

function fixture() {
  const records = new Map();
  const store = {
    async claim(record) {
      if (records.has(record.id)) return false;
      records.set(record.id, { ...record, status: 'running' });
      return true;
    },
    async read(id) { return records.get(id); },
    async finish(id, token, result) {
      const record = records.get(id);
      if (record.status !== 'running' || record.token !== token) return false;
      Object.assign(record, result);
      return true;
    },
  };
  const context = { version: 'v1', run: async () => evidence };
  return { context, store, records, input: { ...request, store, readVersion: async () => context.version, research: market => context.run(market) } };
}

test('explicit public market syntax excludes street addresses and arbitrary commands', () => {
  assert.equal(parseRexResearch('Ask Rex to research Tampa, FL'), 'Tampa, FL');
  assert.equal(parseRexResearch('Ask Rex to research 10 Main St, FL'), null);
  assert.equal(parseRexResearch('Rex, send a contract'), null);
});

test('one invocation across concurrent requests and status reads', async () => {
  const { context, input } = fixture();
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  context.run = () => new Promise(resolve => { release = resolve; started(); });
  const first = runRexHandoff(input);
  await ready;
  const duplicate = await runRexHandoff(input);
  assert.equal(duplicate.status, 'running');
  assert.equal((await readRexHandoff(input)).status, 'running');
  release(evidence);
  const completed = await first;
  assert.equal(completed.status, 'complete');
  assert.equal(completed.id, duplicate.id);
  assert.match(completed.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(await readRexHandoff(input), completed);
  assert.equal(JSON.stringify(completed).includes(evidence.responseId), false);
  assert.equal((await runRexHandoff(input)).id, completed.id);
  assert.equal((await runRexHandoff({ ...input, market: 'Orlando, FL' })).status, 'conflict');
  assert.equal((await readRexHandoff({ ...input, owner: 'other' })).status, 'missing');
  assert.equal((await readRexHandoff({ ...input, leadId: 'another-lead' })).status, 'missing');
});

test('a cited response without a provider completion reference cannot be verified', async () => {
  const { input, context } = fixture();
  context.run = async () => ({ ...evidence, responseId: '' });
  const result = await runRexHandoff(input);
  assert.equal(result.status, 'unverified');
  assert.equal(result.answer, 'I could not verify the saved research result for this request.');
  assert.equal(result.verifiedAt, undefined);
  assert.deepEqual(await readRexHandoff(input), result);
});

test('readback rejects evidence changed after the completion was saved', async () => {
  const { input, records } = fixture();
  const result = await runRexHandoff(input);
  records.get(result.id).citations = ['https://example.com/replaced'];
  const readback = await readRexHandoff(input);
  assert.equal(readback.status, 'unverified');
  assert.equal(readback.citations, undefined);
  assert.equal(readback.verifiedAt, undefined);
});

test('readback rejects a receipt moved to a different request or lead', async () => {
  const { input, records } = fixture();
  const completed = await runRexHandoff(input);
  const record = records.get(completed.id);
  for (const change of [{ requestId: 'other-request' }, { leadId: '' }]) {
    records.set(completed.id, { ...record, ...change });
    const readback = await readRexHandoff({ ...input, leadId: change.leadId ?? input.leadId });
    assert.equal(readback.status, 'unverified');
    assert.equal(readback.citations, undefined);
  }
});

test('failure and ambiguous transport have distinct durable outcomes', async () => {
  const { input, context } = fixture();
  context.run = async () => ({ ok: false });
  assert.equal((await runRexHandoff(input)).status, 'failed');
  context.run = async () => { throw Error('transport interrupted'); };
  const next = { ...input, requestId: 'request-2' };
  assert.equal((await runRexHandoff(next)).status, 'reconciliation_required');
  context.run = async () => assert.fail('replay must not dispatch');
  assert.equal((await runRexHandoff(next)).status, 'reconciliation_required');
});

test('record and selected-comps changes hide stale evidence', async () => {
  const { input, context } = fixture();
  assert.equal((await runRexHandoff(input)).status, 'complete');
  context.version = 'v2';
  const result = await readRexHandoff(input);
  assert.equal(result.status, 'stale');
  assert.equal(result.answer, undefined);
  const lead = { property: { address: '123 Example St' }, analyzer: { recordedSales: { selectedIds: ['a'] } } };
  assert.notEqual(rexLeadVersion(lead), rexLeadVersion({ ...lead, analyzer: { recordedSales: { selectedIds: ['b'] } } }));
});

test('an exhausted provider balance is a saved failure with no replay', async () => {
  const { input, context } = fixture();
  context.run = async () => ({ ok: false, result: 'provider_quota_exhausted' });
  const failed = await runRexHandoff(input);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureReason, 'provider_quota_exhausted');
  context.run = async () => assert.fail('saved failure must not dispatch');
  assert.deepEqual(await runRexHandoff(input), failed);
});

test('expired claim fences off a late result', async () => {
  const { input, records, store } = fixture();
  let now = 10;
  const request = { ...input, now: () => now, leaseMs: 5 };
  request.research = async () => {
    now = 20;
    assert.equal((await readRexHandoff(request)).status, 'reconciliation_required');
    return evidence;
  };
  assert.equal((await runRexHandoff(request)).status, 'reconciliation_required');
  const [record] = records.values();
  assert.equal(await store.finish(record.id, record.token, { status: 'complete' }), false);
});

test('Postgres preserves an unconfirmed claim across bridge instances and rejects late writes', {
  skip: !process.env.PBK_REX_TEST_DATABASE_URL,
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.PBK_REX_TEST_DATABASE_URL });
  const other = new pg.Pool({ connectionString: process.env.PBK_REX_TEST_DATABASE_URL });
  try {
    await pool.query(`CREATE TABLE public.pbk_tasks (
      id text PRIMARY KEY, tenant_id text, from_agent text, to_agent text, task_type text,
      status text, correlation_id text, provider_writes text, summary text, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    )`);
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const first = { ...request, store: postgresRexHandoffStore(pool), readVersion: async () => 'v1',
      research: () => new Promise(resolve => { release = resolve; started(); }) };
    const second = { ...first, store: postgresRexHandoffStore(other), research: async () => assert.fail('unexpected dispatch') };
    const work = runRexHandoff(first);
    await ready;
    const same = await runRexHandoff(second);
    const differentKey = await runRexHandoff({ ...second, requestId: 'request-2' });
    assert.equal(same.id, differentKey.id);
    assert.equal(same.status, 'running');
    await other.query("UPDATE public.pbk_tasks SET metadata = metadata || '{\"expiresAt\":0}'::jsonb");
    assert.equal((await readRexHandoff(second)).status, 'reconciliation_required');
    release(evidence);
    assert.equal((await work).status, 'reconciliation_required');
    const blocked = await runRexHandoff({ ...second, requestId: 'request-3' });
    assert.equal(blocked.status, 'reconciliation_required');
    assert.equal(blocked.requestId, request.requestId);
    const { rows } = await other.query('SELECT count(*)::int AS total FROM public.pbk_tasks');
    assert.equal(rows[0].total, 1);
    const complete = await runRexHandoff({ ...first, market: 'Orlando, FL', requestId: 'request-4', research: async () => evidence });
    assert.equal(complete.status, 'complete');
    assert.equal((await readRexHandoff({ ...second, requestId: 'request-4', readVersion: async () => 'v2' })).status, 'stale');

    const store = postgresRexHandoffStore(pool);
    const id = 'locked-rex-fixture';
    const token = 'locked-worker';
    const expiresAt = Date.now() + 1500;
    assert.equal(await store.claim({ id, token, expiresAt, binding: id }), true);
    const lock = await other.connect();
    let late;
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT id FROM public.pbk_tasks WHERE id = $1 FOR UPDATE', [id]);
      late = store.finish(id, token, { status: 'complete', answer: 'Late result' });
      let waiting = false;
      while (!waiting && Date.now() < expiresAt) {
        const { rows: sessions } = await other.query(`SELECT 1 FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%public.pbk_tasks%'`);
        waiting = sessions.length > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 15));
      }
      assert.equal(waiting, true, 'Completion must reach the locked SQL row before the lease expires');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 30));
    } finally {
      await lock.query('COMMIT');
      lock.release();
    }
    assert.equal(await late, false, 'Lease must be checked again after waiting for the row lock');
    assert.equal((await store.read(id)).answer, undefined);
  } finally {
    await Promise.all([pool.end(), other.end()]);
  }
});

test('Ava chat starts one cited Rex request through the bridge and rereads its receipt', {
  skip: !process.env.PBK_REX_TEST_DATABASE_URL,
  timeout: 115_000,
}, async () => {
  const base = new URL(process.env.PBK_REX_TEST_DATABASE_URL);
  assert.equal(base.hostname, '127.0.0.1');
  const admin = new pg.Client({ connectionString: base.href });
  await admin.connect();
  try { await admin.query('CREATE DATABASE rex_bridge_fixture'); }
  finally { await admin.end(); }
  base.pathname = '/rex_bridge_fixture';

  const calls = [];
  const provider = createServer(async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString());
    calls.push({ requestId: req.headers['x-client-request-id'], path: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    if (body.input[1]?.content.includes('Orlando, FL')) {
      res.writeHead(429).end(JSON.stringify({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted' } }));
      return;
    }
    res.end(JSON.stringify({ id: evidence.responseId, status: 'completed', output: [
      { type: 'web_search_call', status: 'completed' },
      { type: 'message', content: [{ type: 'output_text', text: evidence.answer,
        annotations: [{ type: 'url_citation', url: 'https://example.com/county-data' }] }] },
    ] }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), 'pbk-rex-bridge-'));
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const preload = `
    import cp from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    cp.execFileSync = () => { throw Error('Fixture blocks Windows environment reads'); };
    syncBuiltinESMExports();
    const fetchImpl = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      if (new URL(url).origin !== ${JSON.stringify(providerUrl)}) throw Error('Fixture blocks external requests');
      return fetchImpl(url, init);
    };`;
  const apiKey = 'local-rex-test-fixture';
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'scripts/openclaw-local-server.mjs'], {
    env: { ...buildAgentRuntimeSmokeEnv(), PORT: String(port), HOST: '127.0.0.1',
      PBK_DATABASE_URL: base.href, PBK_OPENCLAW_STATE_DIR: dir, PBK_BRIDGE_API_KEY: apiKey,
      PBK_REDIS_ENABLED: '0', PBK_SUPABASE_ENABLED: '0',
      PBK_OPENAI_API_KEY: 'openai-provider-fixture', PBK_OPENAI_BASE_URL: providerUrl },
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  const exited = once(child, 'exit');
  child.stderr.resume();
  async function requestBridge(path, body) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 240 && !healthy; attempt++) {
      assert.equal(child.exitCode, null, 'Bridge fixture exited');
      healthy = await requestBridge('/health').then(result => result.ok, () => false);
      if (!healthy) await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(healthy, true);
    const request = { message: 'Ask Rex to research Tampa, FL', researchRequestId: 'fixture-req-1' };
    const status = { rexStatusOnly: true, researchRequestId: request.researchRequestId };
    const chat = body => requestBridge('/api/assistant/chat', body).then(result => result.json());
    assert.equal((await chat(status)).rexHandoff.status, 'missing');
    assert.equal(calls.length, 0);
    const completed = await chat(request);
    assert.equal(completed.rexHandoff.status, 'complete');
    assert.match(completed.rexHandoff.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(completed.rexHandoff.citations, ['https://example.com/county-data']);
    assert.deepEqual((await chat(status)).rexHandoff, completed.rexHandoff);
    assert.deepEqual((await chat(request)).rexHandoff, completed.rexHandoff);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].requestId, completed.rexHandoff.id);
    assert.equal(calls[0].body.model, 'gpt-6-luna');
    assert.deepEqual(calls[0].body.reasoning, { effort: 'low' });
    assert.deepEqual(calls[0].body.tools, [{ type: 'web_search' }]);
    assert.equal(calls[0].body.tool_choice, 'required');
    assert.equal(calls[0].body.max_tool_calls, 1);
    assert.equal(calls[0].body.max_output_tokens, 1600);
    const quotaRequest = { message: 'Ask Rex to research Orlando, FL', researchRequestId: 'fixture-req-2' };
    const quotaFailure = await chat(quotaRequest);
    assert.equal(quotaFailure.rexHandoff.status, 'failed');
    assert.equal(quotaFailure.rexHandoff.failureReason, 'provider_quota_exhausted');
    assert.match(quotaFailure.answer, /Research credits are unavailable/);
    assert.deepEqual((await chat(quotaRequest)).rexHandoff, quotaFailure.rexHandoff);
    assert.equal(calls.length, 2);
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    await new Promise(resolve => provider.close(resolve));
    const relativeDir = relative(tmpdir(), dir);
    assert.ok(!isAbsolute(relativeDir) && /^pbk-rex-bridge-[\w-]+$/.test(relativeDir));
    await rm(dir, { recursive: true, force: true });
  }
});
