import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { controlledExecution, createScopedState, remapControlledSql, assertControlledToolAllowed } from './controlled-execution-scope.mjs';

test('SQL AST redirects reads and actual writes, preserving literal public text', () => {
  const sql = remapControlledSql("INSERT INTO public.calls(id) VALUES ('public.customers') RETURNING id", 'pbk_q_abc', new Set(['calls']));
  assert.match(sql, /pbk_q_abc.calls/);
  assert.match(sql, /'public.customers'/);
});

test('SQL rejects escape schemas, unknown tables, DDL and side-effect functions', () => {
  for (const sql of ['select * from other.calls', 'select * from public.customers', 'DROP TABLE public.calls', "select set_config('search_path','public',false)", "select pg_notify('send','contact')", "select 'value'::public.evil_type", "select 'public.calls'::regclass"]) {
    assert.throws(() => remapControlledSql(sql, 'pbk_q_abc', new Set(['calls'])));
  }
});

test('scope isolates concurrent state and rejects nested contact regardless of flags', async () => {
  const organic = { calls: [{ id: 'customer' }], status: {} };
  const state = createScopedState(organic);
  await controlledExecution.run({ state: { calls: [{ id: 'fixture' }], status: {} } }, async () => {
    state.calls.push({ id: 'test' });
    assert.deepEqual(state.calls.map(x => x.id), ['fixture', 'test']);
    assert.throws(() => assertControlledToolAllowed('telnyx_sms', { dryRun: true }));
    assert.throws(() => assertControlledToolAllowed('createApproval', { approved: true }));
    await Promise.resolve();
    assert.equal(state.calls[0].id, 'fixture');
  });
  assert.deepEqual(organic.calls, [{ id: 'customer' }]);
});
