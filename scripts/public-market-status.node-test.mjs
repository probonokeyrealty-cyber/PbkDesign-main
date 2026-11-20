import assert from 'node:assert/strict';
import test from 'node:test';
import { lastCompletedPublicMarketRun } from '../src/app/utils/publicMarketStatus.ts';

const task = { id: 'approved-1', provider: 'e2b', action: 'public_market_brief', status: 'complete' };
const job = {
  approvalTaskId: task.id, provider: 'e2b', source: 'public-market-brief', status: 'complete',
  consumed: true, cleanupConfirmed: true, completedAt: '2026-11-20T09:25:41.515Z',
};

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
