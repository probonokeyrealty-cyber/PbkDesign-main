import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzerPropertyPreview } from './analyzer-property-preview.mjs';

test('one preview composes existing read adapters with research disabled', async () => {
  const calls = [];
  const result = await analyzerPropertyPreview('42 Fixture Avenue, Example City, CA 90210', {
    listing: async (input) => {
      calls.push(input);
      return { cache: { hit: false }, propertyData: null };
    },
    records: async (input) => {
      calls.push(input);
      return { status: 'matched', profile: { beds: 3 } };
    },
  });
  assert.equal(result.cache.hit, false);
  assert.equal(result.records.status, 'matched');
  assert.deepEqual(calls, [
    {
      address: '42 Fixture Avenue, Example City, CA 90210',
      queueBrowserResearch: false,
      source: 'analyzer-preview',
    },
    { street: '42 Fixture Avenue', city: 'Example City', state: 'CA', zip: '90210' },
  ]);
});

test('partial failures preserve the other source, never invent data', async () => {
  const result = await analyzerPropertyPreview('42 Fixture Avenue, Example City, CA 90210', {
    listing: async () => ({ cache: { hit: true }, propertyData: { source: 'apify-for-sale' } }),
    records: async () => {
      throw new Error('fixture unavailable');
    },
  });
  assert.equal(result.propertyData.source, 'apify-for-sale');
  assert.deepEqual(result.records, { status: 'unavailable' });
});

test('invalid addresses never reach providers', async () => {
  const unexpected = () => {
    throw new Error('must not call');
  };
  const result = await analyzerPropertyPreview('42 Fixture', {
    listing: unexpected,
    records: unexpected,
  });
  assert.equal(result.records.status, 'invalid_address');
  assert.equal(result.propertyData, null);
});
