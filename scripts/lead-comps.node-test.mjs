import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedCompPatch, savedLeadComps } from '../src/app/utils/leadComps.mjs';
import { sameAttomAddress } from './attom-property-preview.mjs';
const address = { street: '123 Sample Avenue', city: 'Example', state: 'CA', zip: '90210' };
const result = { status: 'matched', source: 'ATTOM', sales: [{ id: 'comp-1', address: '456 Sample St', soldDate: '2026-11-15', price: 400000 }], retrievedAt: '2026-11-15T12:00:00Z', radiusMiles: 1 };
test('selected comps stay under the canonical lead analyzer/deal and clear unused slots', () => {
  const patch = selectedCompPatch(result, ['comp-1'], address);
  assert.deepEqual(patch.expectedPropertyAddress, address);
  assert.equal(patch.deal.comps.A.price, 400000);
  assert.equal(patch.deal.comps.B.price, 0);
  assert.equal(patch.deal.isAnalyzed, false);
  assert.deepEqual(savedLeadComps({ ...patch, property: { address: address.street, ...address } }), patch.deal.comps);
  assert.equal(savedLeadComps({ ...patch, property: { address: '789 Other St', ...address } }), null);
  assert.equal(patch.analyzer.recordedSales.review, 'operator-selected');
  assert.ok(!('arv' in patch.deal));
});
test('empty, stale and oversized selections cannot write a lead', () => {
  assert.throws(() => selectedCompPatch(result, [], address));
  assert.throws(() => selectedCompPatch(result, ['missing'], address));
  assert.throws(() => selectedCompPatch(result, ['1', '2', '3', '4'], address));
  assert.throws(() => selectedCompPatch({ ...result, status: 'timed_out' }, ['comp-1'], address));
});
test('address guards normalize suffixes but reject another unit, ZIP or city', () => {
  assert.equal(sameAttomAddress(address, { ...address, street: '123 SAMPLE AVE' }), true);
  assert.equal(sameAttomAddress(address, { ...address, street: '123 SAMPLE AVE #2' }), false);
  assert.equal(sameAttomAddress(address, { ...address, zip: '90211' }), false);
  assert.equal(sameAttomAddress(address, { ...address, city: 'Other' }), false);
});
