import test from 'node:test';
import assert from 'node:assert/strict';
import { createPropertyIntelligence } from './property-intelligence.mjs';

const address = '123 Sample Ave, Example, CA 90210';
const expectedPropertyAddress = { street: '123 Sample Ave', city: 'Example', state: 'CA', zip: '90210' };
const capture = '2026-11-18T12:00:00Z';
const sale = { id: 'fixture-sale', address: '456 Sample Ave, Example, CA 90210', soldDate: '2026-06-01', price: 400000, distanceMiles: 0.5, beds: 3, baths: 2, sqft: 1800, pricePerSqft: 222.22, propertyType: 'Single family' };
function setup(extra = {}) {
  const leads = ['one', 'two'].map(id => ({ leadId: id, property: { address: expectedPropertyAddress.street, city: 'Example', state: 'CA', zip: '90210', beds: 7 }, deal: {}, analyzer: {} }));
  const counts = { mcp: 0, legacySales: 0, saves: 0 };
  const mcp = { status: 'matched', profile: { address, attomId: '42', beds: 4 }, sections: [], sales: { status: 'matched', source: 'ATTOM', retrievedAt: capture, windowStart: '2025-11-18', windowEnd: '2026-11-18', radiusMiles: 1, partial: true, sales: [sale] } };
  const enrich = createPropertyIntelligence({
    getLead: id => leads.find(x => x.leadId === id),
    saveLead: async (id, patch) => { counts.saves++; Object.assign(leads.find(x => x.leadId === id), patch); },
    listing: async () => ({ cache: { hit: false }, propertyData: null }),
    records: async () => ({ status: 'matched', profile: { address, attomId: '42', beds: 3, grossSqft: 1900 } }),
    sales: async () => { counts.legacySales++; return { status: 'unavailable' }; },
    mcpRecords: async (input, { radius }) => { counts.mcp++; assert.deepEqual(input, expectedPropertyAddress); assert.equal(radius, 1); return structuredClone(mcp); },
    now: () => capture,
    ...extra,
  });
  return { enrich, leads, counts, mcp };
}
test('explicit enrichment makes one MCP call, reuses existing REST facts and supplies existing comp slots', async () => {
  const s = setup();
  assert.equal(s.counts.mcp, 0, 'construction is passive');
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.mcp, 1);
  assert.equal(s.counts.legacySales, 0);
  assert.equal(response.records.profile.beds, 3);
  assert.equal(response.records.profile.grossSqft, 1900);
  assert.equal(s.leads[0].deal.comps.A.price, 400000);
  assert.equal(s.leads[0].property.beds, 7);
  assert.equal(s.leads[0].analyzer.recordedSales.windowStart, '2025-11-18');
  assert.equal(s.leads[1].deal.propertyRecordSnapshot, undefined);
});
test('failed MCP read uses legacy sales fallback without discarding REST facts', async () => {
  const s = setup({ mcpRecords: async () => ({ status: 'timed_out', sections: [] }) });
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.records.status, 'matched');
  assert.equal(response.records.partial, true);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.grossSqft, 1900);
});
test('conflicting MCP parcel identity cannot supply records or comps', async () => {
  const s = setup(); s.mcp.profile.attomId = '99';
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.records.profile.attomId, '42');
  assert.equal(response.records.partial, true);
  assert.equal(s.leads[0].deal.comps, undefined);
});
test('context changes during MCP await cannot persist to a changed lead', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  let started; const entered = new Promise(resolve => { started = resolve; });
  const s = setup({ mcpRecords: async () => { started(); await waiting; return s.mcp; } });
  const pending = s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  await entered;
  s.leads[0].property.address = '999 Changed St'; release();
  await assert.rejects(pending, { code: 'property_context_changed' });
  assert.equal(s.counts.saves, 0);
});
test('narrower MCP coverage requests the existing REST fallback and retains truthful source radius', async () => {
  const s = setup(); s.mcp.sales.radiusMiles = 0.5;
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.sales.radiusMiles, 0.5);
  assert.equal(response.sales.partial, true);
});
