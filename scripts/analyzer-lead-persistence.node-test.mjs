import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyzerLeadPatch, latestCallModeNote } from '../src/app/utils/analyzerLeadPersistence.mjs';

test('manual save persists structured facts, comps and draft without an agent command', () => {
  const deal = { leadId: 'qa-a', address: '24 Sample Ave, Example, CA 90210', beds: 3, baths: 2, sqft: 1500, year: 1980, price: 310000, notes: 'Draft', comps: { A: { price: 400000 } } };
  const patch = buildAnalyzerLeadPatch(deal);
  assert.equal(patch.property.address, '24 Sample Ave'); assert.equal(patch.property.city, 'Example');
  assert.equal(patch.property.sqft, 1500); assert.equal(patch.property.yearBuilt, 1980);
  assert.deepEqual(patch.analyzer.comps, deal.comps); assert.deepEqual(patch.deal, deal);
  assert.ok(!('source' in patch)); assert.ok(!('command' in patch));
  assert.throws(() => buildAnalyzerLeadPatch({ ...deal, leadId: '' }));
});
test('refresh recalls only the newest saved Call Mode note for the requested lead', () => {
  const activity = [
    { leadId: 'qa-b', source: 'deal-view-call-mode', category: 'NOTE', text: 'Wrong seller', at: '2026-11-15T13:00:00Z' },
    { leadId: 'qa-a', source: 'deal-view-call-mode', category: 'NOTE', text: 'Older', at: '2026-11-15T11:00:00Z' },
    { leadId: 'qa-a', source: 'deal-view-call-mode', category: 'NOTE', text: 'Saved call note', at: '2026-11-15T12:00:00Z' },
    { leadId: 'qa-a', source: 'other', category: 'NOTE', text: 'Other lane', at: '2026-11-15T14:00:00Z' },
  ];
  assert.equal(latestCallModeNote({ lead: { activity } }, 'qa-a'), 'Saved call note');
  assert.equal(latestCallModeNote({ activity }, 'qa-c'), '');
});

test('street-only saves retain canonical facts, seller contact and underwriting', () => {
  const patch = buildAnalyzerLeadPatch({ leadId: 'qa-a', address: '24 Sample Ave', sellerName: 'Manual seller', sellerPhone: '', sellerEmail: '', beds: 0, baths: 1, sqft: 800, year: 1950, price: 200000, arv: 300000, mao60: 150000, maoRBP: 250000, rent: 1500, balance: 80000, rate: 3.5, repairs: { mid: 15000, condition: 'C3' } });
  assert.equal(patch.property.address, '24 Sample Ave');
  assert.equal(patch.property.beds, 0);
  assert.equal(patch.property.arv, 300000);
  assert.equal(patch.property.estimatedRepairs, 15000);
  assert.equal(patch.property.mortgageBalance, 80000);
  assert.equal(patch.seller.name, 'Manual seller');
});
