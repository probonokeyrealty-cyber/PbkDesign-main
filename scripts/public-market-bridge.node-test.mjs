import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

async function exercise(enabled) {
  const bridge = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/public-market-bridge-entry.mjs', import.meta.url)),
    // Cold Windows module loading can exceed 15s under build/typecheck load.
    // This only bounds isolated test boot; provider/job deadlines stay unchanged.
    startupMs: 45000,
    args: enabled ? ['--enabled'] : [],
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
  try {
    const before = await get('/state');
    const prepared = await invoke({
      agentId: 'rex',
      command: 'rex prepare cloud market brief for Tampa, FL',
    });
    assert.equal(prepared.result.routedTo, 'tool_first:public_market_prepare');
    assert.equal(prepared.result.ok, true);
    const task = prepared.result.response.task,
      job = prepared.result.response.job;
    assert.equal(task.status, 'pending');
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
    const again = await invoke({
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
      const replay = await approve(again.result.response.task.id, { status: 'approved' });
      assert.equal(replay.execution.ok, false);
    }
    const after = await get('/state');
    for (const key of ['leadImports', 'leads', 'calls', 'messages', 'contracts', 'analyzerRuns'])
      assert.deepEqual(after.state?.[key] ?? after[key], before.state?.[key] ?? before[key], key);
  } finally {
    await bridge.stop();
  }
}
test(
  'public market preparation queues approval but cannot execute a default-off worker',
  { timeout: 60000 },
  () => exercise(false)
);
test(
  'approved public market work completes through the real bridge with sealed inputs and no business mutations',
  { timeout: 60000 },
  () => exercise(true)
);
