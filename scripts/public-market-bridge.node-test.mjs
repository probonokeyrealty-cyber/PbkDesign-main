import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

async function exercise(enabled, canary = false) {
  const bridge = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/public-market-bridge-entry.mjs', import.meta.url)),
    // Cold Windows module loading can exceed 15s under build/typecheck load.
    // This only bounds isolated test boot; provider/job deadlines stay unchanged.
    startupMs: 60000,
    args: [...(enabled ? ['--enabled'] : []), ...(canary ? ['--canary'] : [])],
  });
  const headers = { Authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' };
  const get = async (path) => bridge.fetch(bridge.origin + path, { headers }).then((r) => r.json());
  const invoke = async (params) =>
    bridge
      .fetch(bridge.origin + '/invoke', {
        method: 'POST',
        headers,
        body: JSON.stringify({ toolName: 'runAgentCommand', params }),
      })
      .then((r) => r.json());
  const approve = async (id, body) =>
    bridge
      .fetch(bridge.origin + '/api/admin/tasks/' + id, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      .then((r) => r.json());
  const benchmark = (arm, extraHeaders = {}) => bridge.fetch(bridge.origin + '/api/admin/public-market/benchmark', {
    method: 'POST', headers: { ...headers, ...extraHeaders },
    body: JSON.stringify({ market: 'Tampa, FL', benchmarkArm: arm }),
  });
  try {
    let status = await get('/api/admin/public-market/benchmark');
    if (enabled) {
      const deadline = Date.now() + 10000;
      while (status.worker.sdkPreload.state === 'loading' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        status = await get('/api/admin/public-market/benchmark');
      }
      const preload = status.worker.sdkPreload;
      assert.equal(preload.state, 'ready');
      assert.ok(preload.startedAtMs >= preload.listenerReadyMs);
      assert.ok(preload.completedAtMs >= preload.startedAtMs);
    } else {
      assert.equal(status.worker.sdkPreload.state, 'not_started');
    }
    assert.equal(status.worker.configured, enabled);
    assert.equal(status.worker.fastPathPercent, canary ? 10 : 0);
    const before = await get('/state');
    assert.equal(before.browserResearchJobs.filter((job) => job.provider === 'e2b').length, 0);
    const prepared = await invoke({
      agentId: 'rex',
      command: 'rex prepare cloud market brief for Tampa, FL',
    });
    assert.equal(prepared.result.routedTo, 'tool_first:public_market_prepare');
    assert.equal(prepared.result.ok, true);
    const task = prepared.result.response.task,
      job = prepared.result.response.job;
    assert.equal(task.status, 'pending');
    assert.equal(task.payload.signature, undefined);
    const pending = (await get('/api/browser-research/jobs/' + job.id)).job;
    assert.equal(pending.status, 'awaiting-approval');
    assert.equal(pending.consumed, false);
    const duplicate = await bridge
      .fetch(bridge.origin + '/invoke', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          toolName: 'requestAdminAction',
          params: { ...task, summary: 'Harmless local read' },
        }),
      })
      .then((r) => r.json());
    assert.equal(duplicate.result.ok, false);
    const forged = await bridge
      .fetch(bridge.origin + '/api/browser-research/jobs/' + job.id, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          status: 'complete',
          provider: 'browseros',
          summary: 'Fabricated cloud success',
          resultData: { cleanupConfirmed: true },
        }),
      })
      .then((r) => r.json());
    assert.equal(forged.ok, false);
    assert.equal(
      (await get('/api/browser-research/jobs/' + job.id)).job.status,
      'awaiting-approval'
    );
    const denied = await approve(task.id, { status: 'approved', payload: { market: 'Miami, FL' } });
    assert.equal(denied.execution.ok, false);
    const anonymousBenchmark = await benchmark('batched', { 'X-PBK-Netlify-Proxy': 'true' });
    assert.equal(anonymousBenchmark.status, 403);
    const selected = await benchmark('batched');
    assert.equal(selected.status, canary ? 201 : 409);
    const selectedTask = canary ? await selected.json() : null;
    if (canary) {
      assert.equal(selectedTask.job.benchmarkArm, 'batched');
      assert.equal(selectedTask.task.status, 'pending');
      const groupA = await benchmark('standard');
      assert.equal(groupA.status, 201);
      assert.equal((await groupA.json()).job.benchmarkArm, 'standard');
      const proxyApproval = await bridge.fetch(bridge.origin + '/api/admin/tasks/' + selectedTask.task.id, {
        method: 'PUT', headers: { ...headers, 'X-PBK-Netlify-Proxy': 'true' },
        body: JSON.stringify({ status: 'approved' }),
      });
      assert.equal(proxyApproval.status, 403);
      assert.equal((await get('/api/browser-research/jobs/' + selectedTask.job.id)).job.consumed, false);
    }
    const again = selectedTask ? { result: { response: selectedTask } } : await invoke({
      agentId: 'rex',
      cloudResearchOperation: 'prepare-market-brief',
      market: 'Tampa, FL',
    });
    const approved = await approve(again.result.response.task.id, { status: 'approved' });
    if (!enabled) {
      assert.equal(approved.execution.ok, false);
      assert.equal((await get('/api/tooling/status')).tooling.publicMarketWorker.state, 'disabled');
    } else {
      assert.equal(approved.execution.ok, true);
      assert.equal(approved.execution.result, 'queued');
      let finished;
      const deadline = Date.now() + 10000;
      do {
        finished = (await get('/api/browser-research/jobs/' + again.result.response.job.id)).job;
        if (['complete', 'failed'].includes(finished.status)) break;
        await new Promise((r) => setTimeout(r, 30));
      } while (Date.now() < deadline);
      assert.equal(finished.status, 'complete');
      assert.equal(finished.cleanupConfirmed, true);
      assert.equal(finished.resultData.market, 'Tampa, FL');
      assert.equal(finished.executionMetrics.arm, canary ? 'batched' : 'standard');
      assert.equal(finished.executionMetrics.uploadRequests, canary ? 1 : 2);
      assert.ok(Number.isInteger(finished.executionMetrics.totalMs));
      assert.match(finished.executionMetrics.workerInstanceId, /^[a-f0-9-]{36}$/);
      assert.equal(finished.executionMetrics.workerInstanceId, status.worker.sdkPreload.workerInstanceId);
      assert.equal(finished.executionMetrics.provisioning.sdkState, 'warm');
      assert.equal(finished.executionMetrics.provisioning.sdkLoadMs, 0);
      assert.ok(Number.isInteger(finished.executionMetrics.provisioning.createMs));
      const replay = await approve(again.result.response.task.id, { status: 'approved' });
      assert.equal(replay.execution.ok, false);
    }
    const after = await get('/state');
    for (const key of ['leadImports', 'leadStageTransitions', 'campaignLeads', 'calls', 'messages', 'contracts', 'dncEntries', 'analyzerRuns']) {
      assert.ok(Array.isArray(before[key]), key);
      assert.deepEqual(after[key], before[key], key);
    }
  } finally {
    await bridge.stop();
  }
}
test(
  'public market preparation queues approval but cannot execute a default-off worker',
  { timeout: 75000 },
  () => exercise(false)
);
test(
  'approved public market work completes through the real bridge with sealed inputs and no business mutations',
  { timeout: 75000 },
  () => exercise(true)
);
test('protected benchmark selects stable arms before approval, and the real bridge completes the batched arm',
  { timeout: 75000 }, () => exercise(true, true));

test('a different hosted service ID cannot prepare even with a founder bearer and a 10% flag', { timeout: 60000 }, async () => {
  const bridge = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/public-market-bridge-entry.mjs', import.meta.url)),
    startupMs: 45000, args: ['--enabled', '--canary', '--nonstaging'],
  });
  const headers = { Authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' };
  try {
    const result = await bridge.fetch(bridge.origin + '/api/admin/public-market/benchmark', {
      method: 'POST', headers, body: JSON.stringify({ market: 'Tampa, FL', benchmarkArm: 'batched' }),
    });
    assert.equal(result.status, 403);
    const prepare = await bridge.fetch(bridge.origin + '/invoke', {
      method: 'POST', headers, body: JSON.stringify({ toolName: 'runAgentCommand', params: {
        agentId: 'rex', command: 'Rex prepare cloud market brief for Tampa, FL',
      } }),
    }).then((response) => response.json());
    assert.equal(prepare.result.response.result, 'public_market_staging_only');
  } finally { await bridge.stop(); }
});
