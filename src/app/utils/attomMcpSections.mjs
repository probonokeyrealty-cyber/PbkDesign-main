// Observed ATTOM MCP dataset dictionary. Provider labels and arbitrary JSON are
// deliberately excluded from both projection and saved-record hydration.
const field = (key, label, kind = 'string', unit) => ({ key, label, kind, ...(unit ? { unit } : {}) });
const humanLabel = key => {
  if (key === 'attomId') return 'ATTOM ID';
  if (key === 'parcelId') return 'Parcel ID';
  if (key === 'address.line1') return 'Street address';
  if (key === 'loanToValueRatio') return 'Loan to value (provider reported)';
  const clean = key.replace(/^(?:summary|characteristics|panelContext|criteria|identifiers)\./, '').replace(/^valuation\./, 'valuation ').replace(/^rentalValuation\./, 'rental ').replace(/^equity\./, 'equity ').replace(/^zipContext\./, 'ZIP area ').replace(/^nearbyContext\./, 'nearby area ');
  const text = clean.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('.', ' ').toLowerCase().replace(/sq ft/g, 'sq ft').replace(/\bapn\b/g, 'APN').replace(/\bfips\b/g, 'FIPS').replace(/\bzip\b/g, 'ZIP');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const strings = (...keys) => keys.map(k => field(k, humanLabel(k)));
const unit = key => /(?:percent|ratio|pct)$/i.test(key) ? (/ratio/i.test(key) ? 'ratio' : '%') : /(?:pricePerSqFt)/i.test(key) ? 'USD/sq ft' : /(?:squareFeet|squareFootage)$/i.test(key) ? 'sq ft' : /acres$/i.test(key) ? 'acres' : /(?:distance|radius|maxDistance)Miles$/i.test(key) ? 'mi' : /(?:price|amount|value|debt|equity|tax|valueMin|valueMax|valueHigh|valueLow|value365d|price365d)$/i.test(key) && !/(?:year|count|ratio|percent|confidence)/i.test(key) ? 'USD' : undefined;
const nums = (...keys) => keys.map(k => field(k, humanLabel(k), 'number', k === 'loanToValueRatio' ? undefined : unit(k)));
const dates = (...keys) => keys.map(k => field(k, humanLabel(k), 'date'));
const def = (id, title, group, fields = [], columns = [], rowsPath = '', note = '') => ({ id, title, group, note, fields, columns, rowsPath });
const estimate = 'Dated provider estimate, not an appraisal, payoff, ARV, MAO or approved offer.';
export const attomMcpDatasetDefinitions = Object.freeze([
  def('identity', 'Property identity', 'Property', [...strings('attomId', 'parcelId', 'identifiers.apn', 'identifiers.fips', 'address.line1', 'address.city', 'address.state', 'address.postalCode')]),
  def('overview', 'Property overview', 'Property', [...strings('summary.propertyType', 'summary.ownerName', 'characteristics.propertyUse', 'characteristics.zoning'), ...nums('summary.assessedValue', 'summary.assessorMarketValue', 'summary.lastSaleAmount', 'characteristics.bedrooms', 'characteristics.bathrooms', 'characteristics.livingAreaSquareFeet', 'characteristics.lotSquareFeet', 'characteristics.lotAcres', 'characteristics.yearBuilt', 'characteristics.rooms', 'characteristics.garageSpaces'), ...dates('summary.lastSaleDate')]),
  def('geo', 'Coordinates', 'Property', [field('latitude', 'Latitude', 'latitude'), field('longitude', 'Longitude', 'longitude')]),
  def('geography-context', 'Geography context', 'Market', strings('summary.broadestLayer', 'summary.subdivision'), [...strings('geographyType', 'geographyName', 'scope'), ...nums('saleCount90d', 'saleCount180d', 'saleCount365d', 'medianSalePrice365d', 'medianPricePerSqFt365d'), ...dates('latestSaleDate')], 'layers'),
  def('sales-history', 'Recorded sales', 'History', [], [...dates('saleDate', 'recordedDate'), ...nums('price'), ...strings('buyers', 'sellers', 'documentNumber')]),
  def('tax-history', 'Tax history', 'History', [], [...nums('taxYear', 'tax', 'totalValue', 'landValue', 'improvementValue', 'improvementRatio'), ...dates('updateDate')]),
  def('ownership', 'Ownership', 'Ownership', [field('names', 'Owner names', 'names'), ...strings('mailingAddress'), field('ownerOccupied', 'Owner occupied', 'boolean')]),
  def('ownership-periods', 'Ownership periods', 'Ownership', [...nums('summary.totalOwnershipPeriods'), ...dates('summary.latestOwnershipChangeDate')], [...strings('label', 'anchorState'), field('ownerNames', 'Owner names', 'names'), ...dates('startDate', 'endDate'), field('isCurrentOwnerPeriod', 'Current period', 'boolean')], 'ownershipPeriods', 'Ownership periods are inferred from available recorded evidence; gaps and unanchored periods may exist.'),
  def('mortgage-history', 'Recorded financing', 'History', [], [...dates('recordingDate', 'mortgageDate'), field('originalAmount', 'Original loan amount', 'number', 'USD'), ...nums('position'), ...strings('lender', 'documentNumber', 'loanType', 'lenderType')], '', 'Original recorded financing amounts are not current balances or payoff quotes.'),
  def('valuation', 'Valuation estimates', 'Estimates', [...nums('valuation.value', 'valuation.valueMin', 'valuation.valueMax', 'valuation.confidenceScore', 'rentalValuation.value', 'equity.estimatedValue', 'equity.estimatedDebt', 'equity.availableEquity', 'equity.equityPercent'), ...dates('valuation.estimatedDate', 'valuation.updateDate')], [], '', estimate),
  def('rental-valuation', 'Rental estimate', 'Estimates', [...nums('value', 'valueMin', 'valueMax'), ...dates('estimatedDate', 'updateDate')], [], '', estimate),
  def('equity', 'Equity estimates', 'Estimates', nums('estimatedValue', 'estimatedDebt', 'availableEquity', 'equityPercent', 'loanToValueRatio'), [], '', `${estimate} Loan to value is provider reported with unverified scale and meaning; verify with the source before interpretation. No normalization is applied.`),
  def('market-context', 'Market context', 'Market', [...nums('zipContext.saleCount', 'zipContext.medianSalePrice', 'zipContext.medianPricePerSqFt', 'nearbyContext.radiusMiles', 'nearbyContext.saleCount', 'nearbyContext.medianSalePrice', 'nearbyContext.medianPricePerSqFt'), ...dates('zipContext.latestSaleDate', 'nearbyContext.latestSaleDate')]),
  def('comparables', 'Comparable sales coverage', 'Market', [...dates('criteria.saleDateFrom', 'criteria.saleDateTo'), ...nums('criteria.maxDistanceMiles', 'criteria.limit')], [], '', 'Ranked, bounded candidate coverage only. Valid nearby candidates appear in the existing Comps tab; this is not an exhaustive market search.'),
  def('foreclosure-history', 'Foreclosure records', 'History', [], [], '', 'Unavailable or empty records do not establish absence of distress. No verified foreclosure field schema is available.'),
  def('timeline', 'Property timeline', 'History', [...nums('summary.totalEvents', 'summary.criticalEventCount'), ...dates('summary.latestEventDate', 'summary.earliestEventDate')], [...strings('eventType', 'category', 'summary'), ...dates('eventDate', 'recordedDate'), ...nums('amount')], 'items'),
  def('permits', 'Permit records', 'Property', [], [], '', 'Permit access or a verified field schema is unavailable.'),
  def('schools', 'School context', 'Context', [], [...strings('name', 'schoolType', 'address', 'districtName', 'assignmentBasis', 'assignmentConfidence'), ...nums('distanceMiles')], 'assignedSchools', 'School assignments and boundaries require verification with the district.'),
  def('fema-context', 'FEMA context', 'Context', [...strings('evidenceStatus', 'panelContext.zoneCode', 'panelContext.zoneDescription', 'panelContext.panel', 'panelContext.communityId', 'panelContext.firmPanel'), ...dates('panelContext.panelDate')], [], '', 'Map context is evidence, not an insurance or flood determination.'),
  def('valuation-history', 'Valuation history', 'Estimates', [], [...dates('eventDate'), ...nums('value', 'valueHigh', 'valueLow', 'confidenceScore', 'forecastStandardDeviation')], 'points', estimate),
].map(d => Object.freeze({ ...d, fields: Object.freeze(d.fields.map(Object.freeze)), columns: Object.freeze(d.columns.map(Object.freeze)) })));

export const attomMcpSectionStatuses = Object.freeze(['ok', 'partial', 'not_entitled', 'not_available', 'unavailable', 'timed_out', 'unsupported', 'authorization_failed', 'rate_limited', 'not_found']);
const registry = new Map(attomMcpDatasetDefinitions.map(d => [d.id, d]));
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const path = (v, key) => key.split('.').reduce((a, k) => object(a) && Object.hasOwn(a, k) ? a[k] : undefined, v);
export const strictAttomMcpDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z?)?$/.test(value)) return undefined;
  const day = value.slice(0, 10);
  return Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day ? day : undefined;
};
const time = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) && strictAttomMcpDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
const safeString = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 500 && !/[\x00-\x1f\x7f<>]/.test(v) && !/(?:https?:\/\/|bearer\s|sk-proj-|-----BEGIN)/i.test(v) ? v.trim() : undefined;
function scalar(v, f, saved) {
  if (f.kind === 'date') return strictAttomMcpDate(v);
  if (f.kind === 'boolean') return typeof v === 'boolean' ? v : undefined;
  if (['number', 'latitude', 'longitude'].includes(f.kind)) {
    const max = f.kind === 'latitude' ? 90 : f.kind === 'longitude' ? 180 : /(?:yearBuilt|taxYear)$/i.test(f.key) ? 3000 : /(?:bedrooms|bathrooms|rooms|garageSpaces|position)$/i.test(f.key) ? 10000 : 1e15;
    const signedEquity = ['availableEquity', 'equityPercent', 'equity.availableEquity', 'equity.equityPercent'].includes(f.key);
    const min = f.kind === 'latitude' ? -90 : f.kind === 'longitude' ? -180 : signedEquity ? -1e15 : 0;
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  }
  if (f.kind === 'names' && !saved) return Array.isArray(v) && v.length <= 8 && v.every(n => safeString(n)) ? safeString(v.join('; ')) : undefined;
  return safeString(v);
}
function projectValues(value, fields, saved = false) {
  return Object.fromEntries(fields.flatMap(f => { const v = scalar(saved ? value?.[f.key] : path(value, f.key), f, saved); return v === undefined ? [] : [[f.key, v]]; }));
}
const hasEvidence = s => Object.keys(s.facts).length > 0 || s.rows.length > 0;
const historyKey = id => ({ 'tax-history': 'taxYear', 'sales-history': 'saleDate', 'mortgage-history': 'recordingDate', 'ownership-periods': 'startDate', timeline: 'eventDate', 'valuation-history': 'eventDate' })[id];
const rowKey = (s, r) => { const key = historyKey(s.id); return key && r[key] !== undefined ? String(r[key]) + (r.documentNumber ? `|${r.documentNumber}` : '') : undefined; };
function losesCoverage(prior, next) {
  if (Object.keys(prior.facts).some(k => !Object.hasOwn(next.facts, k)) || prior.rows.length > next.rows.length) return true;
  for (const row of prior.rows) {
    const key = rowKey(prior, row);
    const fresh = key ? next.rows.find(r => rowKey(next, r) === key) : next.rows[prior.rows.indexOf(row)];
    if (fresh && Object.keys(row).some(k => !Object.hasOwn(fresh, k))) return true;
    if (!fresh && !next.truncated) return true;
  }
  return false;
}
function cleanStatus(v) { return attomMcpSectionStatuses.includes(v) ? v : 'unavailable'; }

export function projectAttomMcpSection(id, data, status, checkedAt) {
  const d = registry.get(id);
  if (!d || !time(checkedAt)) throw new TypeError('Invalid ATTOM section identity or timestamp');
  const s = { id, status: cleanStatus(status), checkedAt, facts: {}, rows: [], caveats: d.note ? [d.note] : [] };
  if (s.status !== 'ok') return s;
  if (['permits', 'foreclosure-history'].includes(id)) { s.status = Array.isArray(data) && !data.length ? 'not_available' : 'unsupported'; return s; }
  s.facts = projectValues(data, d.fields);
  const rows = d.rowsPath ? path(data, d.rowsPath) : data;
  if (d.columns.length && Array.isArray(rows)) {
    const key = historyKey(id);
    const projected = rows.map(r => projectValues(r, d.columns)).filter(r => Object.keys(r).length);
    if (key) projected.sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
    s.rows = projected.slice(0, 20);
    s.sourceRowCount = Math.min(rows.length, 10000000);
    if (rows.length > 20) s.truncated = true;
  }
  if (!hasEvidence(s)) s.status = 'not_available';
  else { s.retrievedAt = checkedAt; const generated = data?.generatedAt ?? data?.summary?.generatedAt; if (time(generated)) s.sourceGeneratedAt = generated; }
  return s;
}

export function hydrateAttomMcpSections(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(0, 20).flatMap(raw => {
    const d = registry.get(raw?.id);
    if (!d || seen.has(d.id) || !time(raw.checkedAt) || !attomMcpSectionStatuses.includes(raw.status)) return [];
    seen.add(d.id);
    const s = { id: d.id, status: raw.status, checkedAt: raw.checkedAt, facts: {}, rows: [], caveats: d.note ? [d.note] : [] };
    if (s.status === 'ok' && time(raw.retrievedAt) && !['permits', 'foreclosure-history'].includes(d.id)) {
      s.facts = projectValues(raw.facts, d.fields, true);
      s.rows = Array.isArray(raw.rows) ? raw.rows.slice(0, 20).map(r => projectValues(r, d.columns, true)).filter(r => Object.keys(r).length) : [];
      if (hasEvidence(s)) { s.retrievedAt = raw.retrievedAt; if (time(raw.sourceGeneratedAt)) s.sourceGeneratedAt = raw.sourceGeneratedAt; } else s.status = 'not_available';
    } else if (s.status === 'ok') s.status = 'not_available';
    if (time(raw.refreshStatus?.checkedAt) && attomMcpSectionStatuses.includes(raw.refreshStatus.status) && raw.refreshStatus.status !== 'ok') s.refreshStatus = { status: raw.refreshStatus.status, checkedAt: raw.refreshStatus.checkedAt };
    if (d.columns.length && Number.isSafeInteger(raw.sourceRowCount) && raw.sourceRowCount >= s.rows.length && raw.sourceRowCount <= 10000000) { s.sourceRowCount = raw.sourceRowCount; if (raw.truncated === true && raw.sourceRowCount > 20) s.truncated = true; }
    return [s];
  });
}

export function mergeAttomMcpSections(previous, incoming) {
  const old = new Map(hydrateAttomMcpSections(previous).map(s => [s.id, s]));
  for (const s of hydrateAttomMcpSections(incoming)) {
    const prior = old.get(s.id);
    const lost = prior?.status === 'ok' && s.status === 'ok' && losesCoverage(prior, s);
    old.set(s.id, prior?.status === 'ok' && (s.status !== 'ok' || lost) ? { ...prior, refreshStatus: { status: lost ? 'partial' : s.status, checkedAt: s.checkedAt } } : s);
  }
  return attomMcpDatasetDefinitions.flatMap(d => old.has(d.id) ? [old.get(d.id)] : []);
}
