import { randomUUID, timingSafeEqual } from 'node:crypto';
import { matchParcelToLeads } from './parcel-dialer.mjs';

export const COUNTY_PARCELS = 'https://dpw.gis.lacounty.gov/dpw/rest/services/GIS_Web_Services/MapServer/2';
export const CITY_BOUNDARY = 'https://maps.lacity.org/arcgis/rest/services/Mapping/Boundaries/MapServer/5';
const source = 'LA County Assessor · Parcel Boundaries';
const approvalType = 'prospecting-lead';
const sampleSize = 120;
const displayLimit = 15;
const fields = 'AIN,SitusAddress,SitusUnit,SitusCity,SitusZIP,UseDescription,Units1,SQFTmain1,YearBuilt1,Roll_Year,CENTER_LAT,CENTER_LON';

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function query(fetchImpl, layer, params) {
  try {
    const response = await fetchImpl(`${layer}/query?${new URLSearchParams({ f: 'json', ...params })}`, {
      redirect: 'error', signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Source rejected query');
    const data = await response.json();
    if (!Array.isArray(data.features) || data.error) throw new Error('Invalid source data');
    return data;
  } catch {
    fail(503, 'The public parcel or boundary source is unavailable. Try the search again.');
  }
}

function insideBoundary(rings, x, y) {
  return rings.reduce((inside, ring) => ring.reduce((hit, [ax, ay], i) => {
    const [bx, by] = ring[(i + ring.length - 1) % ring.length];
    return (ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax ? !hit : hit;
  }, inside), false);
}

function countyRecord(attributes, rings) {
  const parcelId = String(attributes.AIN || '');
  const zip = String(attributes.SitusZIP || '').match(/^\d{5}/)?.[0];
  const street = String(attributes.SitusAddress || '').trim();
  const unit = String(attributes.SitusUnit || '').trim();
  const city = String(attributes.SitusCity || '').replace(/\s+CA$/i, '').trim();
  const { CENTER_LON: longitude, CENTER_LAT: latitude } = attributes;
  if (!/^\d{10}$/.test(parcelId) || !zip || !/^\d/.test(street) || !city ||
      !Number.isFinite(longitude) || !Number.isFinite(latitude) || !insideBoundary(rings, longitude, latitude)) return null;
  const line1 = unit && !street.toUpperCase().endsWith(` ${unit.toUpperCase()}`) ? `${street} #${unit}` : street;
  return {
    parcelId, line1, city, zip, unit, longitude, latitude,
    use: String(attributes.UseDescription || '').trim() || null,
    sqft: Number(attributes.SQFTmain1) > 0 ? Number(attributes.SQFTmain1) : null,
    units: Number(attributes.Units1) > 0 ? Number(attributes.Units1) : null,
    yearBuilt: /^\d{4}$/.test(String(attributes.YearBuilt1)) ? Number(attributes.YearBuilt1) : null,
    rollYear: /^\d{4}$/.test(String(attributes.Roll_Year)) ? Number(attributes.Roll_Year) : null,
  };
}

export function createHermesParcelProspecting({
  fetchImpl = globalThis.fetch, loadLeads, localLeads = () => [], saveLead, createApproval, approvals,
  sign, prioritize, now = Date.now,
}) {
  const inFlight = new Map();

  async function countySearch({ parcelId, minSqft = 0, singleFamily = false }) {
    const city = await query(fetchImpl, CITY_BOUNDARY, {
      where: "NAME = 'VAN NUYS NC'", outFields: 'NAME', outSR: 4326, returnGeometry: true,
    });
    const rings = city.features.length === 1 && city.features[0]?.geometry?.rings;
    if (!Array.isArray(rings) || !rings.length || rings.some(ring =>
      !Array.isArray(ring) || ring.length < 4 || ring.some(point =>
        !Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
        point[0] < -119 || point[0] > -118 || point[1] < 34 || point[1] > 35))) {
      fail(503, 'Could not verify the certified Van Nuys boundary.');
    }
    const points = rings.flat();
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const where = ["UseType = 'Residential'", 'SitusAddress IS NOT NULL'];
    if (parcelId) where.push(`AIN = '${parcelId}'`);
    if (minSqft) where.push(`SQFTmain1 >= ${minSqft}`);
    if (singleFamily) where.push("UseDescription = 'Single'");
    const result = await query(fetchImpl, COUNTY_PARCELS, {
      where: where.join(' AND '),
      geometry: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].join(','),
      geometryType: 'esriGeometryEnvelope', inSR: 4326, spatialRel: 'esriSpatialRelIntersects',
      outFields: fields, returnGeometry: false, resultRecordCount: parcelId ? 3 : sampleSize,
      orderByFields: 'SQFTmain1 DESC,AIN ASC',
    });
    const rows = result.features.map(feature => countyRecord(feature.attributes || {}, rings)).filter(Boolean);
    return { rows, scanned: result.features.length, truncated: !!result.exceededTransferLimit || result.features.length === sampleSize };
  }

  async function exactRecord(parcelId) {
    if (typeof parcelId !== 'string' || !/^\d{10}$/.test(parcelId)) fail(400, 'Select a valid LA County parcel.');
    const { rows } = await countySearch({ parcelId });
    if (rows.length !== 1 || rows[0].parcelId !== parcelId) fail(409, 'The county could not confirm that exact Van Nuys parcel.');
    return rows[0];
  }

  function toFeature(record) {
    return { properties: {
      parcelId: record.parcelId, jurisdiction: '06037', county: 'Los Angeles', source,
      situs: { line1: record.line1, city: record.city, zip: record.zip, state: 'CA' },
    } };
  }

  async function check(record) {
    const feature = toFeature(record);
    const durable = await loadLeads(feature);
    return { feature, durable, match: matchParcelToLeads(feature, [...durable, ...localLeads()]) };
  }

  function publicMatch(match) {
    return { status: match.status, leadId: match.lead?.leadId || match.lead?.id || null, matchedOn: match.matchedOn || null };
  }

  function binding(id, record) {
    return sign?.(JSON.stringify([approvalType, id, record.parcelId, record.line1, record.city, record.zip]));
  }

  function boundApproval(approval, record) {
    if (approval?.type !== approvalType || approval.source !== 'hermes-prospecting') return false;
    const expected = binding(approval.id, record);
    const signature = approval.metadata?.parcelBinding;
    if (!expected || typeof signature !== 'string' || signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  async function once(key, operation) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = operation();
    inFlight.set(key, promise);
    try { return await promise; }
    finally { inFlight.delete(key); }
  }

  return {
    async discover({ minSqft = 0, singleFamily = false } = {}) {
      if (!Number.isInteger(minSqft) || minSqft < 0 || minSqft > 20000 || typeof singleFamily !== 'boolean') fail(400, 'Enter a valid building size between 0 and 20,000 square feet.');
      const result = await countySearch({ minSqft, singleFamily });
      const distinct = [...new Map(result.rows.map(record => [record.parcelId, record])).values()];
      const candidates = distinct
        .filter(record => (!minSqft || record.sqft >= minSqft) && (!singleFamily || record.use === 'Single'))
        .sort((a, b) => (b.sqft || 0) - (a.sqft || 0) || a.parcelId.localeCompare(b.parcelId))
        .slice(0, displayLimit);
      let order = candidates.map((_, index) => index);
      let ranking = 'building_area';
      if (prioritize && candidates.length > 1) {
        const evidence = candidates.map(({ use, sqft, units, yearBuilt }, index) => ({ index, use, sqft, units, yearBuilt }));
        const ranked = await Promise.resolve().then(() => prioritize(evidence)).catch(() => null);
        if (Array.isArray(ranked) && ranked.length === order.length && new Set(ranked).size === order.length &&
            ranked.every(index => Number.isInteger(index) && index >= 0 && index < order.length)) {
          order = ranked;
          ranking = 'hermes';
        }
      }
      return { ok: true, records: order.map(index => candidates[index]), scanned: result.scanned,
        truncated: result.truncated || distinct.length > displayLimit, ranking, retrievedAt: new Date(now()).toISOString() };
    },

    async match(parcelId) {
      const record = await exactRecord(parcelId);
      const { match } = await check(record);
      return { ok: true, record, match: publicMatch(match) };
    },

    async requestApproval(parcelId) {
      const record = await exactRecord(parcelId);
      return once(`approval:${parcelId}`, async () => {
        const { match } = await check(record);
        if (match.status !== 'no_match') return { ok: true, match: publicMatch(match) };
        const existing = approvals().find(item => ['pending', 'approved'].includes(item.status) && boundApproval(item, record));
        if (existing) return { ok: true, approvalId: existing.id, approvalStatus: existing.status };
        const id = randomUUID();
        const parcelBinding = binding(id, record);
        if (!parcelBinding) fail(503, 'Lead approval is unavailable.');
        const created = await createApproval({
          id, type: approvalType, source: 'hermes-prospecting', leadName: 'County parcel',
          address: `${record.line1}, ${record.city}, CA ${record.zip}`,
          notes: `Review adding LA County parcel ${record.parcelId} as a property-only lead. No contact or outreach is requested.`,
          metadata: { parcelId: record.parcelId, parcelBinding },
        });
        if (created?.approval?.id !== id || created.statePersist?.ok === false) fail(503, 'The lead approval could not be recorded.');
        return { ok: true, approvalId: id, approvalStatus: 'pending' };
      });
    },

    async save(parcelId, approvalId, actor) {
      const record = await exactRecord(parcelId);
      const approval = approvals().find(item => item.id === approvalId);
      if (!boundApproval(approval, record) || approval.status !== 'approved') fail(409, 'Approve this exact parcel in Inbox before saving its lead.');
      return once(`save:${parcelId}`, async () => {
        const { feature, durable, match } = await check(record);
        const current = approvals().find(item => item.id === approvalId);
        if (!boundApproval(current, record) || current.status !== 'approved') fail(409, 'This parcel approval is no longer valid.');
        if (match.status === 'ambiguous') fail(409, 'Multiple CRM leads match this parcel. Review them in Leads.');
        if (match.status === 'matched' && !String(match.lead.eventId || '').startsWith('parcel-dialer:')) {
          return { ok: true, ...publicMatch(match), created: false };
        }
        return saveLead(feature, durable, actor);
      });
    },
  };
}
