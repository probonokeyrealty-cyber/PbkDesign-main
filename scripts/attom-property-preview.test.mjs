import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { lookupAttomPropertyPreview } from './attom-property-preview.mjs';

const input = { street: '123 Fixture Avenue Apt 2', city: 'Example City', state: 'CA', zip: '90210' };
const parcel = {
  identifier: { attomId: 12345, fips: '06037', apn: '001-02' },
  address: { line1: '123 FIXTURE AVE #2', locality: 'EXAMPLE CITY', countrySubd: 'CA', postal1: '90210' },
  lot: { lotSize1: 0.2, lotSize2: 8712 },
  summary: { propType: 'Condominium', yearBuilt: 1986 },
  building: { size: { livingSize: 1200, bldgSize: 1700 }, rooms: { beds: 2, bathsTotal: 1.5 } },
  assessment: { tax: { taxAmt: 3600, taxYear: 2025 }, owner: { owner1: { lastname: 'Do Not Return' } } },
  sale: { saleAmountData: { saleAmt: 430000, saleRecDate: '2024-01-02' } },
  photoUrls: ['https://example.invalid/private.jpg'],
};
const reply = (property) => Response.json({ status: { code: 0 }, property });
const config = (request) => ({ enabled: true, apiKey: 'fixture-only', request });

test('sends only the structured address to ATTOM and projects an allowlisted preview', async () => {
  const result = await lookupAttomPropertyPreview({ ...input, email: 'not-for-attom@example.invalid' },
    config(async (url, options) => {
      assert.equal(url.origin + url.pathname, 'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile');
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        address1: input.street, address2: 'Example City, CA 90210',
      });
      assert.equal(options.headers.apikey, 'fixture-only');
      assert.equal(options.redirect, 'error');
      return reply([parcel]);
    }));
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.profile, {
    address: '123 FIXTURE AVE #2, EXAMPLE CITY, CA 90210',
    attomId: '12345', fips: '06037', apn: '001-02', propertyType: 'Condominium',
    lotSqft: 8712, lotAcres: 0.2, livingSqft: 1200, beds: 2, baths: 1.5,
    yearBuilt: 1986, taxAmount: 3600, taxYear: 2025,
    recordedSaleAmount: 430000, recordedSaleDate: '2024-01-02',
  });
});

test('never chooses the wrong unit or a duplicate exact parcel', async () => {
  const wrong = { ...parcel, address: { ...parcel.address, line1: '123 FIXTURE AVE #3' } };
  assert.equal((await lookupAttomPropertyPreview(input, config(async () => reply([wrong])))).status, 'ambiguous');
  assert.equal((await lookupAttomPropertyPreview(input, config(async () => reply([parcel, parcel])))).status, 'ambiguous');
});

test('accepts a comma-separated address, but refuses incomplete or conflicting input before fetching', async () => {
  const full = { street: '123 Fixture Avenue Apt 2, Example City, CA 90210' };
  assert.equal((await lookupAttomPropertyPreview(full, config(async () => reply([parcel])))).status, 'matched');
  const noRequest = config(async () => assert.fail('No upstream request expected'));
  assert.equal((await lookupAttomPropertyPreview({ street: input.street }, noRequest)).status, 'invalid_address');
  assert.equal((await lookupAttomPropertyPreview({ ...full, city: 'Different City' }, noRequest)).status, 'invalid_address');
});

test('keeps disabled, no results, and provider failure separate', async () => {
  assert.equal((await lookupAttomPropertyPreview(input, {
    ...config(async () => assert.fail('No upstream request expected')), enabled: false,
  })).status, 'not_configured');
  assert.equal((await lookupAttomPropertyPreview(input,
    config(async () => Response.json({ status: { code: 400 } }, { status: 400 })))).status, 'not_found');
  assert.equal((await lookupAttomPropertyPreview(input,
    config(async () => Response.json({ status: { code: 0 } })))).status, 'unavailable');
});

test('reports actionable failure categories without exposing upstream content or retrying', async () => {
  for (const [http, expected] of [[401, 'authorization_failed'], [403, 'authorization_failed'],
    [429, 'rate_limited'], [500, 'unavailable']]) {
    let attempts = 0;
    const result = await lookupAttomPropertyPreview(input, config(async () => {
      attempts += 1;
      return Response.json({ diagnostic: 'sensitive upstream payload' }, { status: http });
    }));
    assert.deepEqual(result, { status: expected });
    assert.equal(attempts, 1);
  }
  assert.deepEqual(await lookupAttomPropertyPreview(input, config(async () => {
    throw new DOMException('sensitive error message', 'TimeoutError');
  })), { status: 'timed_out' });
});
