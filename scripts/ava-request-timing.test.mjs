import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { createAvaRequestTiming } from './ava-request-timing.mjs';

test('attributes elapsed time without treating returned failures as success', async () => {
  let clock = 0;
  const timer = createAvaRequestTiming({ now: () => clock });
  await timer.measure('session_read', async () => { clock += 1500; });
  const failedLookup = { ok: false, result: 'lead_not_found' };
  assert.equal(timer.measureSync('lead_lookup', () => {
    clock += 3;
    return failedLookup;
  }), failedLookup);
  await timer.measure('session_write', async () => { clock += 900; });
  clock += 12;
  assert.deepEqual(timer.snapshot(), {
    schema: 'pbk.ava.request_timing.v1', metricKind: 'operator_request', durationMs: 2415,
    stages: [
      { stage: 'session_read', durationMs: 1500, outcome: 'returned' },
      { stage: 'lead_lookup', durationMs: 3, outcome: 'returned' },
      { stage: 'session_write', durationMs: 900, outcome: 'returned' },
    ],
  });
});

test('preserves rejection identity and records no exception contents', async () => {
  const timer = createAvaRequestTiming();
  const error = new Error('private prompt and credential must never appear');
  await assert.rejects(timer.measure('session_read', async () => { throw error; }), (e) => e === error);
  assert.equal(timer.snapshot().stages[0].outcome, 'error');
  assert.ok(!JSON.stringify(timer.snapshot()).includes(error.message));
  assert.throws(() => timer.measureSync('lead_lookup', () => { throw error; }), (e) => e === error);
  assert.equal(timer.snapshot().stages[1].outcome, 'error');
});

test('passes cancellation through without retries or background work', async () => {
  const timer = createAvaRequestTiming();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(timer.measure('tool_execution', async () => {
    calls += 1;
    controller.signal.throwIfAborted();
  }), { name: 'AbortError' });
  assert.equal(calls, 1);
  assert.equal(timer.snapshot().stages[0].outcome, 'cancelled');
});

test('snapshots are detached, repeated stages retained, arbitrary labels rejected', async () => {
  const timer = createAvaRequestTiming();
  timer.measureSync('controller_final', () => null);
  const snapshot = timer.snapshot();
  snapshot.stages[0].stage = 'mutated';
  timer.measureSync('controller_final', () => null);
  assert.deepEqual(timer.snapshot().stages.map((s) => s.stage), ['controller_final', 'controller_final']);
  let invoked = false;
  await assert.rejects(timer.measure('customer@example.com', () => { invoked = true; }), TypeError);
  assert.equal(invoked, false);
});
