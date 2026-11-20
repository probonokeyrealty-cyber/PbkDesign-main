import assert from 'node:assert/strict';
import { jest, test } from '@jest/globals';
import { controlledExecution } from './controlled-execution-scope.mjs';
import { withRuntimeEvidenceContext } from './runtime-evidence-context.mjs';

let module = {};
try { module = await import('./runtime-coverage-sampler.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const ready = () => ({ authenticationConfigured: true, bootstrapReady: true, archiveReady: true,
  providerCircuitsReady: true, observabilityReady: true, eventBusConnected: true, approvalMode: 'approval' });
const make = options => {
  assert.equal(typeof module.createRuntimeCoverageSampler, 'function', 'sampler lifecycle must exist');
  return module.createRuntimeCoverageSampler({ secret: 'explicit-local-sampler-fixture-material',
    revision: 'a'.repeat(40), health: ready, ...options });
};
test.each([{}, { enabled: true }, { hosted: true }, { enabled: true, hosted: true, health: () => ({ ...ready(), bootstrapReady: false }) },
  { enabled: true, hosted: true, health: () => ({ ...ready(), approvalMode: 'automatic' }) }])('cannot start without fixed internal gates: %j', async options => {
  let connects = 0, timers = 0;
  const sampler = make({ pool: { connect: async () => { connects++; } }, setTimer: () => { timers++; }, ...options });
  assert.equal(sampler.start(), false);
  assert.equal((await sampler.sample({ enabled: true, hosted: true, health: ready() })).verified, false);
  assert.equal(connects, 0); assert.equal(timers, 0);
});
test('start is idempotent, timers unref, stop cancels pending acquisition and late client releases once', async () => {
  jest.useFakeTimers();
  try {
    let resolveClient, unrefs = 0, cleared = 0;
    const statements = [], releases = [];
    const sampler = make({ enabled: true, hosted: true, pool: { connect: () => new Promise(resolve => { resolveClient = resolve; }) },
      setTimer: () => ({ unref: () => { unrefs++; } }), clearTimer: () => { cleared++; } });
    assert.equal(sampler.start(), true); assert.equal(sampler.start(), true);
    await Promise.resolve();
    assert.equal((await sampler.sample()).result, 'coverage_sample_in_progress');
    sampler.stop();
    resolveClient({ query: async config => { statements.push(config.text); return { rows: [] }; }, release: destroy => releases.push(destroy) });
    await jest.advanceTimersByTimeAsync(1);
    assert.deepEqual(statements, []); assert.deepEqual(releases, [true]);
    assert.ok(unrefs >= 1); assert.ok(cleared >= 1);
    assert.equal(sampler.status().running, false);
    assert.equal((await sampler.sample()).result, 'coverage_sampler_stopped');
  } finally { jest.useRealTimers(); }
});
test('deadline poisons late query continuations rather than enqueuing a commit', async () => {
  jest.useFakeTimers();
  try {
    const statements = [], releases = [];
    const sampler = make({ enabled: true, hosted: true, pool: { connect: async () => ({
      query: config => { statements.push(config); return new Promise(resolve => setTimeout(() => resolve({ rows: [] }), 3000)); },
      release: destroy => releases.push(destroy),
    }) } });
    const pending = sampler.sample();
    await jest.advanceTimersByTimeAsync(2001);
    assert.equal((await pending).verified, false);
    await jest.advanceTimersByTimeAsync(5000);
    assert.equal(statements.length, 1);
    assert.equal(statements[0].query_timeout, 2000);
    assert.deepEqual(releases, [true]);
    assert.equal(sampler.status().inFlight, false);
  } finally { jest.useRealTimers(); }
});

test('controlled and diagnostic execution cannot mint hosted coverage even with enabled flags', async () => {
  let connects = 0;
  const options = { enabled: true, hosted: true, pool: { connect: async () => { connects++; throw Error('must not connect'); } } };
  for (const run of [fn => controlledExecution.run({}, fn), fn => withRuntimeEvidenceContext('diagnostic', fn)]) {
    await run(async () => {
      const sampler = make(options);
      assert.equal(sampler.start(), false);
      assert.equal((await sampler.sample()).result, 'coverage_sampler_disabled_or_unready');
    });
  }
  assert.equal(connects, 0);
});

test('acquisition and queries share a single 15s deadline without a renewed source budget', async () => {
  jest.useFakeTimers();
  try {
    const statements = [], releases = [];
    const sampler = make({ enabled: true, hosted: true, pool: { connect: () => new Promise(resolve => setTimeout(() => resolve({
      query: config => { statements.push(config); return new Promise(done => setTimeout(() => done({ rows: [] }), 1500)); },
      release: destroy => releases.push(destroy),
    }), 14000)) } });
    const result = sampler.sample();
    await jest.advanceTimersByTimeAsync(15001);
    assert.equal((await result).verified, false);
    await jest.advanceTimersByTimeAsync(5000);
    assert.equal(statements.length, 1);
    assert.ok(statements[0].query_timeout <= 1000);
    assert.deepEqual(releases, [true]);
  } finally { jest.useRealTimers(); }
});

test('database error properties cannot become public classifications or expose private text', async () => {
  const sampler = make({ enabled: true, hosted: true, pool: { connect: async () => {
    throw Object.assign(new Error('private connection detail'), { result: 'private connection detail' });
  } } });
  const result = await sampler.sample();
  assert.equal(result.verified, false);
  assert.equal(JSON.stringify(result).includes('private connection detail'), false);
});
