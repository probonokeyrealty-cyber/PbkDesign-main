import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

async function exercise(enabled) {
  const bridge = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/public-market-bridge-entry.mjs', import.meta.url)),
    startupMs: 45000, args: enabled ? ['--enabled'] : [],
  });
  const headers = { Authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' };
  const request = async (path, method = 'GET', data, extra) =>
    bridge.fetch(bridge.origin + path, {
      method, headers: { ...headers, ...extra }, body: data && JSON.stringify(data),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const invoke = (params, extra) => request('/invoke', 'POST', { toolName: 'runAgentCommand', params }, extra);
  const approval = (id, body, extra) => request('/api/admin/tasks/' + id, 'PUT', body, extra);
  const getJob = async (id) => (await request('/api/browser-research/jobs/' + id)).body.job;
  const params = { agentId: 'rex', cloudResearchOperation: 'prepare-market-brief', market: 'Raleigh, NC' };
  try {
    const before = (await request('/state')).body;
    assert.equal((await invoke({ ...params, market: 'Tampa, FL' })).status, 403);
    assert.equal((await invoke({ ...params, payload: {} })).status, 403);
    assert.equal((await invoke(params, { 'x-pbk-netlify-proxy': '1' })).status, 403);
    const first = await invoke(params);
    if (!enabled) {
      assert.equal(first.status, 403);
      assert.equal((await request('/api/tooling/status')).body.tooling.publicMarketWorker.executionEnabled, false);
      return;
    }
    assert.equal(first.status, 200);
    const { jobId, taskId } = first.body;
    assert.equal((await getJob(jobId)).status, 'awaiting-approval');
    assert.equal((await approval(taskId, { status: 'approved', payload: {} })).status, 403);
    assert.equal((await approval(taskId, { status: 'approved' }, { 'x-pbk-netlify-proxy': '1' })).status, 403);
    const forged = await request('/api/browser-research/jobs/' + jobId, 'POST', {
      status: 'complete', summary: 'Fabricated cloud success', resultData: { cleanupConfirmed: true },
    });
    assert.equal(forged.body.ok, false);

    const duplicate = (await invoke(params)).body;
    assert.notEqual(taskId, duplicate.taskId);
    const approved = await approval(taskId, { status: 'approved' });
    assert.equal(approved.body.execution.ok, true);
    let finished;
    const deadline = Date.now() + 10000;
    do {
      finished = await getJob(jobId);
      if (['complete', 'failed'].includes(finished.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(finished.status, 'complete');
    assert.equal(finished.cleanupConfirmed, true);
    assert.equal(finished.resultData.market, 'Raleigh, NC');
    assert.equal((await approval(taskId, { status: 'approved' })).status, 403);
    const second = await approval(duplicate.taskId, { status: 'approved' });
    assert.equal(second.body.execution.result, 'public_market_claim_denied');
    assert.equal((await getJob(jobId)).status, 'complete');
    assert.equal((await getJob(duplicate.jobId)).consumed, false);
    const after = (await request('/state')).body;
    for (const key of ['leadImports', 'leads', 'calls', 'messages', 'contracts', 'analyzerRuns'])
      assert.deepEqual(after.state?.[key] ?? after[key], before.state?.[key] ?? before[key], key);
  } finally {
    await bridge.stop();
  }
}

test('the production Raleigh canary fails closed by default', { timeout: 60000 }, () => exercise(false));
test('only one direct founder approval runs a Raleigh canary with cleanup', { timeout: 60000 }, () => exercise(true));
