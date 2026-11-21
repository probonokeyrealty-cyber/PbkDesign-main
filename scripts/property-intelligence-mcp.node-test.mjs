import test from 'node:test';
import assert from 'node:assert/strict';
import { createPropertyIntelligence } from './property-intelligence.mjs';
import { lookupAttomPropertyPreview } from './attom-property-preview.mjs';

const address = '123 Sample Ave, Example, CA 90210';
const expectedPropertyAddress = { street: '123 Sample Ave', city: 'Example', state: 'CA', zip: '90210' };
const capture = '2026-11-18T12:00:00Z';
const sale = { id: 'fixture-sale', address: '456 Sample Ave, Example, CA 90210', soldDate: '2026-06-01', price: 400000, distanceMiles: 0.5, beds: 3, baths: 2, sqft: 1800, pricePerSqft: 222.22, propertyType: 'Single family' };
const mortgageAndTaxFacts = {
  originalMortgageAmount: 125000, originalMortgageLender: 'Fixture Bank', originalMortgageDocumentNumber: 'DOC-1',
  secondOriginalMortgageAmount: 25000, secondOriginalMortgageLender: 'Second Bank', secondOriginalMortgageDocumentNumber: 'DOC-2',
  taxDelinquentYear: 2023, assessedImprovementValue: 190000, assessmentMarketTotalValue: 310000,
  assessmentMarketLandValue: 105000, assessmentMarketImprovementValue: 205000,
};
function setup(extra = {}) {
  const leads = ['one', 'two'].map(id => ({ leadId: id, property: { address: expectedPropertyAddress.street, city: 'Example', state: 'CA', zip: '90210', beds: 7 }, deal: {}, analyzer: {} }));
  const counts = { mcp: 0, legacyRecords: 0, legacySales: 0, saves: 0 };
  const mcp = { status: 'matched', profile: { address, attomId: '42', propertyType: 'Single family', beds: 4, baths: 2, livingSqft: 1800, yearBuilt: 1990, lotSqft: 8000 }, sections: [], sales: { status: 'matched', source: 'ATTOM', retrievedAt: capture, windowStart: '2025-11-18', windowEnd: '2026-11-18', radiusMiles: 1, partial: true, sales: [sale] } };
  const enrich = createPropertyIntelligence({
    getLead: id => leads.find(x => x.leadId === id),
    saveLead: async (id, patch) => { counts.saves++; Object.assign(leads.find(x => x.leadId === id), patch); },
    listing: async () => ({ cache: { hit: false }, propertyData: null }),
    records: async () => {
      counts.legacyRecords++;
      return { status: 'matched', profile: { address, attomId: '42', beds: 3, livingSqft: 1850, grossSqft: 1900 } };
    },
    sales: async () => { counts.legacySales++; return { status: 'unavailable' }; },
    mcpRecords: async (input, { radius }) => { counts.mcp++; assert.deepEqual(input, expectedPropertyAddress); assert.equal(radius, 1); return structuredClone(mcp); },
    now: () => capture,
    ...extra,
  });
  return { enrich, leads, counts, mcp };
}
test('one MCP call supplies core facts and comps despite unavailable optional datasets', async () => {
  const s = setup();
  assert.deepEqual(s.counts, { mcp: 0, legacyRecords: 0, legacySales: 0, saves: 0 }, 'construction is passive');
  s.mcp.sections = [{ id: 'permits', status: 'not_entitled', checkedAt: capture, facts: {}, rows: [] }];
  const earlierCapture = '2026-11-01T00:00:00Z';
  s.leads[0].deal.propertyRecordSnapshot = { address, source: 'attom', retrievedAt: earlierCapture, facts: { grossSqft: 1950, ...mortgageAndTaxFacts } };
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.deepEqual(s.counts, { mcp: 1, legacyRecords: 0, legacySales: 0, saves: 1 });
  assert.equal(response.records.profile.beds, 4);
  assert.equal(response.records.partial, true);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.livingSqft, 1800);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.grossSqft, 1950);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.fieldRetrievedAt.grossSqft, earlierCapture);
  assert.equal(s.leads[0].deal.comps.A.price, 400000);
  assert.equal(s.leads[0].property.beds, 7);
  assert.equal(s.leads[0].analyzer.recordedSales.windowStart, '2025-11-18');
  assert.equal(s.leads[1].deal.propertyRecordSnapshot, undefined);
});
test('an explicit lead refresh fills mortgage and tax blanks in one Basic Profile request and only saves to that lead', async () => {
  const requests = [];
  const s = setup({ records: input => lookupAttomPropertyPreview(input, {
    enabled: true,
    apiKey: 'fixture',
    request: async url => {
      requests.push(url.pathname);
      return Response.json({ status: { code: 0 }, property: [{
        address: { line1: '123 Sample Ave', locality: 'Example', countrySubd: 'CA', postal1: '90210' },
        identifier: { attomId: '42' },
        building: { size: { grossSize: 1900 } },
        assessment: {
          delinquentyear: 2023,
          assessed: { assdImprValue: 190000 },
          market: { mktTtlValue: 300000, mktLandValue: 105000, mktImprValue: 205000 },
          mortgage: {
            FirstConcurrent: { amount: 135000, LenderFirstName: 'Fixture Bank', trustDeedDocumentNumber: 'DOC-1' },
            SecondConcurrent: { amount: 25000, LenderFirstName: 'Second Bank', trustDeedDocumentNumber: 'DOC-2' },
          },
        },
      }] });
    },
  }) });
  const earlierCapture = '2026-11-01T00:00:00Z';
  s.mcp.profile.assessmentMarketTotalValue = mortgageAndTaxFacts.assessmentMarketTotalValue;
  s.leads[0].deal.propertyRecordSnapshot = { address, source: 'attom', retrievedAt: earlierCapture, facts: { originalMortgageAmount: 125000 } };
  s.leads[1].deal.propertyRecordSnapshot = { address, source: 'attom', retrievedAt: earlierCapture, facts: { originalMortgageAmount: 225000 } };
  const sibling = structuredClone(s.leads[1]);
  assert.deepEqual(requests, []);

  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.deepEqual(requests, ['/propertyapi/v1.0.0/property/basicprofile']);
  assert.equal(s.counts.mcp, 1);
  assert.equal(s.counts.legacySales, 0);
  assert.equal(s.counts.saves, 1);
  assert.equal(response.leadId, 'one');
  const saved = s.leads[0].deal.propertyRecordSnapshot;
  for (const [field, value] of Object.entries(mortgageAndTaxFacts)) assert.equal(saved.facts[field], value, field);
  assert.equal(saved.fieldRetrievedAt.originalMortgageAmount, earlierCapture);
  assert.equal(saved.fieldRetrievedAt.taxDelinquentYear, capture);
  assert.equal(saved.facts.grossSqft, undefined);
  assert.deepEqual(s.leads[1], sibling);

  await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(requests.length, 1, 'a complete saved set skips Basic Profile on the next refresh');
});
test('a conflicting supplemental parcel does not replace the primary record or request REST comps', async () => {
  let reads = 0;
  const s = setup({ records: async () => {
    reads++;
    return { status: 'matched', profile: { address, attomId: '99', taxDelinquentYear: 2023 } };
  } });
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(reads, 1);
  assert.equal(response.records.profile.attomId, '42');
  assert.equal(response.records.profile.taxDelinquentYear, undefined);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.taxDelinquentYear, undefined);
  assert.equal(s.leads[0].deal.comps.A.price, 400000);
  assert.equal(s.counts.legacySales, 0);
});
test('a supplemental response fills only fields still blank on the same lead at save time', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const s = setup({ records: async () => {
    started();
    await waiting;
    return { status: 'matched', profile: { address, attomId: '42', originalMortgageAmount: 135000, taxDelinquentYear: 2023 } };
  } });
  const pending = s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  await Promise.race([entered, pending.then(() => assert.fail('expected a supplemental read'))]);
  s.leads[0].deal.propertyRecordSnapshot = { address, source: 'attom', retrievedAt: '2026-11-01T00:00:00Z', facts: { originalMortgageAmount: 125000 } };
  release();
  await pending;
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.originalMortgageAmount, 125000);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.taxDelinquentYear, 2023);
});
test('an unlinked draft keeps the existing core coverage fallback rules', async () => {
  const s = setup();
  await s.enrich({ address });
  assert.deepEqual(s.counts, { mcp: 1, legacyRecords: 0, legacySales: 0, saves: 0 });
});
test('REST fills a missing core property field without replacing MCP values or fetching sales again', async () => {
  const s = setup();
  delete s.mcp.profile.livingSqft;
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.deepEqual(s.counts, { mcp: 1, legacyRecords: 1, legacySales: 0, saves: 1 });
  assert.equal(response.records.profile.livingSqft, 1850);
  assert.equal(response.records.profile.beds, 4);
  assert.equal(response.records.profile.grossSqft, 1900);
});
test('failed MCP read uses legacy sales fallback without discarding REST facts', async () => {
  const s = setup({ mcpRecords: async () => ({ status: 'timed_out', sections: [] }) });
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacyRecords, 1);
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.records.status, 'matched');
  assert.equal(response.records.partial, true);
  assert.equal(s.leads[0].deal.propertyRecordSnapshot.facts.grossSqft, 1900);
});
test('conflicting MCP parcel identity cannot supply records or comps', async () => {
  const s = setup(); s.mcp.profile.attomId = '99'; delete s.mcp.profile.livingSqft;
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.records.profile.attomId, '42');
  assert.equal(response.records.partial, true);
  assert.equal(response.records.profile.beds, 3);
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
  Object.assign(s.mcp.profile, mortgageAndTaxFacts);
  const response = await s.enrich({ address, leadId: 'one', expectedPropertyAddress });
  assert.equal(s.counts.legacyRecords, 0);
  assert.equal(s.counts.legacySales, 1);
  assert.equal(response.sales.radiusMiles, 0.5);
  assert.equal(response.sales.partial, true);
});
