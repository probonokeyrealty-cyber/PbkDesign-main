import { parseAttomAddress, sameAttomAddress, attomStreetKey } from './attom-property-preview.mjs';
import { attomMcpDatasetDefinitions, projectAttomMcpSection, strictAttomMcpDate } from '../src/app/utils/attomMcpSections.mjs';

const label = a => `${a.street}, ${a.city}, ${a.state} ${a.zip}`;
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const identifier = v => (typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) && /^[A-Za-z0-9 ._-]{1,100}$/.test(String(v)) ? String(v).trim().toUpperCase().replace(/[ ._-]/g, '') || undefined : undefined;
const addressOf = v => {
  if (typeof v === 'string') return parseAttomAddress({ street: v });
  if (!object(v)) return null;
  const parsed = parseAttomAddress({ street: v.oneLine || v.line1, city: v.city || v.locality, state: v.state || v.countrySubd, zip: v.postalCode || v.postal1 });
  // A provider may return both oneLine and split fields. Neither may hide a
  // conflicting address; oneLine supplies missing split components only.
  if (parsed && v.oneLine && v.line1 && attomStreetKey(parsed.street) !== attomStreetKey(v.line1)) return null;
  return parsed;
};
const safeText = v => typeof v === 'string' && v.length > 0 && v.length <= 500 && !/[\x00-\x1f<>]/.test(v) && !/https?:\/\//i.test(v) ? v : null;
const numeric = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e15;
const positiveMeasurement = v => v > 0 ? v : undefined;
const failureStatus = error => {
  const code = String(error?.code || error?.name || '');
  if (/not_configured/.test(code)) return 'not_configured';
  if (/timeout|timed_out|abort/i.test(code)) return 'timed_out';
  if (/auth|unauthorized|forbidden/i.test(code)) return 'authorization_failed';
  if (/rate|429/i.test(code)) return 'rate_limited';
  return 'unavailable';
};

// Only subject identities are traversed. Comp/market candidates are distinct
// properties and are independently validated below, never subject evidence.
function subjectIdentities(value, visit, excluded = [], depth = 0) {
  if (depth > 12) { visit({ attomId: '!invalid' }); return; }
  if (Array.isArray(value)) { for (const child of value) subjectIdentities(child, visit, [], depth + 1); return; }
  if (!object(value)) return;
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (excluded.includes(key)) continue;
    if (object(child) || Array.isArray(child)) subjectIdentities(child, visit, [], depth + 1);
  }
}

function validIdentity(canonical, address, datasets) {
  const resolved = addressOf(canonical?.address);
  const attomId = identifier(canonical?.attomId);
  if (!attomId || !resolved || !sameAttomAddress(resolved, address)) return false;
  const expected = { attomId, apn: identifier(canonical?.identifiers?.apn), fips: identifier(canonical?.identifiers?.fips) };
  let valid = true;
  const check = v => {
    for (const [inputKey, key] of [['attomId', 'attomId'], ['apn', 'apn'], ['parcelId', 'apn'], ['fips', 'fips']]) {
      if (v[inputKey] === undefined || v[inputKey] === null || v[inputKey] === '') continue;
      const id = identifier(v[inputKey]);
      if (!id || (expected[key] && id !== expected[key])) valid = false;
      else if (!expected[key]) expected[key] = id;
    }
    if (v.address !== undefined && v.address !== null) {
      const candidate = addressOf(v.address);
      if (!candidate || !sameAttomAddress(candidate, address)) valid = false;
    }
  };
  subjectIdentities(canonical, check);
  for (const result of datasets) {
    // Array records can carry subject identifiers too, though the observed
    // sales/mortgage/tax shapes do not. Never ignore an explicit conflict.
    const data = result?.data;
    const excluded = result.dataset === 'comparables' ? ['results'] : result.dataset === 'market-context' ? ['recentSales'] : result.dataset === 'schools' ? ['assignedSchools', 'assignedDistricts', 'nearbySchools', 'performanceContext'] : [];
    subjectIdentities(data, check, excluded);
  }
  return valid;
}

function comparableSales(data, address, subjectId, radius, checkedAt) {
  const windowStart = strictAttomMcpDate(data?.criteria?.saleDateFrom);
  const windowEnd = strictAttomMcpDate(data?.criteria?.saleDateTo);
  const sourceRadius = data?.criteria?.maxDistanceMiles;
  if (!windowStart || !windowEnd || windowStart > windowEnd || !numeric(sourceRadius) || sourceRadius <= 0 || sourceRadius > 100 || !Array.isArray(data?.results)) return undefined;
  const coveredRadius = Math.min(radius, sourceRadius);
  const subject = addressOf(data?.subject?.address);
  if (!subject || !sameAttomAddress(subject, address) || identifier(data?.subject?.attomId) !== identifier(subjectId)) return undefined;
  const seen = new Set();
  const sales = data.results.flatMap(row => {
    const parsed = addressOf(row?.address), id = identifier(row?.attomId), soldDate = strictAttomMcpDate(row?.saleDate);
    if (!parsed || !id || id === identifier(subjectId) || sameAttomAddress(parsed, address) || attomStreetKey(parsed.street) === attomStreetKey(address.street) || !soldDate || soldDate < windowStart || soldDate > windowEnd || !numeric(row.salePrice) || row.salePrice <= 0 || !numeric(row.distanceMiles) || row.distanceMiles > coveredRadius) return [];
    if (['squareFootage', 'bedrooms', 'fullBathrooms', 'partialBathrooms', 'pricePerSqFt', 'normalizedScore'].some(k => row[k] != null && !numeric(row[k]))) return [];
    const key = label(parsed).toUpperCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const sqft = numeric(row.squareFootage) && row.squareFootage > 0 ? row.squareFootage : null;
    return [{ id: `attom-mcp-${id}-${soldDate}`, address: label(parsed), soldDate, price: row.salePrice, distanceMiles: row.distanceMiles, beds: row.bedrooms ?? null, baths: row.fullBathrooms == null ? null : row.fullBathrooms + (row.partialBathrooms || 0) * 0.5, sqft, pricePerSqft: row.pricePerSqFt ?? (sqft ? row.salePrice / sqft : null), propertyType: safeText(row.propertyUse) }];
  }).slice(0, 20);
  if (!sales.length) return undefined;
  return { status: 'matched', source: 'ATTOM', retrievedAt: checkedAt, windowStart, windowEnd, radiusMiles: coveredRadius, partial: true, sales };
}

function propertyProfile(identity, sections, address) {
  const overview = sections.find(section => section.id === 'overview')?.facts ?? {};
  const ownership = sections.find(section => section.id === 'ownership')?.facts;
  const geography = sections.find(section => section.id === 'geography-context')?.facts;
  const yearBuilt = overview['characteristics.yearBuilt'];
  const tax = sections.find(section => section.id === 'tax-history')?.rows
    .find(row => row.taxYear >= 1000 && row.tax !== undefined);
  const transfer = sections.find(section => section.id === 'sales-history')?.rows
    .find(row => row.recordedDate && row.price > 0);

  return Object.fromEntries(Object.entries({
    address: label(address),
    attomId: String(identity.attomId),
    apn: safeText(identity.identifiers?.apn),
    fips: safeText(identity.identifiers?.fips),
    propertyType: overview['summary.propertyType'] ?? overview['characteristics.propertyUse'],
    beds: overview['characteristics.bedrooms'],
    baths: overview['characteristics.bathrooms'],
    livingSqft: positiveMeasurement(overview['characteristics.livingAreaSquareFeet']),
    yearBuilt: yearBuilt >= 1000 ? yearBuilt : undefined,
    lotSqft: positiveMeasurement(overview['characteristics.lotSquareFeet']),
    lotAcres: positiveMeasurement(overview['characteristics.lotAcres']),
    zoning: overview['characteristics.zoning'],
    ownerName: overview['summary.ownerName'],
    ownerMailingAddress: ownership?.mailingAddress,
    subdivision: geography?.['summary.subdivision'],
    assessedTotalValue: overview['summary.assessedValue'],
    assessmentMarketTotalValue: overview['summary.assessorMarketValue'],
    taxAmount: tax?.tax,
    taxYear: tax?.taxYear,
    recordedSaleAmount: transfer?.price,
    recordedSaleDate: transfer?.recordedDate,
    saleTransactionDate: transfer?.saleDate,
    saleDocumentNumber: transfer?.documentNumber,
  }).filter(([, value]) => value !== undefined));
}

export function createAttomMcpPropertyReader({ client, now = () => new Date().toISOString() }) {
  return async function read(addressInput, { radius = 1 } = {}) {
    const address = typeof addressInput === 'string' ? parseAttomAddress({ street: addressInput }) : parseAttomAddress(addressInput);
    if (!address) return { status: 'invalid_address', sections: [] };
    if (![0.5, 1, 2, 5].includes(radius)) return { status: 'invalid_address', sections: [] };
    const checkedAt = now();
    const empty = status => ({ status, sections: attomMcpDatasetDefinitions.map(d => projectAttomMcpSection(d.id, undefined, status, checkedAt)) });
    let response;
    try {
      response = await client.getPropertyData({ property: { lookupMode: 'splitAddress', address1: address.street, address2: `${address.city}, ${address.state} ${address.zip}` }, datasets: attomMcpDatasetDefinitions.map(d => d.id) });
    } catch (error) { return empty(failureStatus(error)); }
    const payload = response?.structuredContent;
    if (response?.isError || !object(payload) || !['ok', 'partial'].includes(payload.status) || !Array.isArray(payload.results)) return empty('unavailable');
    if (!validIdentity(payload.property, address, payload.results)) return empty('ambiguous');
    const seen = new Set();
    for (const r of payload.results) { if (!attomMcpDatasetDefinitions.some(d => d.id === r?.dataset) || seen.has(r.dataset)) return empty('ambiguous'); seen.add(r.dataset); }
    const sections = attomMcpDatasetDefinitions.map(d => { const r = payload.results.find(r => r.dataset === d.id); return projectAttomMcpSection(d.id, r?.data, r?.status || 'not_available', checkedAt); });
    const profile = propertyProfile(payload.property, sections, address);
    const comp = payload.results.find(r => r.dataset === 'comparables' && r.status === 'ok');
    const sales = comp ? comparableSales(comp.data, address, profile.attomId, radius, checkedAt) : undefined;
    return { status: 'matched', profile, sections, ...(sales ? { sales } : {}) };
  };
}
