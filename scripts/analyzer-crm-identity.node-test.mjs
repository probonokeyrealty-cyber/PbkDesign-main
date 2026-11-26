import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const server = await readFile(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = server.indexOf('async function handleManualLeadCreate(');
const end = server.indexOf('\nconst approvalDecisionLocks', start);
assert.ok(start > 0 && end > start);
const source = server.slice(start, end);

test('analyzer create refuses a duplicate before mutating or binding another seller', async () => {
  const existing = { leadId: 'existing-seller', property: { address: '10 Other Street' } };
  const context = vm.createContext({
    state: { leadImports: [existing] },
    normalizeLeadIntake: (input) => ({ ...input, leadId: 'new-id' }),
    findDuplicateLeadImport: () => existing,
    ensureLeadCommitEnvelope: () => {
      throw new Error('Must not mutate');
    },
    patchLeadImport: () => {
      throw new Error('Must not merge another seller');
    },
  });
  const handler = vm.runInContext(`(${source})`, context);
  const result = await handler({
    source: 'analyzer-save',
    eventId: 'new-save',
    property: { address: '42 Fixture Avenue' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'analyzer_lead_match_requires_review');
  assert.equal(existing.property.address, '10 Other Street');
});

test('retry repairs persistence for the same lead without creating or queuing another', async () => {
  const existing = { leadId: 'created-id', eventId: 'same-save' };
  const state = { leadImports: [existing] };
  const triage = { leadId: existing.leadId, status: 'saved' };
  const persisted = [], projected = [];
  const context = vm.createContext({
    state,
    persistState: async (snapshot) => { persisted.push(snapshot); },
    persistLeadProfileRowToDb: async (lead, reason) => { projected.push([lead, reason]); },
    findAvaLeadTriage: (lead) => {
      assert.strictEqual(lead, existing);
      return triage;
    },
    normalizeLeadIntake: () => { assert.fail('Replay must not normalize a new lead'); },
    queueRexLeadImport: () => { assert.fail('Replay must not queue a new import'); },
  });
  const handler = vm.runInContext(`(${source})`, context);
  const result = await handler({ source: 'analyzer-save', eventId: 'same-save' });
  assert.equal(result.ok, true);
  assert.equal(result.replayed, true);
  assert.equal(result.leadId, 'created-id');
  assert.strictEqual(result.lead, existing);
  assert.strictEqual(result.leadTriage, triage);
  assert.deepEqual(state.leadImports, [existing]);
  assert.deepEqual(persisted, [state]);
  assert.deepEqual(projected, [[existing, 'manual-lead-replay']]);
});
