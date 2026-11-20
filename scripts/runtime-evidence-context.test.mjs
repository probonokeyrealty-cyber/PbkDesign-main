import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { controlledExecution } from './controlled-execution-scope.mjs';

let context = {};
try { context = await import('./runtime-evidence-context.mjs'); }
catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }
const api = name => {
  assert.equal(typeof context[name], 'function', `${name} must implement internal evidence context`);
  return context[name];
};

test('missing and caller-shaped origins remain unknown', async () => {
  const get = api('getRuntimeEvidenceContext');
  const run = api('withRuntimeEvidenceContext');
  assert.deepEqual(get(), { origin: 'unknown', classification: 'unknown' });
  for (const origin of [undefined, 'organic', { origin: 'operator_chat' }]) {
    await run(origin, async () => assert.equal(get().classification, 'unknown'));
  }
});

test('server origins inherit across awaits without nested upgrades or leaking', async () => {
  const get = api('getRuntimeEvidenceContext');
  const run = api('withRuntimeEvidenceContext');
  for (const origin of ['operator_chat', 'phone_turn', 'registered_business', 'runtime_circuit', 'diagnostic']) {
    await run(origin, async () => {
      await Promise.resolve();
      assert.deepEqual(get(), { origin, classification: origin === 'diagnostic' ? 'diagnostic' : 'operational' });
      await run('operator_chat', async () => assert.equal(get().origin, origin));
      assert.ok(Object.isFrozen(get()));
    });
  }
  await run('bogus', () => run('operator_chat', () => assert.equal(get().classification, 'unknown')));
  assert.equal(get().classification, 'unknown');
});

test('the existing controlledExecution scope is authoritative, even when entered later', async () => {
  const get = api('getRuntimeEvidenceContext');
  const run = api('withRuntimeEvidenceContext');
  await run('operator_chat', () => controlledExecution.run({}, async () => {
    assert.deepEqual(get(), { origin: 'controlled', classification: 'controlled' });
    await run('phone_turn', () => assert.equal(get().classification, 'controlled'));
  }));
  await controlledExecution.run({ provenance: 'operational' }, () =>
    run('operator_chat', () => assert.equal(get().classification, 'controlled')));
});

test('nested diagnostics downgrade operational context without promoting unknown work', async () => {
  const run = api('withRuntimeEvidenceContext'), get = api('getRuntimeEvidenceContext');
  await run('operator_chat', async () => {
    await run('diagnostic', () => assert.equal(get().classification, 'diagnostic'));
    assert.equal(get().classification, 'operational');
  });
  await run('invalid', () => run('diagnostic', () => assert.notEqual(get().classification, 'operational')));
});
