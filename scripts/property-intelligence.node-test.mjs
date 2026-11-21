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
  assert.equal(s.reads(), 2); assert.deepEqual(s.saves.sort(), ['one', 'two']);
});

const compAddress = '456 Sample Avenue, Example, CA 90210';
const compPhoto = 'https://ap.rdcpix.com/comp-front.jpg';
const captured = '2026-11-02T00:00:00Z';
const cachedListing = (boundAddress = compAddress) => ({ cache: { hit: true }, propertyData: { address: boundAddress, source: 'apify-for-sale', data: {
  capturedAt: captured, photoUrls: [compPhoto, compPhoto, 'javascript:bad', 'https://example.invalid/photo.jpg'], sourceLinks: ['https://www.realtor.com/comp', 'https://evil.invalid/comp'],
} } });

test('a cache entry for a different address cannot replace the lead photos during refresh', async () => {
  const s = setup({ listing: async () => cachedListing(compAddress) });
  const current = {
    source: 'apify-for-sale', address, retrievedAt: '2026-11-01T00:00:00Z',
    photoUrls: ['https://ap.rdcpix.com/saved-subject.jpg'], sourceLinks: [], facts: {}, askingPrice: null,
  };
  s.leads[0].deal.listingSnapshot = current;
  await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.deepEqual(s.leads[0].deal.listingSnapshot, current);
  assert.equal(s.leads[1].deal.listingSnapshot, undefined);
});

test('explicit refresh attaches sanitized comp-owned cache evidence without subject photos', async () => {
  const calls = [];
  const s = setup({ listing: async params => { calls.push(params); return cachedListing(params.address); } });
  const result = await s.enrich({ address });
  const evidence = result.patch.analyzer.recordedSales.sales[0].photoEvidence;
  assert.deepEqual(evidence, { source: 'apify-for-sale', address: compAddress, retrievedAt: captured, photoUrls: [compPhoto], sourceLinks: ['https://www.realtor.com/comp'] });
  assert.deepEqual(calls.map(p => p.address), [address, compAddress]);
  assert.ok(calls.every(p => p.queueBrowserResearch === false));
});

test('comp cache requires own exact address, trusted source and cache hit', async () => {
  for (const response of [cachedListing(address), cachedListing('456 Sample Avenue, Elsewhere, CA 90210'),
    { ...cachedListing(), cache: { hit: false } },
    { ...cachedListing(), propertyData: { ...cachedListing().propertyData, source: 'manual' } },
    { ...cachedListing(), propertyData: { ...cachedListing().propertyData, address: undefined } }]) {
    const s = setup({ listing: async () => response });
    const result = await s.enrich({ address });
    assert.equal(result.patch.analyzer.recordedSales.sales[0].photoEvidence, undefined);
  }
});

test('comp photos require actual cache capture time and use valid cache timestamp fallback', async () => {
  for (const capturedAt of [undefined, 'invalid']) {
    const response = cachedListing(); response.propertyData.data.capturedAt = capturedAt;
    const s = setup({ listing: async () => response });
    assert.equal((await s.enrich({ address })).patch.analyzer.recordedSales.sales[0].photoEvidence, undefined);
    response.propertyData.updatedAt = captured;
    assert.equal((await s.enrich({ address })).patch.analyzer.recordedSales.sales[0].photoEvidence.retrievedAt, captured);
  }
});

test('reviewed selected comp outside current sales window can refresh photos within twenty reads', async () => {
  const savedAddress = '999 Saved Avenue, Example, CA 90210'; const calls = [];
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), address: `${500 + i} Sample Avenue, Example, CA 90210`, price: 400000, soldDate: '2026-11-17' }));
  let available = true;
  const s = setup({ sales: async () => ({ status: 'matched', source: 'ATTOM', sales: rows }), listing: async p => { calls.push(p.address); return available ? cachedListing(p.address) : null; } });
  const reviewed = { address: expectedPropertyAddress, review: 'operator-selected', selectedIds: ['saved'], retrievedAt: captured, sales: [{ id: 'saved', address: savedAddress, price: 123, soldDate: '2025-10-01' }] };
  s.leads[1].analyzer.recordedSales = reviewed;
  const first = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.equal(first.patch.analyzer.recordedSales.sales[0].photoEvidence.address, savedAddress);
  assert.equal(calls.length, 21); assert.equal(calls[1], savedAddress);
  assert.equal(first.patch.analyzer.recordedSales.sales[0].price, 123);
  assert.equal(first.patch.analyzer.recordedSales.retrievedAt, captured);
  available = false;
  const second = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.deepEqual(second.patch.analyzer.recordedSales, first.patch.analyzer.recordedSales);
});

test('reviewed refresh improves matching photos while preserving saved selections, metrics and capture time', async () => {
  const s = setup({ listing: async params => cachedListing(params.address) });
  const reviewed = { address: expectedPropertyAddress, review: 'operator-selected', retrievedAt: captured, selectedIds: ['saved'], sales: [{ id: 'saved', address: compAddress, price: 123, soldDate: '2026-10-01' }, { id: 'absent', address: '789 Other Street, Example, CA 90210', price: 456 }] };
  const manual = { A: { address: 'Manual comp', price: 999 } };
  s.leads[1].analyzer.recordedSales = reviewed;
  s.leads[1].deal.comps = manual;
  const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  const saved = result.patch.analyzer.recordedSales;
  assert.equal(saved.sales[0].photoEvidence.address, compAddress);
  assert.deepEqual(saved, { ...reviewed, sales: [{ ...reviewed.sales[0], photoEvidence: saved.sales[0].photoEvidence }, reviewed.sales[1]] });
  assert.deepEqual(result.patch.deal.comps, manual);
});

test('invalid sales elements cannot abort otherwise valid candidates', async () => {
  const s = setup({ sales: async () => ({ status: 'matched', source: 'ATTOM', sales: [null, undefined, {}, { address: compAddress, price: 400000, soldDate: '2026-11-17' }] }) });
  assert.equal((await s.enrich({ address })).patch.analyzer.recordedSales.sales.length, 1);
});

test('untrusted sales photos and previous subject context cannot supply comp evidence', async () => {
  const untrusted = { source: 'apify-for-sale', address: compAddress, retrievedAt: captured, photoUrls: [compPhoto], sourceLinks: [] };
  const s = setup({ sales: async () => ({ status: 'matched', source: 'ATTOM', sales: [{ id: 'comp', address: compAddress, price: 400000, soldDate: '2026-11-17', photoEvidence: untrusted }] }) });
  s.leads[1].analyzer.recordedSales = { address: { ...expectedPropertyAddress, street: '999 Other Street' }, sales: [{ address: compAddress, photoEvidence: untrusted }] };
  const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
  assert.equal(result.patch.analyzer.recordedSales.sales[0].photoEvidence, undefined);
});

test('cache miss, throw, mismatch and empty evidence preserve same-comp photo capture only', async () => {
  for (const response of [null, Error('offline'), cachedListing(address), { ...cachedListing(), propertyData: { ...cachedListing().propertyData, data: {} } }]) {
    const s = setup({ listing: async () => { if (response instanceof Error) throw response; return response; } });
    const previous = { source: 'apify-for-sale', address: compAddress, retrievedAt: captured, photoUrls: [compPhoto], sourceLinks: [] };
    s.leads[1].analyzer.recordedSales = { address: expectedPropertyAddress, review: 'suggested-unreviewed', sales: [{ id: 'old-id', address: compAddress, photoEvidence: previous }] };
    const result = await s.enrich({ address, leadId: 'two', expectedPropertyAddress });
    assert.deepEqual(result.patch.analyzer.recordedSales.sales[0].photoEvidence, previous);
    s.leads[1].analyzer.recordedSales.sales[0].photoEvidence.address = address;
    assert.equal((await s.enrich({ address, leadId: 'two', expectedPropertyAddress })).patch.analyzer.recordedSales.sales[0].photoEvidence, undefined);
  }
});

test('candidate cache reads are bounded to twenty, with limited concurrency and isolated failures', async () => {
  let active = 0, peak = 0; const calls = [];
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), address: `${500 + i} Sample Avenue, Example, CA 90210`, price: 400000, soldDate: '2026-11-17' }));
  const s = setup({ sales: async () => ({ status: 'matched', source: 'ATTOM', sales: rows }), listing: async params => {
    if (params.address === address) return null;
    calls.push(params.address); active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 2)); active--;
    if (params.address === rows[0].address) throw Error('offline');
    return cachedListing(params.address);
  } });
  const result = await s.enrich({ address });
  assert.equal(calls.length, 20); assert.ok(peak > 1 && peak <= 4);
  assert.equal(result.patch.analyzer.recordedSales.sales.length, 20);
  assert.equal(result.patch.analyzer.recordedSales.sales[0].photoEvidence, undefined);
  assert.equal(result.patch.analyzer.recordedSales.sales[1].photoEvidence.address, rows[1].address);
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
  const source = bridge.match(/async function persistLeadProfileRowToDb\(lead = \{\}, source = 'property-data', \{ exactIdentity = false, insertOnly = false \} = \{\}\) \{[\s\S]*?\r?\n\}/)[0];
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
  const response = { cache: { hit: true }, propertyData: { address, source: 'apify-for-sale', updatedAt: '2026-11-02T00:00:00Z', data: { capturedAt: '2026-11-01T00:00:00Z', listingFacts: { beds: 3 } } } };
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
