import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupAddressSuggestions } from './address-suggestions.mjs';
const input = { query: '123 Sample', sessionToken: '00000000-0000-4000-8000-000000000000' };
const config = { enabled: true, apiKey: 'fixture-only' };
test('never calls a paid provider while disabled or with invalid input', async () => {
  const request = () => assert.fail('No provider call');
  assert.equal((await lookupAddressSuggestions(input, { ...config, enabled: false, request })).status, 'not_configured');
  assert.equal((await lookupAddressSuggestions({ ...input, query: 'a' }, { ...config, request })).status, 'invalid_query');
  assert.equal((await lookupAddressSuggestions({ ...input, placeId: '../secret' }, { ...config, request })).status, 'invalid_query');
});
test('projects at most five suggestions through the fixed provider origin with session billing', async () => {
  const r = await lookupAddressSuggestions(input, { ...config, request: async (url, init) => {
    assert.equal(url.href, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).sessionToken, input.sessionToken);
    return Response.json({ suggestions: Array.from({ length: 8 }, (_, i) => ({ placePrediction: { placeId: `id_${i}`, text: { text: 'Sample address' }, private: 'never' } })) });
  }});
  assert.equal(r.suggestions.length, 5); assert.ok(!JSON.stringify(r).includes('private'));
});
test('selected place details require a complete US address and preserve the unit', async () => {
  const part = (type, longText, shortText = longText) => ({ types: [type], longText, shortText });
  const r = await lookupAddressSuggestions({ ...input, placeId: 'fixture' }, { ...config, request: async (url, init) => {
    assert.equal(url.pathname, '/v1/places/fixture'); assert.equal(init.method, 'GET');
    return Response.json({ addressComponents: [part('street_number', '123'), part('route', 'Sample Ave'), part('subpremise', '2'), part('locality', 'Example City'), part('administrative_area_level_1', 'California', 'CA'), part('postal_code', '90210'), part('country', 'United States', 'US')] });
  }});
  assert.deepEqual(r.address, { street: '123 Sample Ave Unit 2', city: 'Example City', state: 'CA', zip: '90210' });
});
