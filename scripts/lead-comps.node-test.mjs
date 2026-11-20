import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedCompPatch, savedLeadComps, compPhotoEvidence, reviewedCompIds, compDate, compNumber } from '../src/app/utils/leadComps.mjs';
import { sameAttomAddress } from './attom-property-preview.mjs';
const address = { street: '123 Sample Avenue', city: 'Example', state: 'CA', zip: '90210' };
const result = { status: 'matched', source: 'ATTOM', sales: [{ id: 'comp-1', address: '456 Sample St', soldDate: '2026-11-15', price: 400000 }], retrievedAt: '2026-11-15T12:00:00Z', radiusMiles: 1 };
test('selected comps stay under the canonical lead analyzer/deal and clear unused slots', () => {
  const patch = selectedCompPatch(result, ['comp-1'], address);
  assert.deepEqual(patch.expectedPropertyAddress, address);
  assert.equal(patch.actionSource, 'lead-comps-reviewed');
  assert.ok(!('source' in patch), 'Saving research must not replace lead acquisition source.');
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
const photoEvidence = { source: 'apify-for-sale', address: '456 Sample St', retrievedAt: '2026-11-15T12:00:00Z', photoUrls: ['https://ap.rdcpix.com/comp-photo.jpg'], sourceLinks: ['https://www.realtor.com/realestateandhomes-detail/comp'] };
test('comp photos require their own matching address, trusted URLs and capture time', () => {
  const sale = { ...result.sales[0], photoEvidence };
  assert.deepEqual(compPhotoEvidence(sale), photoEvidence);
  assert.equal(compPhotoEvidence({ ...sale, photoEvidence: { ...photoEvidence, address: address.street } }), null);
  assert.equal(compPhotoEvidence({ ...sale, photoEvidence: { ...photoEvidence, address: '456 Sample St #2' } }), null);
  assert.equal(compPhotoEvidence({ ...sale, photoEvidence: { ...photoEvidence, retrievedAt: 'invalid' } }), null);
  assert.equal(compPhotoEvidence({ ...sale, photoEvidence: { ...photoEvidence, source: 'subject' } }), null);
  const sanitized = compPhotoEvidence({ ...sale, photoEvidence: { ...photoEvidence,
    photoUrls: [...photoEvidence.photoUrls, 'javascript:alert(1)', 'https://ap.rdcpix.com.evil.com/image.jpg', 'https://ap.rdcpix.com/image.jpg?secret=1'],
    sourceLinks: [...photoEvidence.sourceLinks, 'https://realtor.com.evil.com/listing', 'https://user:pass@realtor.com/listing'] } });
  assert.deepEqual(sanitized.photoUrls, photoEvidence.photoUrls);
  assert.deepEqual(sanitized.sourceLinks, photoEvidence.sourceLinks);
});
test('explicit save retains address-bound evidence and hydrates only operator-reviewed selections', () => {
  const sales = [{ ...result.sales[0], photoEvidence }, { ...result.sales[0], id: 'comp-2', address: '789 Other St', photoEvidence }];
  const patch = selectedCompPatch({ ...result, sales }, ['comp-1'], address);
  const saved = patch.analyzer.recordedSales;
  assert.deepEqual(saved.sales[0].photoEvidence, photoEvidence);
  assert.equal(saved.sales[1].photoEvidence, undefined);
  const envelope = { ...saved, status: 'matched' };
  assert.deepEqual(reviewedCompIds(envelope), ['comp-1']);
  assert.deepEqual(reviewedCompIds({ ...envelope, selectedIds: ['comp-1', 'missing', 'comp-1', 'comp-2'] }), ['comp-1', 'comp-2']);
  assert.deepEqual(reviewedCompIds({ ...envelope, review: 'suggested-unreviewed' }), []);
  assert.deepEqual(reviewedCompIds({ ...envelope, status: 'unavailable' }), []);
});
test('invalid calendar dates and nonfinite sale metrics cannot become saved comps', () => {
  for (const date of ['2026-02-30', '2026-13-01', 'not a date']) {
    assert.equal(compDate(date), '');
    assert.throws(() => selectedCompPatch({ ...result, sales: [{ ...result.sales[0], soldDate: date }] }, ['comp-1'], address));
  }
  assert.equal(compDate('2024-02-29'), '2024-02-29');
  for (const value of [NaN, Infinity, -1, '1600', null]) assert.equal(compNumber(value), null);
  assert.equal(compNumber(0), 0);
  assert.throws(() => selectedCompPatch({ ...result, sales: [{ ...result.sales[0], price: Infinity }] }, ['comp-1'], address));
});
