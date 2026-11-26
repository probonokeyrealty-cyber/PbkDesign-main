import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicMarketController } from './lib/public-market-controller.mjs';
import * as controllerModule from './lib/public-market-controller.mjs';

test('loaded running cloud jobs become interrupted without replay or false cleanup', () => {
  const job = { id: 'market-a', provider: 'e2b', status: 'running', consumed: true };
  const restored = controllerModule.recoverPublicMarketJob(job);
  assert.equal(restored.status, 'interrupted');
  assert.equal(restored.consumed, true);
  assert.equal(restored.cleanupConfirmed, false);
  assert.equal(
    controllerModule.recoverPublicMarketJob({ ...job, status: 'complete' }).status,
    'complete'
  );
});

function fixture(extra = {}) {
  const jobs = [];
  let runs = 0,
    persists = 0;
  const capability = Symbol('operator-approval');
  const controller = createPublicMarketController({
    signingKey: 'synthetic-sealing-credential',
    approvalCapability: capability,
    claimJob: async () => true,
    worker: {
      status: () => ({ enabled: true, state: 'unverified' }),
      run: async () => {
        runs++;
        return {
          ok: true,
          result: 'public_market_brief_ready',
          cleanupConfirmed: true,
          executionMetrics: {
            arm: 'batched',
            uploadRequests: 1,
            stagesMs: { upload: 2 },
            totalMs: 9,
          },
          brief: {
            summary: 'Public evidence summary',
            citations: ['https://example.org/market'],
            limitations: ['Review dates'],
          },
        };
      },
    },
    getJob: (id) => jobs.find((j) => j.id === id),
    saveJob: async (job) => {
      persists++;
      const i = jobs.findIndex((j) => j.id === job.id);
      if (i < 0) jobs.push({ ...job });
      else jobs[i] = { ...jobs[i], ...job };
    },
    ...extra,
  });
  return { controller, capability, jobs, runs: () => runs, persists: () => persists };
}
test('prepare produces a pending sealed task and research record without running providers', async () => {
  const f = fixture();
  const p = await f.controller.prepare({ agentId: 'rex', market: 'Tampa, FL' });
  assert.equal(p.ok, true);
  assert.equal(p.task.status, 'pending');
  assert.equal(p.task.requiresApproval, true);
  assert.equal(p.task.provider, 'e2b');
  assert.equal(p.job.status, 'awaiting-approval');
  assert.equal(f.runs(), 0);
});
test('only the internal approval capability can start the exact unmodified task', async () => {
  const f = fixture();
  const p = await f.controller.prepare({ agentId: 'rex', market: 'Tampa, FL' });
  p.task.status = 'approved';
  for (const [task, cap] of [
    [p.task, true],
    [p.task, Symbol('operator-approval')],
    [{ ...p.task, summary: 'Misleading approval' }, f.capability],
    [{ ...p.task, payload: { ...p.task.payload, code: 'injected' } }, f.capability],
    [{ ...p.task, payload: { ...p.task.payload, market: 'Miami, FL' } }, f.capability],
    [{ ...p.task, id: 'forged' }, f.capability],
  ])
    assert.equal((await f.controller.start(task, cap)).ok, false);
  assert.equal(f.runs(), 0);
  const started = await f.controller.start(p.task, f.capability);
  assert.equal(started.ok, true);
  await started.completion;
  assert.equal(f.runs(), 1);
  assert.equal(f.jobs[0].status, 'complete');
  assert.equal(f.jobs[0].consumed, true);
  assert.deepEqual(f.jobs[0].executionMetrics, {
    arm: 'batched',
    uploadRequests: 1,
    stagesMs: { upload: 2 },
    totalMs: 9,
  });
  assert.equal((await f.controller.start(p.task, f.capability)).ok, false);
  assert.equal(f.runs(), 1);
});
test('mock cache tasks require protected benchmark preparation and cannot run after the mode changes', async () => {
  let mock = true;
  let runs = 0;
  const f = fixture({ worker: {
    status: () => ({ enabled: true, fastPathPercent: 10, mockExaCache: mock }),
    armFor: () => 'batched',
    run: async () => { runs++; return { ok: false }; },
  } });
  const request = { agentId: 'rex', market: 'Tampa, FL' };
  assert.equal((await f.controller.prepare(request)).ok, false);
  assert.equal((await f.controller.prepare({ ...request, benchmarkArm: 'batched' })).ok, false);
  const p = await f.controller.prepare({ ...request, benchmarkArm: 'batched' }, f.capability);
  assert.equal(p.task.status, 'pending');
  assert.match(p.task.costEstimate, /No live Exa calls/);
  assert.equal((await f.controller.start(p.task, f.capability)).ok, false);
  p.task.status = 'approved';
  mock = false;
  assert.equal((await f.controller.start(p.task, f.capability)).ok, false);
  assert.equal(runs, 0);
  mock = true;
  const started = await f.controller.start(p.task, f.capability);
  assert.equal(started.ok, true);
  await started.completion;
  assert.equal(runs, 1);
});
test('durable consumed state prevents replay after a controller restart and persistence failure prevents all provider calls', async () => {
  const f = fixture();
  const p = await f.controller.prepare({ agentId: 'rex', market: 'Tampa, FL' });
  p.task.status = 'approved';
  f.jobs[0].consumed = true;
  assert.equal((await f.controller.start(p.task, f.capability)).ok, false);
  const g = fixture();
  const q = await g.controller.prepare({ agentId: 'rex', market: 'Tampa, FL' });
  q.task.status = 'approved';
  const failed = createPublicMarketController({
    signingKey: 'synthetic-sealing-credential',
    approvalCapability: g.capability,
    getJob: (id) => g.jobs.find((j) => j.id === id),
    saveJob: async () => {
      throw Error('persist_failed');
    },
    worker: { status: () => ({ enabled: true }), run: async () => assert.fail('must not run') },
  });
  assert.equal((await failed.start(q.task, g.capability)).ok, false);
});
test('unsupported agents/fields never create a task; a failed worker is saved as failed, not complete', async () => {
  const f = fixture({
    worker: {
      status: () => ({ enabled: true }),
      run: async () => ({ ok: false, result: 'public_market_cleanup_unconfirmed' }),
    },
  });
  for (const request of [
    { agentId: 'hermes', market: 'Tampa' },
    { agentId: 'rex', market: 'Tampa', code: 'arbitrary' },
  ])
    assert.equal((await f.controller.prepare(request)).ok, false);
  const p = await f.controller.prepare({ agentId: 'rex', market: 'Tampa' });
  p.task.status = 'approved';
  const r = await f.controller.start(p.task, f.capability);
  await r.completion;
  assert.equal(f.jobs[0].status, 'failed');
  assert.equal(f.jobs[0].resultSummary.includes('cleanup'), true);
});
