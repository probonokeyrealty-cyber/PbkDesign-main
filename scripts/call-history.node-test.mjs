import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import { loadAppliedBatchLeads } from './batch-apply.mjs';
import { shared, sampleState, sampleQuery } from './fixtures/call-history-bridge.mjs';

const source = await readFile(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Production call-history section must exist');
  return source.slice(from, to);
};
const helperSource = section('function getItemTimestamp(', 'function currency(')
  + section('function plainRecord(', 'function hasRecordValues(')
  + section('function summarizeTranscriptForLead(', 'function buildLeadMessageDraft(');
// Execute the actual route/helper, substituting only the external database boundary.
async function routeLastCall(id, { hosted = true, pool = {}, query = sampleQuery, state = sampleState } = {}) {
  let result;
  const context = {
    state, IS_HOSTED: hosted, getPgPool: () => pool, queryPgRows: query, decodeURIComponent,
    loadAppliedBatchLeads,
    pathname: `/api/leads/${encodeURIComponent(id)}/last-call`, request: { method: 'GET' }, response: {},
    matchPath: (pathname) => pathname.match(/^\/api\/leads\/(?<id>[^/]+)\/last-call$/),
    json: (_response, status, body) => { result = { status, body: JSON.parse(JSON.stringify(body)) }; },
  };
  await runInNewContext(`(async () => { ${helperSource}\n${section("    const leadLastCallMatch =", "    const leadPatchMatch =")} })()`, context);
  return result;
}

let bridge;
before(async () => {
  bridge = await startIsolatedBridge({ entry: fileURLToPath(new URL('./fixtures/call-history-bridge.mjs', import.meta.url)), startupMs: 30000 });
});
after(async () => { await bridge?.stop(); });
async function lastCall(id) {
  const response = await bridge.fetch(`${bridge.origin}/api/leads/${encodeURIComponent(id)}/last-call`, {
    headers: { Authorization: `Bearer ${bridge.apiKey}` },
  });
  return { status: response.status, body: await response.json() };
}

test('shared phone, address and name cannot select foreign or unidentified calls', async () => {
  const { status, body } = await lastCall('sample-a');
  assert.equal(status, 200);
  assert.equal(body.leadId, 'sample-a');
  assert.equal(body.call.id, 'own-new');
  assert.equal(body.call.leadId, 'sample-a');
  assert.equal(body.summary, 'Own transcript');
  assert.equal(body.last_offer, 12000);
  assert.equal(body.sentiment, 0);
  assert.deepEqual(body.transcript, [{ text: 'Own transcript' }]);
});

test('no exact call is empty, even with shared contacts and a non-call message', async () => {
  assert.deepEqual(await lastCall('sample-empty'), { status: 200, body: { ok: true, leadId: 'sample-empty', call: null } });
});

test('call-channel messages require the same exact leadId', async () => {
  const { body } = await lastCall('sample-message');
  assert.equal(body.call.id, 'own-message');
  assert.equal(body.summary, 'Own call message');
});

test('lead-owned context remains usable without attaching another seller call', async () => {
  const { body } = await lastCall('sample-context');
  assert.equal(body.call.status, 'context-only');
  assert.equal(body.call.leadId, 'sample-context');
  assert.equal(body.last_offer, 42000);
  assert.equal(body.summary, 'Own saved context');
});

for (const id of ['', ' ', 'unknown-sample', 'sample-row-alias', 'SAMPLE-A', shared.phone, shared.address, shared.leadName]) {
  test(`missing/noncanonical ID is not a seed or contact lookup: ${JSON.stringify(id)}`, async () => {
    const { status, body } = await lastCall(id);
    assert.ok([400, 404].includes(status), `expected rejection, got ${status}`);
    assert.notEqual(body.ok, true);
    assert.equal(body.call, undefined);
  });
}

test('URL encoding is decoded once and still matched exactly', async () => {
  const { status, body } = await lastCall('sample/path%id');
  assert.equal(status, 200);
  assert.equal(body.leadId, 'sample/path%id');
  assert.equal(body.call.id, 'encoded-own');
});

test('durable-only batch lead with no call returns empty history', async () => {
  assert.deepEqual(await routeLastCall('sample-durable-empty'), { status: 200, body: { ok: true, leadId: 'sample-durable-empty', call: null } });
});

test('durable-only batch lead can retrieve its exact call', async () => {
  const { status, body } = await routeLastCall('sample-durable-call');
  assert.equal(status, 200);
  assert.equal(body.call.id, 'durable-own');
  assert.equal(body.last_offer, 23000);
});

test('unavailable durable lookup fails closed even when the local lead exists', async () => {
  const { status, body } = await routeLastCall('sample-unavailable');
  assert.equal(status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.call, undefined);
});

test('local known no-DB mode skips only the durable read and returns exact local history', async () => {
  const { status, body } = await routeLastCall('sample-a', { hosted: false, pool: null, query: () => assert.fail('No DB read in known local no-DB mode') });
  assert.equal(status, 200);
  assert.equal(body.call.id, 'own-new');
});

for (const options of [{ hosted: true, pool: null }, { hosted: true, pool: {} }, { hosted: false, pool: {} }]) {
  test(`failed durable read cannot fall back to local history: ${JSON.stringify(options)}`, async () => {
    const { status, body } = await routeLastCall('sample-a', { ...options, query: async () => ({ ok: false }) });
    assert.equal(status, 503);
    assert.equal(body.call, undefined);
  });
}

test('a mismatched durable row is rejected instead of relabeled or falling back', async () => {
  const { status, body } = await routeLastCall('sample-a', { query: async () => ({ ok: true, rows: [{ id: 'sample-b', raw: {} }] }) });
  assert.equal(status, 404);
  assert.equal(body.call, undefined);
});

test('call-context metadata alone is not history and explicitly foreign context is rejected', async () => {
  for (const callContext of [{ selected_path: 'cash' }, { leadId: 'sample-b', summary: 'Foreign context', last_offer: 99000 }]) {
    const state = { ...sampleState, leadImports: [{ leadId: 'sample-context', callContext }] };
    assert.deepEqual(await routeLastCall('sample-context', { state }), { status: 200, body: { ok: true, leadId: 'sample-context', call: null } });
  }
});

test('the helper rejects missing IDs and a mismatched resolved lead', () => {
  const helper = runInNewContext(`${helperSource}\nbuildLeadLastCallDetails`, { state: sampleState });
  for (const id of [undefined, null, '', ' ', 42]) assert.equal(helper(id), null);
  assert.equal(helper('sample-a', { leadId: 'sample-b' }), null);
});

test('a matching primary context cannot launder a foreign fallback recap or offer', async () => {
  const state = { ...sampleState, leadImports: [{ leadId: 'sample-context',
    call_context: { leadId: 'sample-b', summary: 'Foreign alias recap', last_offer: 99000 },
    callContext: { leadId: 'sample-context' } }] };
  const result = await routeLastCall('sample-context', { state });
  assert.deepEqual(result.body, { ok: true, leadId: 'sample-context', call: null });
});
