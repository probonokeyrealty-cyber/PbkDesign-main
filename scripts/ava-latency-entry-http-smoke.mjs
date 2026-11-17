import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

const actualBridge = process.argv.includes('--actual-bridge');
const child = await startIsolatedBridge({ startupMs: 60000, ...(actualBridge ? {}
  : { entry: fileURLToPath(new URL('./fixtures/ava-latency-entry-http.mjs', import.meta.url)) }) });
const path = '/api/admin/ava-latency/run';
const founder = { Authorization: `Bearer ${child.apiKey}`, 'Content-Type': 'application/json' };
const request = async (url, body, headers = founder) => {
  const response = await child.fetch(child.origin + url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
try {
  assert.equal((await request(path, {}, {})).status, actualBridge ? 401 : 403);
  assert.equal((await request(path, {}, { ...founder, Authorization: 'Bearer not-the-founder' })).status,
    actualBridge ? 401 : 403);
  for (const delegated of [{ 'X-PBK-Team-Token': '' }, { 'X-PBK-Netlify-Proxy': '' }]) {
    assert.equal((await request(path, {}, { ...founder, ...delegated })).status, 403);
  }
  for (const body of [{ message: 'Call a seller' }, { count: 40 }, { case: 'model_chat' },
    { diagnostic: true }, { metadata: { operational: false } }, { tool: 'telnyx_call' }, []]) {
    assert.equal((await request(path, body)).status, 400);
  }
  assert.equal((await request(path + '?case=model_chat', {})).status, 400);
  assert.equal((await child.fetch(child.origin + path, { headers: founder })).status, 400);
  const result = await request(path, {});
  assert.equal(result.status, 200, `actual execution failed: ${JSON.stringify(result.body)}`);
  assert.equal(result.body.execution, 'server_fixed_read_only');
  assert.equal(result.body.diagnostic, true);
  assert.equal(result.body.organicReadinessEligible, false);
  assert.equal(result.body.sampleCount, 24);
  assert.equal(result.body.samples.length, 24);
  if (!actualBridge) {
    assert.equal(result.body.modelBacked.completed.count, 6);
    assert.equal(result.body.budgetProven, true);
  }
  console.log(JSON.stringify({ execution: result.body.execution, sampleCount: result.body.sampleCount,
    failedRequests: result.body.failedRequests, blocked: result.body.blocked.count,
    fallbackRequests: result.body.fallbackRequests, modelCompleted: result.body.modelBacked.completed.count,
    budgetProven: result.body.budgetProven,
    results: [...new Set(result.body.samples.map(sample => sample.result))] }));
  const ordinary = await request('/api/assistant/chat', { message: 'Show pending approvals',
    diagnostic: true, source: 'ava-latency-diagnostic', metadata: { diagnostic: true, operational: false } });
  assert.equal(ordinary.status, 200);
  assert.equal(ordinary.body.measurementClassification.diagnostic, false);
  assert.equal(ordinary.body.measurementClassification.operational, true);
  console.log(`ava-latency-entry-http-smoke: ok (${actualBridge ? 'actual bridge' : 'extracted HTTP/runner/assistant with read-only model stub'}; isolated, network denied)`);
} finally { await child.stop(); }
