import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPropertyIntelligence } from './property-intelligence.mjs';
const address = '123 Sample Avenue, Example, CA 90210';
const expectedPropertyAddress = { street: '123 Sample Avenue', city: 'Example', state: 'CA', zip: '90210' };
const lead = id => ({ leadId: id, property: { address: expectedPropertyAddress.street, ...expectedPropertyAddress }, deal: {}, analyzer: {} });
function setup(overrides = {}) {
  const leads = [lead('one'), lead('two')]; let reads = 0; const saves = [];
  const enrich = createPropertyIntelligence({
    getLead: id => leads.find(l => l.leadId === id),
    saveLead: async (id, patch) => { saves.push(id); Object.assign(leads.find(l => l.leadId === id), patch); },
    listing: async params => { reads++; assert.equal(params.queueBrowserResearch, false); return { cache: { hit: false }, propertyData: null }; },
    records: async () => ({ status: 'matched', profile: { address, beds: 3 } }),
    sales: async () => ({ status: 'matched', source: 'ATTOM', retrievedAt: '2026-11-18T12:00:00Z', sales: [
      { id: 'subject', address, price: 800000, soldDate: '2026-11-17' },
      { id: 'comp', address: '456 Sample Avenue, Example, CA 90210', price: 400000, soldDate: '2026-11-17' },
    ] }), ...overrides,
  });
  return { enrich, leads, saves, reads: () => reads };
}
test('unlinked evidence is a draft and subject transfers never become comps', async () => {
  const s = setup(); const result = await s.enrich({ address });
  assert.equal(result.saved, false); assert.equal(s.saves.length, 0);
  assert.equal(result.patch.deal.comps.A.price, 400000);
  assert.equal(result.patch.analyzer.recordedSales.review, 'suggested-unreviewed');
});
test('exact ID prevents duplicate-address cross-writes and invalid context calls no providers', async () => {
  const s = setup();
  await assert.rejects(s.enrich({ address, leadId: 'missing', expectedPropertyAddress }), { code: 'lead_not_found' });
  await assert.rejects(s.enrich({ address, leadId: 'two' }), { code: 'property_context_changed' });
  assert.equal(s.reads(), 0);
  await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.deepEqual(s.saves, ['two']); assert.equal(s.leads[0].deal.comps, undefined);
});
test('re-read protects property changes and manual edits during provider await', async () => {
  let release; const waiting = new Promise(r => { release = r; });
  const s = setup({ records: async () => { await waiting; return { status: 'unavailable' }; } });
  const request = s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  s.leads[1].deal.comps = { A: { address: 'Manual', price: 123 } };
  release(); const result = await request;
  assert.equal(result.patch.deal.comps.A.price, 123);
  const t = setup({ records: async () => { t.leads[1].property.address = '999 Changed Road'; return { status: 'unavailable' }; } });
  await assert.rejects(t.enrich({ address, leadId: 'two', expectedPropertyAddress }), { code: 'property_context_changed' });
  assert.equal(t.saves.length, 0);
});
test('provider failures preserve old snapshots, timestamp, reviewed comps and other facts', async () => {
  const s = setup({ records: async () => { throw Error('offline'); }, sales: async () => ({ status: 'timed_out' }) });
  const old = { source: 'attom', address, retrievedAt: '2026-11-01T00:00:00Z', facts: { address, beds: 4 } };
  s.leads[1].deal = { propertyRecordSnapshot: old, listingSnapshot: { address, photoUrls: ['saved-photo'] }, arv: 555, comps: { A: { address: 'Reviewed', price: 999 } } };
  s.leads[1].analyzer.recordedSales = { review: 'operator-selected', address: expectedPropertyAddress, selectedIds: ['old'] };
  const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.deepEqual(result.patch.deal.propertyRecordSnapshot, old);
  assert.equal(result.patch.deal.listingSnapshot.photoUrls[0], 'saved-photo');
  assert.equal(result.patch.deal.arv, 555); assert.equal(result.patch.deal.comps.A.price, 999);
  assert.deepEqual(result.patch.analyzer.recordedSales.selectedIds, ['old']);
});
test('concurrent same-property requests dedupe reads while saving each exact lead', async () => {
  const s = setup();
  await Promise.all(['one', 'two'].map(leadId => s.enrich({ address, leadId, expectedPropertyAddress })));
  assert.equal(s.reads(), 1); assert.deepEqual(s.saves.sort(), ['one', 'two']);
});

test('empty analyzer aliases cannot erase occupied deal slots while adding suggestions', async () => {
  const s = setup();
  s.leads[1].deal.comps = { A: { address: 'Manual', price: 123 } };
  s.leads[1].analyzer.comps = { A: { address: '', price: 0, date: '', link: '' } };
  const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.equal(result.patch.deal.comps.A.price, 123);
  assert.equal(result.patch.deal.comps.B.price, 400000);
});

test('intentional manual empty slots remain empty and reviewed clears stay cleared', async () => {
  const s = setup();
  s.leads[1].deal = { compManualSlots: ['A'], comps: { A: { address: '', price: 0, date: '', link: '' } } };
  let result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.equal(result.patch.deal.comps.A.price, 0); assert.equal(result.patch.deal.comps.B.price, 400000);
  s.leads[1].deal.comps = { A: { price: 0 } }; s.leads[1].analyzer.comps = { A: { price: 0 } };
  s.leads[1].analyzer.recordedSales = { review: 'operator-selected', address: expectedPropertyAddress, selectedIds: [] };
  result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.equal(result.patch.deal.comps.B, undefined);
});

test('partial records retain old field timestamps and partial sales preserve prior success', async () => {
  const s = setup({ sales: async () => ({ status: 'matched', source: 'ATTOM', partial: true, sales: [] }) });
  s.leads[1].deal.propertyRecordSnapshot = { address, source: 'attom', retrievedAt: '2026-11-01T00:00:00Z', facts: { address, beds: 4, baths: 2 } };
  s.leads[1].analyzer.recordedSales = { address: expectedPropertyAddress, retrievedAt: '2026-11-01T00:00:00Z', sales: [{ id: 'old' }], review: 'suggested-unreviewed' };
  const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  const snapshot = result.patch.deal.propertyRecordSnapshot;
  assert.equal(snapshot.facts.beds, 3); assert.equal(snapshot.facts.baths, 2);
  assert.equal(snapshot.fieldRetrievedAt.baths, '2026-11-01T00:00:00Z');
  assert.notEqual(snapshot.fieldRetrievedAt.beds, snapshot.fieldRetrievedAt.baths);
  assert.equal(result.patch.analyzer.recordedSales.sales[0].id, 'old');
});

test('bridge exact-ID patch never falls back to duplicate address, email or phone', () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const source = bridge.match(/function patchLeadImport\(stateRef, matcher = \{\}, patch = \{\}\) \{[\s\S]*?\r?\n\}/)[0];
  const context = vm.createContext({ normalizePhone: v => v, isoNow: () => 'now', ensureLeadCommitEnvelope() {}, limitStateArrays() {}, updateDerivedStatus() {}, isInboundPlaceholderLead: () => true });
  const patch = vm.runInContext(`(${source})`, context);
  const state = { leadImports: ['one', 'two'].map(leadId => ({ leadId, property: { address }, seller: { email: 'same@example.invalid', phone: 'same' } })) };
  const result = patch(state, { leadId: 'two', address, email: 'same@example.invalid', phone: 'same' }, { deal: { marker: true } });
  assert.equal(result.leadId, 'two'); assert.equal(state.leadImports[0].deal, undefined);
  assert.equal(patch(state, { leadId: 'missing', address }, { deal: {} }), null);
});

test('bridge exact persistence bypasses inbound placeholder phone coalescing', async () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const source = bridge.match(/async function persistLeadProfileRowToDb\(lead = \{\}, source = 'property-data', \{ exactIdentity = false \} = \{\}\) \{[\s\S]*?\r?\n\}/)[0];
  const queries = [];
  const context = vm.createContext({ normalizePhone: v => v, ensureLeadCommitEnvelope() {}, toNumber: v => Number(v) || 0,
    queryPgRows: async (sql, params) => { queries.push({ sql, params }); return { ok: true, rows: [{ id: 'lead-inbound-other', source: 'inbound-call' }] }; } });
  const save = vm.runInContext(`(${source})`, context);
  const result = await save({ leadId: 'two', seller: { phone: 'same' } }, 'property-intelligence', { exactIdentity: true });
  assert.equal(result.leadId, 'two'); assert.equal(queries.length, 1); assert.equal(queries[0].params[0], 'two');
  assert.match(queries[0].sql, /INSERT INTO public.lead_profiles/);
});

test('async canonical reads recheck address after providers and preserve manual edits', async () => {
  let calls = 0; let current = lead('durable'); const saves = [];
  const s = setup({ getLead: async () => { await Promise.resolve(); calls++; if (calls === 2) current = { ...current, deal: { compManualSlots: ['A'], comps: { A: { price: 0 } } } }; return current; }, saveLead: async (id, patch) => saves.push({ id, patch }) });
  await s.enrich({ address, leadId: 'durable', expectedPropertyAddress });
  assert.equal(calls, 2); assert.equal(saves[0].patch.deal.comps.A.price, 0); assert.equal(saves[0].patch.deal.comps.B.price, 400000);
  calls = 0;
  const changed = setup({ getLead: async () => { await Promise.resolve(); return ++calls === 1 ? lead('durable') : { ...lead('durable'), property: { ...expectedPropertyAddress, address: '999 Other Street' } }; } });
  await assert.rejects(changed.enrich({ address, leadId: 'durable', expectedPropertyAddress }), { code: 'property_context_changed' });
  assert.equal(changed.saves.length, 0);
});

test('actual cache capture time survives reads and invalid capture time uses valid fallback', async () => {
  const response = { cache: { hit: true }, propertyData: { source: 'apify-for-sale', updatedAt: '2026-11-02T00:00:00Z', data: { capturedAt: '2026-11-01T00:00:00Z', listingFacts: { beds: 3 } } } };
  const s = setup({ listing: async () => response });
  assert.equal((await s.enrich({ address })).patch.deal.listingSnapshot.retrievedAt, '2026-11-01T00:00:00Z');
  response.propertyData.data.capturedAt = 'invalid';
  assert.equal((await s.enrich({ address })).patch.deal.listingSnapshot.retrievedAt, '2026-11-02T00:00:00Z');
});

test('bridge hydrates a durable-only exact ID and prefers concurrent hot manual edits', async () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
  const source = bridge.match(/async function loadExactPropertyLead\(leadId\) \{[\s\S]*?\r?\n\}/)[0];
  const durable = lead('bulk'); const state = { leadImports: [] }; let concurrent = false;
  const context = vm.createContext({ state, LIMITS: {leadImports:90}, IS_HOSTED: true, queryPgRows() {}, addLeadImport: () => { throw Error('Newest-first intake would evict the old lead'); },
    loadAppliedBatchLeads: async (_query, id) => { assert.equal(id, 'bulk'); if (concurrent) state.leadImports.push({ ...durable, deal: { manual: true } }); return [durable]; } });
  const load = vm.runInContext(`(${source})`, context);
  assert.equal(await load('bulk'), durable); assert.equal(state.leadImports.length, 1);
  state.leadImports = []; concurrent = true;
  const current = await load('bulk'); assert.equal(current.deal.manual, true); assert.equal(state.leadImports.length, 1);
  concurrent = false;
  state.leadImports = Array.from({length:90},(_,i)=>({...lead(`new-${i}`),updatedAt:'2026-11-18T00:00:00Z'}));
  assert.equal(await load('bulk'), durable);
  assert.equal(state.leadImports.length,90);
  assert.equal(state.leadImports[0].leadId,'bulk');
});
