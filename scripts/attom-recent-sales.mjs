import { parseAttomAddress, attomStreetKey } from './attom-property-preview.mjs';

const text = v => typeof v === 'string' ? v.trim() : '';
const numeric = v => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
const positive = v => numeric(v) > 0 ? numeric(v) : null;
const key = v => text(v).toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
function date(v) {
  const value = text(v).slice(0, 10);
  const parsed = new Date(value + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export async function lookupAttomRecentSales(input, {
  enabled = process.env.PBK_ATTOM_LOOKUP_ENABLED === 'true',
  apiKey = process.env.ATTOM_API_KEY, request = fetch, now = new Date(),
  timeZone = process.env.PBK_PROPERTY_TIMEZONE || 'America/Los_Angeles',
} = {}) {
  const address = parseAttomAddress(input);
  if (!address) return { status: 'invalid_address' };
  const radius = input.radius === undefined ? 1 : Number(input.radius);
  if (![0.5, 1, 2, 5].includes(radius)) return { status: 'invalid_radius' };
  if (!enabled || !text(apiKey)) return { status: 'not_configured' };
  const dayParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  const windowEnd = `${dayParts.year}-${dayParts.month}-${dayParts.day}`;
  const start = new Date(windowEnd + 'T00:00:00Z'); start.setUTCDate(start.getUTCDate() - 29);
  const windowStart = start.toISOString().slice(0, 10);
  const metadata = { source: 'ATTOM', retrievedAt: now.toISOString(), windowStart, windowEnd, timeZone, radiusMiles: radius };
  const found = new Map();
  const signal = AbortSignal.timeout(6500);
  let partial = false;
  try {
    for (let page = 1; page <= 3; page++) {
      const url = new URL('https://api.gateway.attomdata.com/propertyapi/v1.0.0/sale/snapshot');
      const params = { address1: address.street, address2: `${address.city}, ${address.state} ${address.zip}`,
        radius, startSaleTransDate: windowStart.replaceAll('-', '/'), endSaleTransDate: windowEnd.replaceAll('-', '/'),
        orderBy: 'SaleTransactionDate desc', page, pagesize: 100 };
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      const response = await request(url, { headers: { Accept: 'application/json', apikey: text(apiKey) }, redirect: 'error', signal });
      if ([401, 403].includes(response.status)) return { status: 'authorization_failed' };
      if (response.status === 429) return { status: 'rate_limited' };
      if ([408, 504].includes(response.status)) return { status: 'timed_out' };
      if (!response.ok && response.status !== 400) return { status: 'unavailable' };
      const data = await response.json();
      if (String(data?.status?.code) === '400') break;
      if (!response.ok || String(data?.status?.code) !== '0' || !Array.isArray(data.property)) return { status: 'unavailable' };
      for (const row of data.property) {
        const a = row.address;
        const soldDate = date(row.sale?.saleTransDate);
        const price = positive(row.sale?.amount?.saleamt);
        const distanceMiles = numeric(row.location?.distance);
        if (!a?.line1 || !a.locality || !a.countrySubd || !a.postal1 || !soldDate || soldDate < windowStart || soldDate > windowEnd || !price || distanceMiles === null || distanceMiles < 0 || distanceMiles > radius) continue;
        if (attomStreetKey(a.line1) === attomStreetKey(address.street) && key(a.locality) === key(address.city) && key(a.countrySubd) === key(address.state) && text(a.postal1).slice(0, 5) === address.zip.slice(0, 5)) continue;
        const label = `${text(a.line1)}, ${text(a.locality)}, ${text(a.countrySubd)} ${text(a.postal1).slice(0, 5)}`;
        const id = String(row.identifier?.attomId || key(label));
        const sqft = positive(row.building?.size?.universalsize ?? row.building?.size?.livingSize);
        const prior = found.get(id);
        if (prior && prior.soldDate >= soldDate) continue;
        found.set(id, { id, address: label, soldDate, price, distanceMiles,
          beds: numeric(row.building?.rooms?.beds), baths: numeric(row.building?.rooms?.bathsTotal),
          sqft, pricePerSqft: sqft ? Math.round(price / sqft) : null,
          propertyType: text(row.summary?.propertyType || row.summary?.proptype) || null });
      }
      const total = numeric(data.status?.total);
      const more = total === null ? data.property.length === 100 : total > page * 100;
      if (!more) break;
      if (found.size >= 20 || page === 3) { partial = true; break; }
    }
    const sales = [...found.values()].sort((a, b) => b.soldDate.localeCompare(a.soldDate) || a.distanceMiles - b.distanceMiles).slice(0, 20);
    return { status: 'matched', ...metadata, partial, sales };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' || signal.aborted ? 'timed_out' : 'unavailable' };
  }
}
