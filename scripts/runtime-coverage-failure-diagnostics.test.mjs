import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { test } from '@jest/globals';
import { appendRuntimeCoverageCheckpoint, readRuntimeCoverage, RUNTIME_COVERAGE_POLICY } from './runtime-coverage-store.mjs';
import { readPagedCensusIntervalRoots } from './runtime-paged-census.mjs';

const failures = channel('pbk.runtime.coverage.failure');
for (const [operation, invoke, result] of [
  ['append', appendRuntimeCoverageCheckpoint, 'coverage_observation_failed'],
  ['read', readRuntimeCoverage, 'coverage_read_failed'],
]) {
  for (const [label, error, cause, sqlState] of [
    ['SQL cancellation', Object.assign(new Error('private SQL and credential details'), { code: '57014' }), 'postgresql_error', '57014'],
    ['paged query deadline', new Error('Paged census: query abandoned'), 'paged_census_query_abandoned', null],
    ['paged operation deadline', new Error('Paged census: operation abandoned'), 'paged_census_operation_abandoned', null],
    ['unknown private error', Object.assign(new Error('private seller and connection details'), { code: 'private-token' }), 'unexpected_error', null],
  ]) {
    test(`${operation} keeps ${label} fail-closed and emits only bounded redacted diagnostics`, async () => {
      const events = [];
      const collect = event => events.push(event);
      failures.subscribe(collect);
      try {
        const response = await invoke({ pool: { connect: async () => { throw error; } },
          secret: 'explicit-local-failure-diagnostic-material', revision: 'a'.repeat(40),
          bootId: 'failure-diagnostic-fixture', now: () => Date.parse('2026-11-20T12:00:00.000Z') });
        assert.deepEqual(response, { verified: false, result, proof: null, sources: [], diagnostics: {} });
        assert.deepEqual(events, [{ operation, result, cause, sqlState }]);
        assert.equal(Object.isFrozen(events[0]), true);
        assert(!JSON.stringify(events).includes('private'));
        assert(!JSON.stringify(events).includes('material'));
        assert(Buffer.byteLength(JSON.stringify(events)) < 256);
      } finally { failures.unsubscribe(collect); }
    });
  }
}

test('diagnostic collection does not change the runtime query, operation or paging limits', () => {
  assert.equal(RUNTIME_COVERAGE_POLICY.queryMs, 2000);
  assert.equal(RUNTIME_COVERAGE_POLICY.operationMs, 15000);
  assert.equal(RUNTIME_COVERAGE_POLICY.maxBytes, 16777216);
  assert.equal(RUNTIME_COVERAGE_POLICY.maxCheckpoints, 2000);
});

test('a synchronous late paged query preserves its deadline cause and never continues proof work', async () => {
  const controller = new AbortController();
  let queries = 0, destroyed = false, deadlineError;
  const client = { query: async () => {
    queries++;
    // Simulate a synchronous WASM/GC stall that prevents the timeout callback from running.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2100);
    return { rows: [{ transaction_id: '1', isolation: 'repeatable read' }] };
  }, release: destroy => { destroyed ||= destroy === true; } };
  try {
    await readPagedCensusIntervalRoots({ client, secret: 'explicit-local-deadline-material',
      revision: 'a'.repeat(40), now: Date.now, reports: [], snapshot: { inventory: {} },
      fence: { deadlineAt: performance.now() + 15000, signal: controller.signal,
        onAbort: () => controller.abort() } });
    assert.fail('A result settling after the real query deadline must never be accepted');
  } catch (error) { deadlineError = error; }
  assert.equal(queries, 1);
  assert.equal(destroyed, true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(deadlineError?.message, 'Paged census: query abandoned');

  const events = [], collect = event => events.push(event);
  failures.subscribe(collect);
  try {
    const result = await appendRuntimeCoverageCheckpoint({
      pool: { connect: async () => { throw deadlineError; } }, secret: 'explicit-local-deadline-material',
      revision: 'a'.repeat(40), now: Date.now, bootId: 'deadline-fixture' });
    assert.equal(result.verified, false);
    assert.equal(result.result, 'coverage_observation_failed');
    assert.equal(events[0]?.cause, 'paged_census_query_abandoned');
  } finally { failures.unsubscribe(collect); }
});
