import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupAttomRecentSales } from './attom-recent-sales.mjs';

const input = { street: '123 Fixture Ave', city: 'Example City', state: 'CA', zip: '90210' };
const now = new Date('2026-11-15T12:00:00Z');
const sale = (id, date = '2026-11-12', extra = {}) => ({
  identifier: { attomId: id },
  address: { line1: `${id} OTHER ST`, locality: 'Example City', countrySubd: 'CA', postal1: '90210' },
  location: { distance: 0.5 },
  sale: { saleTransDate: date, amount: { saleamt: 400000 } },
  building: { rooms: { beds: 3, bathsTotal: 2 }, size: { universalsize: 1600 } },
  ...extra,
});
const options = (rows, extra = {}) => ({ enabled: true, apiKey: 'fixture-only', now,
  request: async () => Response.json({ status: { code: 0, total: rows.length }, property: rows }), ...extra });

test('returns only the latest 20 unique, priced, nearby sales in exactly 30 calendar days', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => sale(i + 1, `2026-11-${String(15 - i % 10).padStart(2, '0')}`));
  rows.push(sale(50, '2026-10-16'), sale(51, '2026-11-16'), sale(52, '2026-11-10', { location: { distance: 2 } }), rows[0]);
  rows.push(sale(53, '2026-11-10', { sale: { saleTransDate: '2026-11-10', amount: { saleamt: 0 } } }));
  const r = await lookupAttomRecentSales(input, options(rows));
  assert.equal(r.status, 'matched'); assert.equal(r.sales.length, 20);
  assert.equal(r.windowStart, '2026-10-17'); assert.equal(r.windowEnd, '2026-11-15');
  assert.equal(new Set(r.sales.map(s => s.id)).size, 20);
  assert.ok(r.sales.every(s => s.distanceMiles <= 1 && s.soldDate >= r.windowStart && s.soldDate <= r.windowEnd));
  assert.equal(r.sales[0].pricePerSqft, 250);
  assert.equal(r.source, 'ATTOM');
});
test('validates before network access and does not pretend a disabled provider is an empty result', async () => {
  const noRequest = () => assert.fail('No request expected');
  assert.equal((await lookupAttomRecentSales({}, options([], { request: noRequest }))).status, 'invalid_address');
  assert.equal((await lookupAttomRecentSales({ ...input, radius: 50 }, options([], { request: noRequest }))).status, 'invalid_radius');
  assert.equal((await lookupAttomRecentSales(input, options([], { enabled: false, request: noRequest }))).status, 'not_configured');
});
test('uses the operating timezone instead of including tomorrow after UTC midnight', async () => {
  const r = await lookupAttomRecentSales(input, options([], { now: new Date('2026-11-16T01:00:00Z') }));
  assert.equal(r.windowEnd, '2026-11-15'); assert.equal(r.windowStart, '2026-10-17');
});
test('bounds provider parameters, excludes the subject, and never projects ownership data', async () => {
  let calls = 0;
  const r = await lookupAttomRecentSales(input, options([], { request: async (url, init) => {
    calls++; assert.equal(url.origin, 'https://api.gateway.attomdata.com');
    assert.equal(url.pathname, '/propertyapi/v1.0.0/sale/snapshot');
    assert.equal(url.searchParams.get('radius'), '1');
    assert.equal(url.searchParams.get('startSaleTransDate'), '2026/10/17');
    assert.equal(url.searchParams.get('orderBy'), 'SaleTransactionDate desc');
    assert.equal(init.redirect, 'error');
    return Response.json({ status: { code: 0, total: 2 }, property: [sale(1, '2026-11-10', { owner: 'private' }), sale(2, '2026-11-10', { address: { line1: input.street, locality: input.city, countrySubd: input.state, postal1: input.zip } })] });
  }}));
  assert.equal(calls, 1); assert.equal(r.sales.length, 1); assert.ok(!JSON.stringify(r).includes('private'));
});
test('surfaces timeouts and authorization failures without provider error bodies', async () => {
  for (const [status, expected] of [[401, 'authorization_failed'], [429, 'rate_limited'], [500, 'unavailable']]) {
    const r = await lookupAttomRecentSales(input, options([], { request: async () => new Response('private', { status }) }));
    assert.equal(r.status, expected); assert.ok(!JSON.stringify(r).includes('private'));
  }
  assert.equal((await lookupAttomRecentSales(input, options([], { request: async () => { throw new DOMException('private', 'TimeoutError'); } }))).status, 'timed_out');
});
