import assert from 'node:assert/strict';
import test from 'node:test';
import { lastCompletedPublicMarketRun, readSavedRaleighReceipt } from '../src/app/utils/publicMarketStatus.ts';

const task = { id: 'approved-1', provider: 'e2b', action: 'public_market_brief', status: 'complete' };
const job = {
  approvalTaskId: task.id, provider: 'e2b', source: 'public-market-brief', status: 'complete',
  consumed: true, cleanupConfirmed: true, completedAt: '2026-11-20T09:25:41.515Z',
};

test('the disclosure requires an off worker plus a single, ordered call and sandbox lifecycle receipt', () => {
  const saved = {
    jobId: 'fixture-raleigh', completedAt: '2026-11-20T09:25:41.515Z',
    exa: { tool: 'EXA_ANSWER', count: 1, logId: 'fixture-log', at: '2026-11-20T09:25:32.000Z' },
    e2b: {
      count: 1, sandboxId: 'fixture-sandbox', cleanupConfirmed: true,
      createdEventId: 'fixture-created', createdAt: '2026-11-20T09:25:34.000Z',
      killedEventId: 'fixture-killed', killedAt: '2026-11-20T09:25:41.000Z',
    },
  };
  const meta = { executionEnabled: false, savedRaleighReceipt: saved };
  assert.deepEqual(readSavedRaleighReceipt(meta), saved);
  assert.equal(readSavedRaleighReceipt({ ...meta, executionEnabled: true }), null);
  assert.equal(readSavedRaleighReceipt({ executionEnabled: false }), null);
  for (const changed of [
    { ...saved, exa: { ...saved.exa, count: 2 } },
    { ...saved, e2b: { ...saved.e2b, cleanupConfirmed: false } },
    { ...saved, e2b: { ...saved.e2b, killedEventId: saved.e2b.createdEventId } },
    { ...saved, e2b: { ...saved.e2b, killedAt: saved.exa.at } },
    { ...saved, completedAt: null },
  ]) assert.equal(readSavedRaleighReceipt({ ...meta, savedRaleighReceipt: changed }), null);
});

test('finds saved completion independently of live worker state', () => {
  assert.equal(lastCompletedPublicMarketRun([job], [task]), job.completedAt);
  assert.equal(lastCompletedPublicMarketRun(undefined, [task]), null);
});

test('requires a matching completed approval and confirmed cleanup', () => {
  assert.equal(lastCompletedPublicMarketRun([job], [{ ...task, id: 'other' }]), null);
  assert.equal(lastCompletedPublicMarketRun([job], [{ ...task, status: 'pending' }]), null);
  assert.equal(lastCompletedPublicMarketRun([{ ...job, cleanupConfirmed: false }], [task]), null);
  assert.equal(lastCompletedPublicMarketRun([{ ...job, consumed: false }], [task]), null);
});
