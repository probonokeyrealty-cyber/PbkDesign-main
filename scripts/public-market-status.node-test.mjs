import assert from 'node:assert/strict';
import test from 'node:test';
import { lastCompletedPublicMarketRun } from '../src/app/utils/publicMarketStatus.ts';

const task = { id: 'approved-1', provider: 'e2b', action: 'public_market_brief', status: 'complete' };
const job = {
  approvalTaskId: task.id, provider: 'e2b', source: 'public-market-brief', status: 'complete',
  consumed: true, cleanupConfirmed: true, completedAt: '2026-11-20T09:25:41.515Z',
};

test('reports the newest saved completion and does not need live worker state', () => {
  const latest = '2026-11-20T13:00:00Z';
  assert.equal(lastCompletedPublicMarketRun(
    [job, { ...job, approvalTaskId: 'approved-2', completedAt: latest }],
    [task, { ...task, id: 'approved-2' }],
  ), '2026-11-20T13:00:00.000Z');
});

test('does not count stale, unrelated, unconsumed or unconfirmed results as proof', () => {
  for (const invalid of [
    { ...job, status: 'interrupted' },
    { ...job, cleanupConfirmed: false },
    { ...job, consumed: false },
    { ...job, completedAt: 'invalid' },
    { ...job, source: 'browser-research' },
    { ...job, approvalTaskId: 'unrelated' },
  ]) assert.equal(lastCompletedPublicMarketRun([invalid], [task]), null);
  assert.equal(lastCompletedPublicMarketRun([job], [{ ...task, status: 'pending' }]), null);
  assert.equal(lastCompletedPublicMarketRun([job], [{ ...task, action: 'some_other_action' }]), null);
  assert.equal(lastCompletedPublicMarketRun(undefined, undefined), null);
});
