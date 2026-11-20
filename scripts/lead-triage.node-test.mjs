import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const source = new URL('../src/app/utils/leadTriage.ts', import.meta.url);
const implementation = existsSync(source) ? await import(source.href) : {};
const read = (value) => {
  assert.equal(typeof implementation.readStoredNextStep, 'function', 'Stored next-step display resolver is implemented');
  return implementation.readStoredNextStep(value);
};
const resolve = (item, leads) => {
  assert.equal(typeof implementation.resolveTriageLead, 'function', 'Exact-ID triage resolver is implemented');
  return implementation.resolveTriageLead(item, leads);
};

test('stored manual wording is displayed verbatim, not normalized into a recommendation', () => {
  assert.deepEqual(read({ bant: { nextStep: '  Keep my wording.\nCall only after I confirm.  ' } }), {
    state: 'recorded', text: '  Keep my wording.\nCall only after I confirm.  ',
  });
});
test('missing, malformed and explicit empty next steps are different states', () => {
  for (const value of [null, {}, { bant: {} }, { bant: { nextStep: 123 } }])
    assert.deepEqual(read(value), { state: 'unavailable', text: 'Next step unavailable' });
  assert.deepEqual(read({ bant: { nextStep: ' ' } }), { state: 'empty', text: 'No next step recorded' });
});
test('uses the same stored aliases as Lead Workspace without inventing text', () => {
  assert.equal(read({ bant: { next_step: 'Stored alternate key' } }).text, 'Stored alternate key');
  assert.equal(read({ callContext: { nextStep: 'Stored call context' } }).text, 'Stored call context');
  assert.equal(read({ bant: { nextStep: '' }, callContext: { nextStep: 'Existing fallback' } }).text, 'Existing fallback');
});
test('joins only an exact encoded workspace ID, never a name, address or prefix', () => {
  const leads = [{ id: 'lead-1', name: 'Same seller', bant: { nextStep: 'Wrong lead' } },
    { id: 'lead-10', name: 'Same seller', bant: { nextStep: 'Correct lead' } },
    { id: 'space id', bant: { nextStep: 'Encoded exact ID' } }];
  assert.equal(resolve({ targetPath: '/leads/lead-10' }, leads).nextStep.text, 'Correct lead');
  assert.equal(resolve({ targetPath: '/leads/space%20id' }, leads).leadId, 'space id');
  assert.equal(resolve({ targetPath: '/leads', body: 'Same seller' }, leads), null);
  assert.equal(resolve({ targetPath: '/leads/lead-100' }, leads).nextStep.state, 'unavailable');
});
test('rejects conflicting references, ambiguous records and external or malformed paths', () => {
  const leads = [{ id: 'a', bant: { nextStep: 'A' } }, { id: 'b', bant: { nextStep: 'B' } }];
  assert.equal(resolve({ targetPath: '/leads/a', leadId: 'b' }, leads), null);
  for (const targetPath of ['https://example.com/leads/a', '//example.com/leads/a', '/leads/%ZZ', '/leads/a/extra'])
    assert.equal(resolve({ targetPath }, leads), null);
  assert.equal(resolve({ targetPath: '/leads/a' }, [...leads, { id: 'a', bant: { nextStep: 'Other A' } }]).nextStep.state, 'unavailable');
  assert.equal(resolve({ targetPath: '/leads/a' }, [{ id: 'a', leadId: 'b', bant: { nextStep: 'Conflicting IDs' } }]).nextStep.state, 'unavailable');
});
test('display resolution never mutates the roster or changes business fields', () => {
  const lead = { id: 'a', bant: { nextStep: 'Confirm timing' }, arv: 245000, soldComps: ['comp-a'], dnc: true };
  const before = structuredClone(lead);
  resolve({ targetPath: '/leads/a' }, [lead]);
  assert.deepEqual(lead, before);
});

test('the real bridge lead queue shape resolves its exact recordId and workspace link', () => {
  const result = resolve({ targetPath: '/leads', recordKind: 'lead', recordId: 'a' }, [{ id: 'a', bant: { nextStep: 'A only' } }]);
  assert.equal(result.leadId, 'a');
  assert.equal(result.href, '/leads/a');
  assert.equal(result.nextStep.text, 'A only');
  assert.equal(resolve({ targetPath: '/leads/a', recordKind: 'lead', recordId: 'b' }, []), null);
});

test('foreign context ownership cannot leak next steps through either alias or nested BANT', () => {
  for (const field of ['callContext', 'call_context']) {
    assert.equal(read({ id: 'a', [field]: { leadId: 'b', nextStep: 'Private foreign instructions' } }).state, 'unavailable');
    assert.equal(read({ id: 'a', [field]: { lead_id: 'b', bant: { nextStep: 'Private foreign BANT' } } }).state, 'unavailable');
    assert.equal(read({ id: 'a', [field]: { leadId: 'a', bant: { leadId: 'b', nextStep: 'Nested foreign BANT' } } }).state, 'unavailable');
  }
  assert.equal(read({ id: 'a', call_context: { leadId: 'a', nextStep: 'Owned step' }, callContext: { leadId: 'b', nextStep: 'Foreign override' } }).text, 'Owned step');
  assert.equal(read({ id: 'a', call_context: { leadId: 'a', bant: { leadId: 'a', nextStep: 'Owned nested step' } }, callContext: { leadId: 'a', bant: { leadId: 'b', nextStep: 'Foreign nested override' } } }).text, 'Owned nested step');
});
