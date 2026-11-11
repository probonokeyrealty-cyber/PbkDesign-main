const endpoint = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile';
const text = (value) => typeof value === 'string' ? value.trim() : '';
const normalized = (value) => text(value).toUpperCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
const zip5 = (value) => /^\d{5}(?:-\d{4})?$/.test(text(value)) ? text(value).slice(0, 5) : '';
const identifier = (value) => Number.isSafeInteger(value) && value > 0 ? String(value) : text(value) || null;
const suffix = { STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', LANE: 'LN',
  ROAD: 'RD', COURT: 'CT', PLACE: 'PL', CIRCLE: 'CIR', TERRACE: 'TER', WAY: 'WAY' };

function streetKey(value) {
  const parts = normalized(value).replace(/\s*#\s*/g, ' UNIT ').split(/ (?:APT|UNIT) /);
  const street = parts[0].replace(/ ([A-Z]+)$/, (full, word) => suffix[word] ? ' ' + suffix[word] : full);
  return [street, ...parts.slice(1)].join(' UNIT ');
}

function parseAddress(input) {
  let street = text(input?.street);
  let city = text(input?.city);
  let state = text(input?.state).toUpperCase();
  let zip = text(input?.zip);
  const full = street.match(/^(.+),\s*([^,]+),\s*([a-z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (full) {
    if ((city && normalized(city) !== normalized(full[2])) ||
      (state && state !== full[3].toUpperCase()) || (zip && zip5(zip) !== zip5(full[4]))) return null;
    [, street, city, state, zip] = full.map((part) => part.trim());
    state = state.toUpperCase();
  }
  if (!/^\d[\dA-Z-]*\s+\S/i.test(street) || street.length > 150 ||
    /[,\r\n]/.test(street) || !city || city.length > 80 || /[,\r\n]/.test(city) ||
    !/^[A-Z]{2}$/.test(state) || !zip5(zip)) return null;
  return { street, city, state, zip };
}

function number(value, min = 0) {
  if (typeof value !== 'number' && !/^\d+(?:\.\d+)?$/.test(text(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? n : null;
}

function project(row) {
  const { address, identifier: id, lot, summary, building, assessment, sale } = row;
  const tax = assessment?.tax;
  const amount = sale?.saleAmountData;
  return {
    address: `${text(address.line1)}, ${text(address.locality)}, ${text(address.countrySubd)} ${zip5(address.postal1)}`,
    attomId: identifier(id.attomId), fips: identifier(id.fips), apn: identifier(id.apn),
    propertyType: text(summary?.propType) || text(summary?.propertyType) || null,
    lotSqft: number(lot?.lotSize2, 1), lotAcres: number(lot?.lotSize1, 0.00001),
    livingSqft: number(building?.size?.livingSize, 1),
    beds: number(building?.rooms?.beds), baths: number(building?.rooms?.bathsTotal),
    yearBuilt: number(summary?.yearBuilt, 1000),
    taxAmount: number(tax?.taxAmt), taxYear: number(tax?.taxYear, 1000),
    recordedSaleAmount: number(amount?.saleAmt, 1),
    recordedSaleDate: /^\d{4}-\d{2}-\d{2}$/.test(text(amount?.saleRecDate)) ? text(amount.saleRecDate) : null,
  };
}

export async function lookupAttomPropertyPreview(input, {
  enabled = process.env.PBK_ATTOM_LOOKUP_ENABLED === 'true',
  apiKey = process.env.ATTOM_API_KEY,
  request = fetch,
} = {}) {
  const address = parseAddress(input);
  if (!address) return { status: 'invalid_address' };
  if (!enabled || !text(apiKey)) return { status: 'not_configured' };

  try {
    const url = new URL(endpoint);
    url.searchParams.set('address1', address.street);
    url.searchParams.set('address2', `${address.city}, ${address.state} ${address.zip}`);
    const response = await request(url, {
      headers: { Accept: 'application/json', apikey: text(apiKey) },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401 || response.status === 403) return { status: 'authorization_failed' };
    if (response.status === 429) return { status: 'rate_limited' };
    if (response.status === 408 || response.status === 504) return { status: 'timed_out' };
    if (!response.ok && response.status !== 400) return { status: 'unavailable' };
    const payload = await response.json();
    const code = String(payload?.status?.code ?? '');
    if (code === '400') return { status: 'not_found' };
    if (!response.ok || code !== '0' || !Array.isArray(payload.property)) return { status: 'unavailable' };
    if (!payload.property.length) return { status: 'not_found' };
    const exact = payload.property.filter(({ address: candidate } = {}) => candidate &&
      streetKey(candidate.line1) === streetKey(address.street) &&
      normalized(candidate.locality) === normalized(address.city) &&
      normalized(candidate.countrySubd) === address.state &&
      zip5(candidate.postal1) === zip5(address.zip));
    const row = exact.length === 1 ? exact[0] : null;
    const id = row?.identifier;
    if (!id || !/^(?:|N|NO|0|FALSE)$/i.test(String(id.multiApn ?? '')) ||
      !(identifier(id.attomId) || (identifier(id.fips) && identifier(id.apn)))) {
      return { status: 'ambiguous' };
    }
    return { status: 'matched', profile: project(row) };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 'timed_out' : 'unavailable' };
  }
}
