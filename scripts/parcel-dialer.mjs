// PBK parcel dialer — map-first parcel selection, exact CRM matching, and
// manual one-at-a-time click-to-call from a commissioned Twilio line.
//
// Invariants:
//  - Selecting or looking up a parcel never creates a call.
//  - A call requires: exact single CRM match, a callable non-DNC phone, the
//    caller's canPlaceCalls permission, a commissioned + caller-ID-enabled
//    Twilio line, and an approved PBK approval bound to the exact parameters.
//  - Call outcome and talk time come only from signed Twilio status callbacks
//    and are recorded on the exact CRM lead the call was approved for.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { last4, maskNumber, normalizeE164 } from './phone-numbers.mjs';

// ---------------------------------------------------------------------------
// Address + parcel ID normalization
// ---------------------------------------------------------------------------
const STREET_ABBREVIATIONS = {
  street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', boulevard: 'blvd', court: 'ct',
  circle: 'cir', place: 'pl', terrace: 'ter', parkway: 'pkwy', highway: 'hwy', north: 'n', south: 's',
  east: 'e', west: 'w', apartment: 'apt', suite: 'ste',
};

export function normalizeParcelId(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeAddressLine(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => STREET_ABBREVIATIONS[word] || word)
    .join(' ');
}

export function addressKey({ line1 = '', zip = '' } = {}) {
  const street = normalizeAddressLine(line1);
  const zip5 = String(zip || '').replace(/\D/g, '').slice(0, 5);
  return street && zip5 ? `${street}|${zip5}` : '';
}

// Parse "123 Main St, City, ST 12345" into line1 + zip for exact matching.
export function parseAddressQuery(query = '') {
  const parts = String(query || '').split(',').map((p) => p.trim()).filter(Boolean);
  const zip = (String(query).match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/) || [])[1] || '';
  return { line1: parts[0] || '', zip };
}

// ---------------------------------------------------------------------------
// Parcel data-source contract
//
// A source implements:
//   coverage()                -> { status, licensed, source, regions[], note }
//   getById(parcelId)         -> Feature | null
//   findByAddress({line1,zip})-> Feature[]
//   inBounds([w,s,e,n])       -> Feature[]
// Features are GeoJSON Polygon/MultiPolygon with properties:
//   parcelId, situs { line1, city, state, zip }, county, acres, source
// ---------------------------------------------------------------------------
export const PARCEL_FEATURE_REQUIRED = ['parcelId', 'situs'];

export function validateParcelFeature(feature) {
  if (!feature || feature.type !== 'Feature') return false;
  if (!['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) return false;
  const props = feature.properties || {};
  return Boolean(normalizeParcelId(props.parcelId) && props.situs?.line1 && props.situs?.zip);
}

// Deterministic synthetic parcels: a few irregular blocks in a fictional
// county. Geometry is generated, not copied from any real parcel layer.
export function buildFixtureParcels() {
  const origin = { lng: -82.9, lat: 39.9 }; // synthetic grid origin, not tied to any real parcel
  const streets = ['Maple Hollow Rd', 'Fixture Ave', 'Sample Creek Dr', 'Testbed Ln'];
  const features = [];
  const jitter = (seed) => ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * 0.00004;
  for (let row = 0; row < streets.length; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const idx = row * 8 + col;
      const w = origin.lng + col * 0.0006;
      const s = origin.lat + row * 0.0011;
      const width = 0.00052 + jitter(idx + 1);
      const depth = 0.00085 + jitter(idx + 7);
      const ring = [
        [w, s], [w + width, s + jitter(idx + 3)], [w + width + jitter(idx + 5), s + depth],
        [w + jitter(idx + 9), s + depth - jitter(idx + 11)], [w, s],
      ].map(([x, y]) => [Number(x.toFixed(7)), Number(y.toFixed(7))]);
      const house = 100 + col * 4 + (row % 2);
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {
          parcelId: `FX-${String(row + 1).padStart(2, '0')}-${String(col + 1).padStart(3, '0')}-00`,
          situs: { line1: `${house} ${streets[row]}`, city: 'Fixtureville', state: 'OH', zip: '43999' },
          county: 'Synthetic County',
          acres: Number((0.18 + jitter(idx + 13) * 1000).toFixed(2)),
          source: 'pbk-fixture',
        },
      });
    }
  }
  // Two parcels sharing one situs address: exercises ambiguous-address rejection.
  const dup = JSON.parse(JSON.stringify(features[features.length - 1]));
  dup.properties.parcelId = 'FX-04-008-01';
  dup.geometry.coordinates[0] = dup.geometry.coordinates[0].map(([x, y]) => [Number((x + 0.0006).toFixed(7)), y]);
  features.push(dup);
  return features;
}

function bboxOf(feature) {
  const rings = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
  const pts = rings.flat();
  return pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
}

export function createFixtureParcelSource({ features = buildFixtureParcels() } = {}) {
  const valid = features.filter(validateParcelFeature);
  return {
    kind: 'fixture',
    coverage() {
      return {
        status: 'fixture', licensed: false, source: 'PBK synthetic fixture parcels',
        regions: ['Synthetic County'], parcelCount: valid.length,
        note: 'Development fixture polygons only. Configure a licensed parcel source for live coverage.',
      };
    },
    async getById(parcelId) {
      const key = normalizeParcelId(parcelId);
      return valid.find((f) => normalizeParcelId(f.properties.parcelId) === key) || null;
    },
    async findByAddress(address) {
      const key = addressKey(address);
      return key ? valid.filter((f) => addressKey(f.properties.situs) === key) : [];
    },
    async inBounds(bbox) {
      if (!Array.isArray(bbox) || bbox.length !== 4) return valid;
      const [w, s, e, n] = bbox;
      return valid.filter((f) => { const b = bboxOf(f); return b[2] >= w && b[0] <= e && b[3] >= s && b[1] <= n; });
    },
  };
}

// Live licensed source over HTTP. The contract is documented in
// docs/PARCEL_DIALER.md. Keys stay server-side; responses are validated.
export function createHttpParcelSource({ baseUrl, apiKey = '', license = '', fetchImpl = globalThis.fetch }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const get = async (path) => {
    const response = await fetchImpl(`${root}${path}`, { headers: { Accept: 'application/geo+json, application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } });
    if (!response.ok) throw new Error(`Parcel source HTTP ${response.status}`);
    return response.json();
  };
  const features = (body) => (Array.isArray(body?.features) ? body.features : []).filter(validateParcelFeature);
  return {
    kind: 'licensed',
    async coverage() {
      try {
        const body = await get('/coverage');
        return { status: body.status === 'ok' ? 'licensed' : 'degraded', licensed: Boolean(license), source: body.source || 'Licensed parcel source', regions: body.regions || [], note: body.note || '' };
      } catch (error) {
        return { status: 'error', licensed: Boolean(license), source: 'Licensed parcel source', regions: [], note: String(error.message).slice(0, 160) };
      }
    },
    async getById(parcelId) {
      const body = await get(`/parcels/${encodeURIComponent(normalizeParcelId(parcelId))}`);
      const feature = body?.type === 'Feature' ? body : features(body)[0];
      return validateParcelFeature(feature) ? feature : null;
    },
    async findByAddress(address) {
      const body = await get(`/parcels?line1=${encodeURIComponent(address.line1 || '')}&zip=${encodeURIComponent(address.zip || '')}`);
      const key = addressKey(address);
      return features(body).filter((f) => addressKey(f.properties.situs) === key);
    },
    async inBounds(bbox) {
      return features(await get(`/parcels?bbox=${bbox.map(Number).join(',')}`));
    },
  };
}

export function resolveParcelSource(env = {}, { fetchImpl } = {}) {
  const baseUrl = String(env.PBK_PARCEL_SOURCE_URL || '').trim();
  const license = String(env.PBK_PARCEL_SOURCE_LICENSE || '').trim();
  if (baseUrl && license) return createHttpParcelSource({ baseUrl, apiKey: env.PBK_PARCEL_SOURCE_KEY, license, fetchImpl });
  const fixturesAllowed = String(env.PBK_PARCEL_FIXTURES || '').trim() !== 'off';
  if (fixturesAllowed) return createFixtureParcelSource();
  return {
    kind: 'unconfigured',
    coverage: () => ({ status: 'unconfigured', licensed: false, source: '', regions: [], note: 'No licensed parcel source is configured.' }),
    getById: async () => null,
    findByAddress: async () => [],
    inBounds: async () => [],
  };
}

// ---------------------------------------------------------------------------
// Synthetic CRM contacts for development (mock mode only). Phone numbers use
// the fictional 555-01xx range.
// ---------------------------------------------------------------------------
export function buildFixtureContacts() {
  const mk = (id, name, parcelId, line1, phone, extra = {}) => ({
    id, synthetic: true, source: 'pbk-fixture',
    seller: { name, phone },
    property: { address: `${line1}, Fixtureville, OH 43999`, line1, zip: '43999', parcelId },
    status: 'new', ...extra,
  });
  return [
    mk('fixture-lead-01', 'Synthetic Owner A', 'FX-01-001-00', '100 Maple Hollow Rd', '+15555550101'),
    mk('fixture-lead-02', 'Synthetic Owner B', 'FX-01-003-00', '108 Maple Hollow Rd', '+15555550102', { status: 'follow_up' }),
    mk('fixture-lead-03', 'Synthetic Owner C', 'FX-02-002-00', '105 Fixture Ave', '+15555550103', { dnc: true }),
    mk('fixture-lead-04', 'Synthetic Owner D', 'FX-02-005-00', '117 Fixture Ave', ''),
    // Two leads claiming the same parcel -> ambiguous, must be rejected.
    mk('fixture-lead-05', 'Synthetic Owner E', 'FX-03-004-00', '112 Sample Creek Dr', '+15555550105'),
    mk('fixture-lead-06', 'Synthetic Owner E (dup)', 'FX-03-004-00', '112 Sample Creek Dr', '+15555550106'),
    mk('fixture-lead-07', 'Synthetic Owner F', '', '121 Testbed Ln', '+15555550107'),
  ];
}

// ---------------------------------------------------------------------------
// Exact CRM matching
// ---------------------------------------------------------------------------
function leadParcelId(lead = {}) {
  return normalizeParcelId(lead.parcelId || lead.property?.parcelId || lead.property?.apn || lead.apn || '');
}

function leadAddressKey(lead = {}) {
  const p = lead.property || {};
  const parsed = parseAddressQuery(p.address || lead.address || lead.propertyAddress || '');
  return addressKey({ line1: p.line1 || parsed.line1, zip: p.zip || lead.zip || parsed.zip });
}

export function matchParcelToLeads(feature, leads = []) {
  const pid = normalizeParcelId(feature?.properties?.parcelId);
  const akey = addressKey(feature?.properties?.situs || {});
  const byId = new Map();
  for (const lead of leads) {
    const id = lead.id || lead.leadId;
    if (!id) continue;
    if ((pid && leadParcelId(lead) === pid) || (akey && leadAddressKey(lead) === akey)) byId.set(id, lead);
  }
  const candidates = [...byId.values()];
  if (candidates.length === 0) return { status: 'no_match', lead: null, candidateCount: 0 };
  if (candidates.length > 1) return { status: 'ambiguous', lead: null, candidateCount: candidates.length };
  return { status: 'matched', lead: candidates[0], candidateCount: 1, matchedOn: pid && leadParcelId(candidates[0]) === pid ? 'parcel_id' : 'address' };
}

// ---------------------------------------------------------------------------
// Twilio request signature (X-Twilio-Signature)
// ---------------------------------------------------------------------------
export function computeTwilioSignature(authToken, url, params = {}) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + String(params[key] ?? ''), String(url));
  return createHmac('sha1', String(authToken)).update(Buffer.from(data, 'utf8')).digest('base64');
}

export function verifyTwilioSignature({ authToken, url, params, signature }) {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function xmlEscape(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildAgentBridgeTwiml({ from, to, leadLegCallback }) {
  return `<Response><Dial callerId="${xmlEscape(from)}" answerOnBridge="true"><Number statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST" statusCallback="${xmlEscape(leadLegCallback)}">${xmlEscape(to)}</Number></Dial></Response>`;
}

export function hashCallBinding(params) {
  const canonical = JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
  return createHash('sha256').update(canonical).digest('hex');
}

const TERMINAL = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);
const CALL_REQUEST_TTL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Dialer service
// ---------------------------------------------------------------------------
export function createParcelDialer({
  parcelSource,
  phoneNumbers,
  twilio,
  listLeads,
  isDnc,
  readStore,
  writeStore,
  recordLeadResult,
  env = {},
  now = () => Date.now(),
  mock = false,
} = {}) {
  const iso = () => new Date(now()).toISOString();
  const store = () => {
    const s = readStore() || {};
    for (const key of ['callRequests', 'calls', 'callbackEvents', 'fixtureActivity']) if (!Array.isArray(s[key])) s[key] = [];
    return s;
  };
  const save = (s) => writeStore(s);
  const publicBase = String(env.PBK_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const agentPhone = normalizeE164(env.PBK_DIALER_AGENT_PHONE || (mock ? '+15555550199' : ''));
  const liveCallsEnabled = mock || String(env.PBK_TWILIO_DIALER_ENABLED || '').trim() === 'true';

  const allLeads = async () => {
    const crm = (await listLeads()) || [];
    return mock ? [...crm, ...buildFixtureContacts()] : crm;
  };

  function leadSummary(lead) {
    if (!lead) return null;
    const phone = normalizeE164(lead.seller?.phone || lead.phone || '');
    return {
      id: lead.id || lead.leadId,
      name: lead.seller?.name || lead.leadName || lead.name || 'Unnamed contact',
      address: lead.property?.address || lead.address || '',
      status: lead.status || lead.stage || '',
      phoneLast4: last4(phone),
      phoneDisplay: maskNumber(phone),
      synthetic: Boolean(lead.synthetic),
    };
  }

  function activityFor(leadId) {
    const s = store();
    return s.calls
      .filter((c) => c.leadId === leadId)
      .slice(0, 10)
      .map((c) => ({ id: c.id, at: c.createdAt, status: c.status, outcome: c.outcome || '', talkSeconds: c.talkSeconds ?? null, lineLast4: last4(c.from) }));
  }

  async function resolveParcel({ parcelId = '', address = '' }) {
    if (parcelId) {
      const feature = await parcelSource.getById(parcelId);
      return feature ? { status: 'found', feature } : { status: 'not_found' };
    }
    const parsed = typeof address === 'string' ? parseAddressQuery(address) : address;
    if (!addressKey(parsed)) return { status: 'invalid', error: 'Enter street and 5-digit ZIP.' };
    const matches = await parcelSource.findByAddress(parsed);
    if (matches.length === 0) return { status: 'not_found' };
    if (matches.length > 1) return { status: 'ambiguous', count: matches.length };
    return { status: 'found', feature: matches[0] };
  }

  async function eligibility(match, { canPlaceCalls = false, lineId = '' } = {}) {
    const reasons = [];
    if (match.status === 'ambiguous') reasons.push({ code: 'ambiguous_match', message: `${match.candidateCount} CRM contacts match this parcel. Resolve the duplicate before dialing.` });
    if (match.status === 'no_match') reasons.push({ code: 'no_crm_match', message: 'No CRM contact matches this parcel exactly.' });
    const lead = match.lead;
    const phone = normalizeE164(lead?.seller?.phone || lead?.phone || '');
    if (lead && !phone) reasons.push({ code: 'no_phone', message: 'Matched contact has no callable phone.' });
    if (lead && (lead.dnc || lead.doNotCall || lead.do_not_call || (phone && (await isDnc(phone))))) {
      reasons.push({ code: 'dnc', message: 'Contact is on the PBK do-not-call list.' });
    }
    if (lead && /^(dead|do_not_contact|dnc)$/i.test(String(lead.status || ''))) reasons.push({ code: 'lead_closed', message: 'Lead status blocks outreach.' });
    if (!canPlaceCalls) reasons.push({ code: 'permission', message: 'Your session is not permitted to place calls.' });
    if (!liveCallsEnabled) reasons.push({ code: 'dialer_disabled', message: 'Live Twilio dialing is disabled for this environment.' });
    if (!agentPhone) reasons.push({ code: 'agent_unconfigured', message: 'No operator bridge phone is configured.' });
    if (!twilio?.configured) reasons.push({ code: 'twilio_unconfigured', message: 'Twilio is not configured.' });
    if (!mock && !/^https:\/\//.test(publicBase)) reasons.push({ code: 'callback_unconfigured', message: 'A public HTTPS callback URL is required to reconcile calls.' });
    let line = null;
    if (lineId) {
      const check = phoneNumbers.outboundLine(lineId, { provider: 'twilio' });
      if (!check.ok) reasons.push({ code: 'line_unavailable', message: check.error }); else line = check.line;
    } else {
      reasons.push({ code: 'line_unavailable', message: 'Choose a commissioned Twilio line.' });
    }
    if (lead) {
      const s = store();
      const active = s.calls.find((c) => c.leadId === (lead.id || lead.leadId) && !c.finalizedAt);
      if (active) reasons.push({ code: 'call_active', message: 'A call to this contact is already in progress.' });
      const pending = s.callRequests.find((r) => r.leadId === (lead.id || lead.leadId) && r.status === 'awaiting_approval' && Date.parse(r.expiresAt) > now());
      if (pending) reasons.push({ code: 'request_pending', message: 'A call request for this contact is already awaiting approval.' });
    }
    return { eligible: reasons.length === 0, reasons, line, phone };
  }

  async function outboundLines() {
    const inventory = await phoneNumbers.inventory();
    return inventory.lines
      .filter((l) => l.provider === 'twilio')
      .map((l) => ({ id: l.id, display: l.display, last4: l.last4, commissioned: l.commissioning?.status === 'commissioned', callerIdEnabled: l.callerIdEnabled }));
  }

  return {
    mock,
    async coverage() {
      const coverage = await parcelSource.coverage();
      return { ...coverage, sourceKind: parcelSource.kind, liveCallsEnabled, mock };
    },

    async parcelsInBounds(bbox) {
      const features = await parcelSource.inBounds(bbox);
      return { type: 'FeatureCollection', features: features.slice(0, 500) };
    },

    // Selection/lookup is read-only: it resolves the parcel, the exact CRM
    // match and eligibility, and never creates a call or call request.
    async selectParcel({ parcelId = '', address = '', canPlaceCalls = false, lineId = '' }) {
      const resolved = await resolveParcel({ parcelId, address });
      if (resolved.status !== 'found') return { ok: false, lookup: resolved.status, error: resolved.error || (resolved.status === 'ambiguous' ? 'More than one parcel matches that address. Use the parcel ID.' : 'No parcel found.') };
      const match = matchParcelToLeads(resolved.feature, await allLeads());
      const elig = await eligibility(match, { canPlaceCalls, lineId });
      return {
        ok: true,
        parcel: resolved.feature,
        match: { status: match.status, candidateCount: match.candidateCount, matchedOn: match.matchedOn || '' },
        contact: leadSummary(match.lead),
        activity: match.lead ? activityFor(match.lead.id || match.lead.leadId) : [],
        eligibility: { eligible: elig.eligible, reasons: elig.reasons },
        lines: await outboundLines(),
      };
    },

    outboundLines,

    async requestCall({ parcelId, leadId, lineId, canPlaceCalls, actor = 'staff' }) {
      const resolved = await resolveParcel({ parcelId });
      if (resolved.status !== 'found') return { ok: false, code: 'parcel_not_found', error: 'Parcel not found.' };
      const match = matchParcelToLeads(resolved.feature, await allLeads());
      if (match.status !== 'matched') return { ok: false, code: match.status === 'ambiguous' ? 'ambiguous_match' : 'no_crm_match', error: 'Parcel does not resolve to exactly one CRM contact.' };
      if ((match.lead.id || match.lead.leadId) !== leadId) return { ok: false, code: 'lead_mismatch', error: 'Selected contact no longer matches this parcel.' };
      const elig = await eligibility(match, { canPlaceCalls, lineId });
      if (!elig.eligible) return { ok: false, code: elig.reasons[0].code, error: elig.reasons[0].message, reasons: elig.reasons };
      const binding = { parcelId: normalizeParcelId(parcelId), leadId, to: elig.phone, from: elig.line.phoneNumber, lineId, agent: agentPhone };
      const request = {
        id: `dialreq-${randomUUID()}`, ...binding, bindingHash: hashCallBinding(binding),
        status: 'awaiting_approval', approvalId: '', requestedBy: actor, createdAt: iso(),
        expiresAt: new Date(now() + CALL_REQUEST_TTL_MS).toISOString(), synthetic: Boolean(match.lead.synthetic),
      };
      const s = store();
      s.callRequests.unshift(request);
      s.callRequests = s.callRequests.slice(0, 200);
      await save(s);
      return { ok: true, request: this.publicRequest(request), contact: leadSummary(match.lead) };
    },

    publicRequest(r) {
      return r && { id: r.id, parcelId: r.parcelId, leadId: r.leadId, lineId: r.lineId, toLast4: last4(r.to), fromLast4: last4(r.from), status: r.status, approvalId: r.approvalId, expiresAt: r.expiresAt, callId: r.callId || '' };
    },

    async attachApproval(requestId, approvalId) {
      const s = store();
      const r = s.callRequests.find((x) => x.id === requestId);
      if (r) { r.approvalId = approvalId; await save(s); }
      return r;
    },

    getRequest(requestId) {
      return store().callRequests.find((x) => x.id === requestId) || null;
    },

    async placeCall({ requestId, approval, canPlaceCalls, actor = 'staff' }) {
      const s = store();
      const r = s.callRequests.find((x) => x.id === requestId);
      if (!r) return { ok: false, code: 'request_not_found', error: 'Call request not found.' };
      if (r.callId) return { ok: true, replay: true, call: this.publicCall(s.calls.find((c) => c.id === r.callId)) };
      if (r.status !== 'awaiting_approval') return { ok: false, code: 'request_closed', error: `Call request is ${r.status}.` };
      if (Date.parse(r.expiresAt) <= now()) { r.status = 'expired'; await save(s); return { ok: false, code: 'request_expired', error: 'Call request expired. Request again.' }; }
      if (!approval || approval.id !== r.approvalId || approval.status !== 'approved') return { ok: false, code: 'approval_required', error: 'This call needs an approved PBK approval first.' };
      const { parcelId, leadId, to, from, lineId, agent } = r;
      if (hashCallBinding({ parcelId, leadId, to, from, lineId, agent }) !== r.bindingHash || approval.metadata?.bindingHash !== r.bindingHash) {
        return { ok: false, code: 'approval_binding_mismatch', error: 'Approval does not match this exact call.' };
      }
      // Re-run every gate at dial time: DNC, permission, line, exact match.
      const resolved = await resolveParcel({ parcelId });
      const match = resolved.status === 'found' ? matchParcelToLeads(resolved.feature, await allLeads()) : { status: 'no_match' };
      if (match.status !== 'matched' || (match.lead.id || match.lead.leadId) !== leadId) return { ok: false, code: 'match_changed', error: 'CRM match changed since approval.' };
      const elig = await eligibility(match, { canPlaceCalls, lineId });
      const blocking = elig.reasons.filter((x) => x.code !== 'request_pending');
      if (blocking.length) return { ok: false, code: blocking[0].code, error: blocking[0].message, reasons: blocking };
      if (elig.phone !== to || elig.line.phoneNumber !== from) return { ok: false, code: 'approval_binding_mismatch', error: 'Phone or line changed since approval.' };

      const call = { id: `dial-${randomUUID()}`, requestId: r.id, parcelId, leadId, to, from, lineId, agent, status: 'dispatching', legs: {}, createdAt: iso(), placedBy: actor, synthetic: r.synthetic };
      r.status = 'dialing';
      r.callId = call.id;
      s.calls.unshift(call);
      s.calls = s.calls.slice(0, 500);
      await save(s); // persisted before Twilio is contacted: one request, one call
      const callbackBase = `${publicBase || 'http://localhost'}/api/webhooks/twilio/voice-status?pbkCallId=${encodeURIComponent(call.id)}`;
      try {
        const result = await twilio.createCall({
          to: agent, from,
          twiml: buildAgentBridgeTwiml({ from, to, leadLegCallback: `${callbackBase}&leg=lead` }),
          statusCallback: `${callbackBase}&leg=agent`,
        });
        call.agentCallSid = result.callSid;
        call.status = result.status || 'queued';
        r.status = 'placed';
      } catch (error) {
        call.status = error.ambiguous ? 'dispatch_unknown' : 'failed';
        call.error = String(error.message || '').slice(0, 200);
        if (!error.ambiguous) { call.finalizedAt = iso(); call.outcome = 'dispatch_failed'; }
        r.status = error.ambiguous ? 'dispatch_unknown' : 'failed';
      }
      await save(s);
      return { ok: call.status !== 'failed', call: this.publicCall(call), error: call.error || '' };
    },

    publicCall(c) {
      return c && { id: c.id, leadId: c.leadId, parcelId: c.parcelId, status: c.status, outcome: c.outcome || '', talkSeconds: c.talkSeconds ?? null, toLast4: last4(c.to), fromLast4: last4(c.from), createdAt: c.createdAt, finalizedAt: c.finalizedAt || null };
    },

    listCalls() {
      return store().calls.slice(0, 50).map((c) => this.publicCall(c));
    },

    // Signed Twilio status callbacks are the only source of outcome/talk time.
    async handleStatusCallback({ url, params, signature, authToken }) {
      if (!verifyTwilioSignature({ authToken, url, params, signature })) return { ok: false, statusCode: 403, code: 'bad_signature' };
      const parsed = new URL(url);
      const callId = parsed.searchParams.get('pbkCallId') || '';
      const leg = parsed.searchParams.get('leg') === 'lead' ? 'lead' : 'agent';
      const s = store();
      const call = s.calls.find((c) => c.id === callId);
      if (!call) return { ok: true, ignored: 'unknown_call' };
      const sid = String(params.CallSid || '');
      // Bind each leg to the exact Twilio call we created.
      if (leg === 'agent' && call.agentCallSid && sid !== call.agentCallSid) return { ok: true, ignored: 'sid_mismatch' };
      if (leg === 'lead') {
        if (call.agentCallSid && params.ParentCallSid && params.ParentCallSid !== call.agentCallSid) return { ok: true, ignored: 'parent_mismatch' };
        if (call.legs.lead?.sid && call.legs.lead.sid !== sid) return { ok: true, ignored: 'sid_mismatch' };
      }
      const eventKey = `${sid}:${params.CallStatus}:${params.SequenceNumber || ''}`;
      if (s.callbackEvents.includes(eventKey)) return { ok: true, duplicate: true };
      s.callbackEvents.unshift(eventKey);
      s.callbackEvents = s.callbackEvents.slice(0, 2000);
      const status = String(params.CallStatus || '').toLowerCase();
      call.legs[leg] = { sid, status, duration: Number(params.CallDuration || 0) || 0, at: iso() };
      if (leg === 'agent' && !call.agentCallSid) call.agentCallSid = sid;
      call.status = leg === 'lead' ? `lead_${status}` : `agent_${status}`;
      let finalized = false;
      if (!call.finalizedAt) {
        const leadLeg = call.legs.lead;
        if (leadLeg && TERMINAL.has(leadLeg.status)) {
          call.outcome = leadLeg.status === 'completed' && leadLeg.duration > 0 ? 'connected' : leadLeg.status;
          call.talkSeconds = leadLeg.status === 'completed' ? leadLeg.duration : 0;
          finalized = true;
        } else if (leg === 'agent' && TERMINAL.has(status) && !leadLeg) {
          call.outcome = status === 'completed' ? 'lead_not_dialed' : `agent_${status}`;
          call.talkSeconds = 0;
          finalized = true;
        }
        if (finalized) {
          call.finalizedAt = iso();
          const result = { callId: call.id, outcome: call.outcome, talkSeconds: call.talkSeconds, at: call.finalizedAt, lineLast4: last4(call.from), parcelId: call.parcelId };
          if (call.synthetic) s.fixtureActivity.unshift({ leadId: call.leadId, ...result });
          else await recordLeadResult(call.leadId, result);
        }
      }
      await save(s);
      return { ok: true, finalized, call: this.publicCall(call) };
    },

    // Dev-only: synthesize signed callbacks so the reconciliation path can be
    // exercised end to end without a live carrier.
    async simulateCallbacks({ callId, outcome = 'connected', talkSeconds = 42, authToken }) {
      if (!mock) return { ok: false, code: 'mock_only' };
      const call = store().calls.find((c) => c.id === callId);
      if (!call) return { ok: false, code: 'call_not_found' };
      const base = `${publicBase || 'http://localhost'}/api/webhooks/twilio/voice-status?pbkCallId=${encodeURIComponent(call.id)}`;
      const leadSid = `CAlead${call.agentCallSid?.slice(6) || randomUUID().slice(0, 8)}`;
      const leadStatus = outcome === 'connected' ? 'completed' : outcome;
      const events = [
        { leg: 'agent', CallSid: call.agentCallSid, CallStatus: 'in-progress', SequenceNumber: '1' },
        { leg: 'lead', CallSid: leadSid, ParentCallSid: call.agentCallSid, CallStatus: 'ringing', SequenceNumber: '0' },
        { leg: 'lead', CallSid: leadSid, ParentCallSid: call.agentCallSid, CallStatus: leadStatus, CallDuration: String(outcome === 'connected' ? talkSeconds : 0), SequenceNumber: '2' },
        { leg: 'agent', CallSid: call.agentCallSid, CallStatus: 'completed', CallDuration: String(talkSeconds + 9), SequenceNumber: '3' },
      ];
      let last;
      for (const { leg, ...params } of events) {
        const url = `${base}&leg=${leg}`;
        last = await this.handleStatusCallback({ url, params, signature: computeTwilioSignature(authToken, url, params), authToken });
      }
      return last;
    },

    fixtureActivity(leadId) {
      return store().fixtureActivity.filter((a) => a.leadId === leadId);
    },
  };
}
