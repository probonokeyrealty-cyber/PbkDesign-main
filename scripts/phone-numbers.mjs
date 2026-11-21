// PBK Phone Numbers manager — server-side provider adapters and the owned-line
// lifecycle: inventory -> import / search -> priced quote -> exact-number order
// (persisted before submit, reconciled before retry) -> approved voice route
// commissioning with readback -> caller-ID enablement. SMS registration status
// is tracked separately and is never changed by voice commissioning.
import { createHash, randomUUID } from 'node:crypto';

export const PHONE_PROVIDERS = ['twilio', 'telnyx'];
export const NUMBER_TYPES = ['local', 'toll_free'];
const QUOTE_TTL_MS = 10 * 60 * 1000;
const MAX_PURCHASE_ATTEMPTS = 3;

export function normalizeE164(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
}

export function isTollFree(e164 = '') {
  return /^\+1(800|833|844|855|866|877|888)\d{7}$/.test(normalizeE164(e164));
}

export function last4(e164 = '') {
  return String(e164 || '').replace(/\D/g, '').slice(-4);
}

export function maskNumber(e164 = '') {
  const tail = last4(e164);
  return tail ? `•••-•••-${tail}` : '';
}

function listEnv(value = '') {
  return String(value || '').split(/[,\s]+/).map(normalizeE164).filter(Boolean);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// ---------------------------------------------------------------------------
// Provider errors. "ambiguous" means the request may or may not have taken
// effect at the provider (timeout, network drop, 5xx). Those orders must be
// reconciled against owned inventory before any retry.
// ---------------------------------------------------------------------------
export class ProviderError extends Error {
  constructor(message, { status = 0, ambiguous = false, code = '' } = {}) {
    super(message);
    this.status = status;
    this.ambiguous = ambiguous;
    this.code = code;
  }
}

async function providerFetch(fetchImpl, url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new ProviderError(`Provider request did not complete: ${error?.name || 'network_error'}`, { ambiguous: true, code: 'network' });
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 200) }; }
  if (!response.ok) {
    const detail = body?.message || body?.errors?.[0]?.detail || body?.errors?.[0]?.title || `HTTP ${response.status}`;
    throw new ProviderError(String(detail).slice(0, 240), { status: response.status, ambiguous: response.status >= 500 || response.status === 429, code: `http_${response.status}` });
  }
  return body;
}

// ---------------------------------------------------------------------------
// Twilio adapter: AvailablePhoneNumbers + IncomingPhoneNumbers (+ Calls for
// the dialer). Credentials stay server-side; nothing here is returned raw.
// ---------------------------------------------------------------------------
export function createTwilioAdapter({ accountSid = '', authToken = '', fetchImpl = globalThis.fetch, pricing = {} } = {}) {
  const configured = Boolean(accountSid && authToken);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  const request = (method, path, form) => providerFetch(fetchImpl, `${base}${path}`, {
    method,
    headers: { Authorization: auth, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const requireConfig = () => { if (!configured) throw new ProviderError('Twilio is not configured.', { code: 'not_configured' }); };
  const toOwned = (row = {}) => ({
    provider: 'twilio',
    providerId: row.sid,
    phoneNumber: normalizeE164(row.phone_number),
    friendlyName: row.friendly_name || '',
    capabilities: { voice: Boolean(row.capabilities?.voice), sms: Boolean(row.capabilities?.sms) },
    voiceRoute: { voiceUrl: row.voice_url || '', voiceMethod: row.voice_method || '', statusCallback: row.status_callback || '' },
  });
  // Twilio's AvailablePhoneNumbers response carries no price; the account's
  // number pricing comes from the Pricing API and is cached per type.
  const priceFor = async (type) => {
    if (pricing[type]) return pricing[type];
    const body = await providerFetch(fetchImpl, 'https://pricing.twilio.com/v1/PhoneNumbers/Countries/US', { headers: { Authorization: auth } });
    const wanted = type === 'toll_free' ? 'toll free' : 'local';
    const row = (body.phone_number_prices || []).find((item) => String(item.number_type || '').toLowerCase() === wanted);
    if (!row) throw new ProviderError('Twilio pricing is unavailable for this number type.', { code: 'pricing_unavailable' });
    pricing[type] = { upfront: 0, monthly: money(row.current_price ?? row.base_price), currency: body.price_unit || 'USD' };
    return pricing[type];
  };
  return {
    provider: 'twilio',
    configured,
    async listOwned({ phoneNumber = '' } = {}) {
      requireConfig();
      const query = phoneNumber ? `?PhoneNumber=${encodeURIComponent(normalizeE164(phoneNumber))}` : '?PageSize=200';
      const body = await request('GET', `/IncomingPhoneNumbers.json${query}`);
      return (body.incoming_phone_numbers || []).map(toOwned);
    },
    async searchAvailable({ type = 'local', areaCode = '', contains = '', limit = 10 } = {}) {
      requireConfig();
      const params = new URLSearchParams({ PageSize: String(Math.min(Math.max(limit, 1), 30)), VoiceEnabled: 'true' });
      if (areaCode) params.set('AreaCode', areaCode);
      if (contains) params.set('Contains', contains);
      const kind = type === 'toll_free' ? 'TollFree' : 'Local';
      const body = await request('GET', `/AvailablePhoneNumbers/US/${kind}.json?${params}`);
      const price = await priceFor(type);
      return (body.available_phone_numbers || []).map((row) => ({
        provider: 'twilio',
        phoneNumber: normalizeE164(row.phone_number),
        type,
        locality: [row.locality, row.region].filter(Boolean).join(', '),
        capabilities: { voice: Boolean(row.capabilities?.voice), sms: Boolean(row.capabilities?.SMS ?? row.capabilities?.sms) },
        price,
      }));
    },
    async purchase({ phoneNumber }) {
      requireConfig();
      const row = await request('POST', '/IncomingPhoneNumbers.json', { PhoneNumber: normalizeE164(phoneNumber) });
      return { providerOrderId: row.sid, status: 'complete', owned: toOwned(row) };
    },
    async applyVoiceRoute(owned, route) {
      requireConfig();
      const row = await request('POST', `/IncomingPhoneNumbers/${encodeURIComponent(owned.providerId)}.json`, {
        VoiceUrl: route.voiceUrl, VoiceMethod: route.voiceMethod || 'POST', StatusCallback: route.statusCallback || '',
      });
      return toOwned(row).voiceRoute;
    },
    async readVoiceRoute(owned) {
      requireConfig();
      const row = await request('GET', `/IncomingPhoneNumbers/${encodeURIComponent(owned.providerId)}.json`);
      return toOwned(row).voiceRoute;
    },
    async createCall({ to, from, twiml, statusCallback }) {
      requireConfig();
      const row = await request('POST', '/Calls.json', {
        To: to, From: from, Twiml: twiml, StatusCallback: statusCallback, StatusCallbackMethod: 'POST',
        StatusCallbackEvent: 'initiated ringing answered completed',
      });
      return { callSid: row.sid, status: row.status || 'queued' };
    },
  };
}

// ---------------------------------------------------------------------------
// Telnyx adapter: available_phone_numbers + number_orders + phone_numbers.
// ---------------------------------------------------------------------------
export function createTelnyxAdapter({ apiKey = '', connectionId = '', fetchImpl = globalThis.fetch } = {}) {
  const configured = Boolean(apiKey);
  const request = (method, path, body) => providerFetch(fetchImpl, `https://api.telnyx.com/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const requireConfig = () => { if (!configured) throw new ProviderError('Telnyx is not configured.', { code: 'not_configured' }); };
  const toOwned = (row = {}) => ({
    provider: 'telnyx',
    providerId: row.id,
    phoneNumber: normalizeE164(row.phone_number),
    friendlyName: row.customer_reference || '',
    capabilities: { voice: true, sms: Boolean(row.messaging_profile_id) || null },
    voiceRoute: { connectionId: row.connection_id || '' },
  });
  return {
    provider: 'telnyx',
    configured,
    defaultConnectionId: connectionId,
    async listOwned({ phoneNumber = '' } = {}) {
      requireConfig();
      const params = new URLSearchParams({ 'page[size]': '250' });
      if (phoneNumber) params.set('filter[phone_number]', normalizeE164(phoneNumber));
      const body = await request('GET', `/phone_numbers?${params}`);
      return (body.data || []).map(toOwned);
    },
    async searchAvailable({ type = 'local', areaCode = '', contains = '', limit = 10 } = {}) {
      requireConfig();
      const params = new URLSearchParams({
        'filter[country_code]': 'US',
        'filter[phone_number_type]': type === 'toll_free' ? 'toll_free' : 'local',
        'filter[features][]': 'voice',
        'filter[limit]': String(Math.min(Math.max(limit, 1), 30)),
      });
      if (areaCode) params.set('filter[national_destination_code]', areaCode);
      if (contains) params.set('filter[phone_number][contains]', contains);
      const body = await request('GET', `/available_phone_numbers?${params}`);
      return (body.data || []).map((row) => ({
        provider: 'telnyx',
        phoneNumber: normalizeE164(row.phone_number),
        type,
        locality: (row.region_information || []).map((r) => r.region_name).filter(Boolean).join(', '),
        capabilities: {
          voice: (row.features || []).some((f) => f.name === 'voice'),
          sms: (row.features || []).some((f) => f.name === 'sms'),
        },
        price: {
          upfront: money(row.cost_information?.upfront_cost),
          monthly: money(row.cost_information?.monthly_cost),
          currency: row.cost_information?.currency || 'USD',
        },
      }));
    },
    async purchase({ phoneNumber, clientRequestId }) {
      requireConfig();
      const body = await request('POST', '/number_orders', {
        phone_numbers: [{ phone_number: normalizeE164(phoneNumber) }],
        customer_reference: clientRequestId,
      });
      const order = body.data || {};
      return { providerOrderId: order.id, status: order.status || 'pending' };
    },
    async findOrderByReference(clientRequestId) {
      requireConfig();
      const body = await request('GET', `/number_orders?filter[customer_reference]=${encodeURIComponent(clientRequestId)}`);
      const order = (body.data || [])[0];
      return order ? { providerOrderId: order.id, status: order.status } : null;
    },
    async applyVoiceRoute(owned, route) {
      requireConfig();
      const body = await request('PATCH', `/phone_numbers/${encodeURIComponent(owned.providerId)}`, { connection_id: route.connectionId });
      return toOwned(body.data).voiceRoute;
    },
    async readVoiceRoute(owned) {
      requireConfig();
      const body = await request('GET', `/phone_numbers/${encodeURIComponent(owned.providerId)}`);
      return toOwned(body.data).voiceRoute;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock adapters for development. All numbers use the fictional 555 exchange or
// synthetic toll-free tails; nothing is purchased and no call leaves the box.
// `faults` lets tests simulate ambiguous provider responses.
// ---------------------------------------------------------------------------
export function createMockAdapters({ seedOwned = [], faults = {} } = {}) {
  const owned = { twilio: new Map(), telnyx: new Map() };
  const orders = new Map();
  const calls = [];
  for (const line of seedOwned) owned[line.provider].set(line.phoneNumber, { ...line });
  const available = {
    local: Array.from({ length: 12 }, (_, i) => `+1555555${String(1100 + i * 7).padStart(4, '0')}`),
    toll_free: Array.from({ length: 6 }, (_, i) => `+1888555${String(2200 + i * 11).padStart(4, '0')}`),
  };
  const priceTable = {
    twilio: { local: { upfront: 0, monthly: 1.15, currency: 'USD' }, toll_free: { upfront: 0, monthly: 2.15, currency: 'USD' } },
    telnyx: { local: { upfront: 1, monthly: 1, currency: 'USD' }, toll_free: { upfront: 1, monthly: 1.5, currency: 'USD' } },
  };
  const make = (provider) => ({
    provider,
    configured: true,
    mock: true,
    defaultConnectionId: provider === 'telnyx' ? 'mock-connection' : undefined,
    async listOwned({ phoneNumber = '' } = {}) {
      const rows = [...owned[provider].values()];
      return phoneNumber ? rows.filter((r) => r.phoneNumber === normalizeE164(phoneNumber)) : rows;
    },
    async searchAvailable({ type = 'local', areaCode = '', contains = '', limit = 10 } = {}) {
      const taken = new Set([...owned.twilio.keys(), ...owned.telnyx.keys()]);
      return available[type === 'toll_free' ? 'toll_free' : 'local']
        .filter((n) => !taken.has(n))
        .filter((n) => !areaCode || n.slice(2, 5) === areaCode)
        .filter((n) => !contains || n.includes(String(contains).replace(/\D/g, '')))
        .slice(0, limit)
        .map((phoneNumber) => ({
          provider, phoneNumber, type, locality: 'Synthetic test exchange',
          capabilities: { voice: true, sms: true }, price: { ...priceTable[provider][type === 'toll_free' ? 'toll_free' : 'local'] },
        }));
    },
    async purchase({ phoneNumber, clientRequestId }) {
      const e164 = normalizeE164(phoneNumber);
      const already = orders.get(clientRequestId);
      if (already) return already; // provider-side idempotency on reference
      const line = {
        provider, providerId: `${provider === 'twilio' ? 'PN' : 'tx'}mock${last4(e164)}`, phoneNumber: e164,
        friendlyName: 'PBK mock line', capabilities: { voice: true, sms: true },
        voiceRoute: provider === 'twilio' ? { voiceUrl: '', voiceMethod: 'POST', statusCallback: '' } : { connectionId: '' },
      };
      owned[provider].set(e164, line);
      const result = { providerOrderId: `order-${randomUUID().slice(0, 8)}`, status: 'complete', owned: line };
      orders.set(clientRequestId, result);
      if (faults.ambiguousPurchase) {
        faults.ambiguousPurchase -= 1;
        throw new ProviderError('Simulated provider timeout after the order was accepted.', { ambiguous: true, code: 'network' });
      }
      return result;
    },
    async findOrderByReference(clientRequestId) {
      return orders.get(clientRequestId) || null;
    },
    async applyVoiceRoute(line, route) {
      const row = owned[provider].get(line.phoneNumber);
      if (!row) throw new ProviderError('Number is not owned.', { status: 404 });
      row.voiceRoute = faults.routeDrift ? { ...route, voiceUrl: 'https://drifted.invalid/voice' } : { ...route };
      return row.voiceRoute;
    },
    async readVoiceRoute(line) {
      return { ...(owned[provider].get(line.phoneNumber)?.voiceRoute || {}) };
    },
    async createCall({ to, from, statusCallback }) {
      const callSid = `CAmock${randomUUID().replace(/-/g, '').slice(0, 26)}`;
      calls.push({ callSid, to, from, statusCallback });
      return { callSid, status: 'queued' };
    },
  });
  return { twilio: make('twilio'), telnyx: make('telnyx'), _mock: { owned, orders, calls, faults } };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
function emptyStore() {
  return { lines: [], orders: [], quotes: [], commissions: [] };
}

function smsStatusFor(e164, env) {
  const verified = new Set(listEnv(env.PBK_TOLL_FREE_VERIFIED_LINES));
  const registered = new Set(listEnv(env.PBK_SMS_REGISTERED_LINES));
  if (registered.has(e164) || verified.has(e164)) return { registrationStatus: 'registered', sendingAllowed: true, note: '' };
  if (isTollFree(e164)) {
    return { registrationStatus: 'pending_toll_free_verification', sendingAllowed: false, note: 'SMS stays blocked until toll-free verification is approved.' };
  }
  return { registrationStatus: 'not_registered', sendingAllowed: false, note: '10DLC registration is tracked separately from voice.' };
}

export function buildVoiceRoute(provider, env = {}) {
  const base = String(env.PBK_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (provider === 'twilio') {
    const voiceUrl = String(env.PBK_TWILIO_VOICE_URL || (base ? `${base}/api/webhooks/twilio/voice` : '')).trim();
    const statusCallback = base ? `${base}/api/webhooks/twilio/voice-status` : '';
    return voiceUrl ? { voiceUrl, voiceMethod: 'POST', statusCallback } : null;
  }
  const connectionId = String(env.PBK_TELNYX_CONNECTION_ID || '').trim();
  return connectionId ? { connectionId } : null;
}

export function routesMatch(expected = {}, actual = {}) {
  return Object.keys(expected).every((key) => String(expected[key] || '') === String(actual?.[key] || ''));
}

export function hashRoute(route = {}) {
  return createHash('sha256').update(JSON.stringify(Object.keys(route).sort().map((k) => [k, route[k]]))).digest('hex').slice(0, 16);
}

export function createPhoneNumberService({
  adapters,
  readStore,
  writeStore,
  env = {},
  now = () => Date.now(),
  defaultCallerId = '',
  purchasesEnabled = false,
} = {}) {
  const iso = () => new Date(now()).toISOString();
  const store = () => {
    const current = readStore() || emptyStore();
    for (const key of Object.keys(emptyStore())) if (!Array.isArray(current[key])) current[key] = [];
    return current;
  };
  const save = async (next) => { await writeStore(next); return next; };
  const adapterFor = (provider) => {
    const adapter = adapters?.[provider];
    if (!adapter) throw new ProviderError(`Unknown provider ${provider}.`, { code: 'unknown_provider' });
    return adapter;
  };
  const elevenLabsLines = new Set(listEnv(env.PBK_AVA_ELEVENLABS_PHONE_LINES));
  const defaultLine = normalizeE164(defaultCallerId);

  function decorate(line) {
    const e164 = line.phoneNumber;
    const isDefault = Boolean(defaultLine && e164 === defaultLine);
    return {
      ...line,
      last4: last4(e164),
      display: maskNumber(e164),
      type: isTollFree(e164) ? 'toll_free' : 'local',
      roles: {
        defaultCallerId: isDefault,
        avaVoiceEngine: elevenLabsLines.has(e164) ? 'elevenlabs' : 'default',
      },
      // Voice and SMS are deliberately separate: commissioning never flips SMS.
      sms: smsStatusFor(e164, env),
      callerIdEnabled: isDefault || line.callerIdEnabled === true,
    };
  }

  function upsertLine(current, patch) {
    const index = current.lines.findIndex((l) => l.provider === patch.provider && l.phoneNumber === patch.phoneNumber);
    const merged = { ...(index >= 0 ? current.lines[index] : {}), ...patch, updatedAt: iso() };
    if (index >= 0) current.lines[index] = merged; else current.lines.unshift({ id: `line-${patch.provider}-${last4(patch.phoneNumber)}-${randomUUID().slice(0, 6)}`, createdAt: iso(), ...merged });
    return index >= 0 ? current.lines[index] : current.lines[0];
  }

  // Lines that existed before this manager (the 8134 default, the 5307 Ava
  // line) are adopted as already-routed so nothing about them changes.
  async function ensureLegacyLines() {
    const current = store();
    let changed = false;
    for (const e164 of [defaultLine, ...elevenLabsLines].filter(Boolean)) {
      if (current.lines.some((l) => l.phoneNumber === e164)) continue;
      upsertLine(current, {
        provider: 'telnyx', phoneNumber: e164, providerId: '', source: 'existing_runtime',
        commissioning: { status: 'legacy_routed', note: 'Pre-existing runtime line; voice route left unchanged.' },
        callerIdEnabled: e164 === defaultLine,
      });
      changed = true;
    }
    if (changed) await save(current);
    return current;
  }

  return {
    async inventory() {
      const current = await ensureLegacyLines();
      return {
        lines: current.lines.map(decorate),
        orders: current.orders.slice(0, 50),
        providers: Object.fromEntries(PHONE_PROVIDERS.map((p) => [p, { configured: Boolean(adapters?.[p]?.configured), mock: Boolean(adapters?.[p]?.mock) }])),
        purchasesEnabled,
      };
    },

    async importOwned({ provider, phoneNumber, actor = 'staff' }) {
      const e164 = normalizeE164(phoneNumber);
      if (!PHONE_PROVIDERS.includes(provider) || !e164) return { ok: false, code: 'invalid_request', error: 'Choose a provider and an exact phone number.' };
      const matches = (await adapterFor(provider).listOwned({ phoneNumber: e164 })).filter((r) => r.phoneNumber === e164);
      if (matches.length !== 1) return { ok: false, code: 'not_owned', error: `That number is not owned on the ${provider} account.` };
      const current = await ensureLegacyLines();
      const existing = current.lines.find((l) => l.phoneNumber === e164 && l.provider === provider);
      const line = upsertLine(current, {
        provider, phoneNumber: e164, providerId: matches[0].providerId, capabilities: matches[0].capabilities,
        source: existing?.source || 'imported', importedBy: actor,
        commissioning: existing?.commissioning || { status: 'uncommissioned' },
        callerIdEnabled: existing?.callerIdEnabled === true,
      });
      await save(current);
      return { ok: true, line: decorate(line) };
    },

    async search({ provider, type = 'local', areaCode = '', contains = '', limit = 10 }) {
      if (!PHONE_PROVIDERS.includes(provider)) return { ok: false, code: 'invalid_request', error: 'Choose Twilio or Telnyx.' };
      if (!NUMBER_TYPES.includes(type)) return { ok: false, code: 'invalid_request', error: 'Choose local or toll-free.' };
      const cleanArea = String(areaCode || '').replace(/\D/g, '').slice(0, 3);
      const results = await adapterFor(provider).searchAvailable({ type, areaCode: cleanArea, contains: String(contains || '').replace(/\D/g, '').slice(0, 7), limit });
      return { ok: true, results };
    },

    // A quote re-checks the exact number at the provider and freezes the price
    // the operator must confirm verbatim.
    async quote({ provider, phoneNumber, type, actor = 'staff' }) {
      const e164 = normalizeE164(phoneNumber);
      if (!e164) return { ok: false, code: 'invalid_request', error: 'An exact phone number is required.' };
      const numberType = type || (isTollFree(e164) ? 'toll_free' : 'local');
      const candidates = await adapterFor(provider).searchAvailable({
        type: numberType, contains: e164.slice(-7), areaCode: numberType === 'local' ? e164.slice(2, 5) : '', limit: 30,
      });
      const match = candidates.find((c) => c.phoneNumber === e164);
      if (!match) return { ok: false, code: 'not_available', error: 'That exact number is no longer available.' };
      if (match.price?.monthly == null) return { ok: false, code: 'pricing_unavailable', error: 'The provider did not return a price for this number.' };
      const current = store();
      const quote = {
        id: `quote-${randomUUID()}`, provider, phoneNumber: e164, type: numberType, price: match.price,
        createdAt: iso(), expiresAt: new Date(now() + QUOTE_TTL_MS).toISOString(), requestedBy: actor,
      };
      current.quotes = [quote, ...current.quotes.filter((q) => Date.parse(q.expiresAt) > now())].slice(0, 25);
      await save(current);
      return { ok: true, quote };
    },

    // Confirming a quote persists the exact-number order. The caller attaches
    // an approval; nothing is sent to the provider here.
    async createOrder({ quoteId, confirmPhoneNumber, confirmMonthly, confirmUpfront, actor = 'staff' }) {
      const current = store();
      const quote = current.quotes.find((q) => q.id === quoteId);
      if (!quote) return { ok: false, code: 'quote_not_found', error: 'Quote not found. Search and quote again.' };
      if (Date.parse(quote.expiresAt) <= now()) return { ok: false, code: 'quote_expired', error: 'Quote expired. Re-quote to confirm current pricing.' };
      if (normalizeE164(confirmPhoneNumber) !== quote.phoneNumber) return { ok: false, code: 'confirmation_mismatch', error: 'Confirmed number does not match the quote.' };
      if (money(confirmMonthly) !== quote.price.monthly || money(confirmUpfront ?? 0) !== money(quote.price.upfront ?? 0)) {
        return { ok: false, code: 'price_mismatch', error: 'Confirmed price does not match the quoted price.' };
      }
      const open = current.orders.find((o) => o.phoneNumber === quote.phoneNumber && !['failed', 'cancelled'].includes(o.status));
      if (open) return { ok: false, code: 'order_exists', error: 'An order for this exact number already exists.', order: open };
      const order = {
        id: `pnorder-${randomUUID()}`,
        clientRequestId: `pbk-${randomUUID()}`,
        provider: quote.provider,
        phoneNumber: quote.phoneNumber,
        type: quote.type,
        price: quote.price,
        quoteId: quote.id,
        status: 'awaiting_approval',
        approvalId: '',
        attempts: [],
        requestedBy: actor,
        createdAt: iso(),
        updatedAt: iso(),
      };
      current.orders.unshift(order);
      current.quotes = current.quotes.filter((q) => q.id !== quote.id);
      await save(current);
      return { ok: true, order };
    },

    async attachApproval(orderId, approvalId) {
      const current = store();
      const order = current.orders.find((o) => o.id === orderId);
      if (order) { order.approvalId = approvalId; order.updatedAt = iso(); await save(current); }
      return order;
    },

    getOrder(orderId) {
      return store().orders.find((o) => o.id === orderId) || null;
    },

    async reconcileOrder(order) {
      const adapter = adapterFor(order.provider);
      const owned = (await adapter.listOwned({ phoneNumber: order.phoneNumber })).find((r) => r.phoneNumber === order.phoneNumber);
      if (owned) return { state: 'owned', owned };
      if (typeof adapter.findOrderByReference === 'function') {
        const providerOrder = await adapter.findOrderByReference(order.clientRequestId);
        if (providerOrder && !/fail|cancel/i.test(providerOrder.status || '')) return { state: 'order_pending', providerOrder };
      }
      return { state: 'absent' };
    },

    async executeOrder({ orderId, approval, actor = 'staff' }) {
      const current = store();
      const order = current.orders.find((o) => o.id === orderId);
      if (!order) return { ok: false, code: 'order_not_found', error: 'Order not found.' };
      if (order.status === 'purchased') return { ok: true, order, replay: true };
      if (!approval || approval.id !== order.approvalId || approval.status !== 'approved') {
        return { ok: false, code: 'approval_required', error: 'This purchase needs an approved admin approval first.' };
      }
      if (!purchasesEnabled && !adapterFor(order.provider).mock) {
        return { ok: false, code: 'purchases_disabled', error: 'Live number purchases are disabled for this environment.' };
      }
      // Any prior attempt that might have reached the provider is reconciled
      // against inventory before we are allowed to send again.
      if (['submitting', 'unknown', 'provider_pending'].includes(order.status)) {
        const reconciliation = await this.reconcileOrder(order);
        order.reconciledAt = iso();
        if (reconciliation.state === 'owned') return this.finalizePurchased(current, order, reconciliation.owned, actor);
        if (reconciliation.state === 'order_pending') {
          order.status = 'provider_pending';
          order.updatedAt = iso();
          await save(current);
          return { ok: true, order, pending: true };
        }
      }
      if (order.attempts.length >= MAX_PURCHASE_ATTEMPTS) {
        order.status = 'failed';
        order.failure = 'max_attempts_reached';
        await save(current);
        return { ok: false, code: 'max_attempts', error: 'Purchase attempts exhausted; review the provider account manually.', order };
      }
      const attempt = { at: iso(), actor, result: 'submitting' };
      order.attempts.push(attempt);
      order.status = 'submitting';
      order.updatedAt = iso();
      await save(current); // persisted before the provider sees anything
      try {
        const result = await adapterFor(order.provider).purchase({ phoneNumber: order.phoneNumber, clientRequestId: order.clientRequestId });
        attempt.result = 'accepted';
        order.providerOrderId = result.providerOrderId;
        if (result.owned) return this.finalizePurchased(current, order, result.owned, actor);
        const reconciliation = await this.reconcileOrder(order);
        if (reconciliation.state === 'owned') return this.finalizePurchased(current, order, reconciliation.owned, actor);
        order.status = 'provider_pending';
        order.updatedAt = iso();
        await save(current);
        return { ok: true, order, pending: true };
      } catch (error) {
        attempt.result = error.ambiguous ? 'ambiguous' : 'rejected';
        attempt.error = String(error.message || '').slice(0, 200);
        order.status = error.ambiguous ? 'unknown' : 'failed';
        order.updatedAt = iso();
        await save(current);
        if (error.ambiguous) {
          // Immediately try to resolve the ambiguity; never blind-retry.
          const reconciliation = await this.reconcileOrder(order).catch(() => ({ state: 'unreachable' }));
          if (reconciliation.state === 'owned') return this.finalizePurchased(current, order, reconciliation.owned, actor);
        }
        return { ok: false, code: error.ambiguous ? 'ambiguous_reconcile_required' : 'provider_rejected', error: attempt.error, order };
      }
    },

    async finalizePurchased(current, order, owned, actor) {
      order.status = 'purchased';
      order.purchasedAt = iso();
      order.updatedAt = iso();
      const line = upsertLine(current, {
        provider: order.provider, phoneNumber: order.phoneNumber, providerId: owned.providerId,
        capabilities: owned.capabilities, source: 'purchased', purchasedBy: actor, orderId: order.id,
        commissioning: { status: 'uncommissioned' }, callerIdEnabled: false,
      });
      await save(current);
      return { ok: true, order, line: decorate(line) };
    },

    getLine(lineId) {
      const line = store().lines.find((l) => l.id === lineId);
      return line ? decorate(line) : null;
    },

    proposedRoute(lineId) {
      const line = store().lines.find((l) => l.id === lineId);
      return line ? buildVoiceRoute(line.provider, env) : null;
    },

    async requestCommission({ lineId, actor = 'staff' }) {
      const current = store();
      const line = current.lines.find((l) => l.id === lineId);
      if (!line) return { ok: false, code: 'line_not_found', error: 'Line not found.' };
      if (line.source === 'existing_runtime') return { ok: false, code: 'legacy_line', error: 'Existing runtime lines keep their current voice route.' };
      if (!line.providerId) return { ok: false, code: 'not_imported', error: 'Import the owned number before commissioning.' };
      const route = buildVoiceRoute(line.provider, env);
      if (!route) return { ok: false, code: 'route_not_configured', error: 'No PBK voice route is configured for this provider.' };
      const commission = { id: `commission-${randomUUID()}`, lineId, route, routeHash: hashRoute(route), status: 'awaiting_approval', approvalId: '', requestedBy: actor, createdAt: iso() };
      current.commissions.unshift(commission);
      line.commissioning = { status: 'awaiting_approval', commissionId: commission.id, routeHash: commission.routeHash };
      await save(current);
      return { ok: true, commission, line: decorate(line) };
    },

    async attachCommissionApproval(commissionId, approvalId) {
      const current = store();
      const commission = current.commissions.find((c) => c.id === commissionId);
      if (commission) {
        commission.approvalId = approvalId;
        const line = current.lines.find((l) => l.id === commission.lineId);
        if (line?.commissioning?.commissionId === commissionId) line.commissioning.approvalId = approvalId;
        await save(current);
      }
      return commission;
    },

    getCommission(commissionId) {
      return store().commissions.find((c) => c.id === commissionId) || null;
    },

    async executeCommission({ commissionId, approval, actor = 'staff' }) {
      const current = store();
      const commission = current.commissions.find((c) => c.id === commissionId);
      if (!commission) return { ok: false, code: 'commission_not_found', error: 'Commission request not found.' };
      if (!approval || approval.id !== commission.approvalId || approval.status !== 'approved') {
        return { ok: false, code: 'approval_required', error: 'The voice route needs an approved admin approval first.' };
      }
      if (hashRoute(commission.route) !== commission.routeHash) return { ok: false, code: 'route_changed', error: 'Approved route no longer matches.' };
      const line = current.lines.find((l) => l.id === commission.lineId);
      const adapter = adapterFor(line.provider);
      await adapter.applyVoiceRoute(line, commission.route);
      const readback = await adapter.readVoiceRoute(line);
      const verified = routesMatch(commission.route, readback);
      commission.status = verified ? 'verified' : 'readback_mismatch';
      commission.executedBy = actor;
      commission.readbackAt = iso();
      line.commissioning = {
        status: verified ? 'commissioned' : 'readback_mismatch',
        commissionId: commission.id, routeHash: commission.routeHash, verifiedAt: verified ? iso() : null,
      };
      if (!verified) line.callerIdEnabled = false;
      await save(current);
      return { ok: verified, code: verified ? '' : 'readback_mismatch', error: verified ? '' : 'Provider readback did not match the approved route. Line stays disabled.', line: decorate(line), commission };
    },

    async setCallerIdEnabled({ lineId, enabled, actor = 'staff' }) {
      const current = store();
      const line = current.lines.find((l) => l.id === lineId);
      if (!line) return { ok: false, code: 'line_not_found', error: 'Line not found.' };
      if (line.phoneNumber === defaultLine) return { ok: false, code: 'default_line_locked', error: 'The default caller ID line is managed by the existing runtime.' };
      if (enabled) {
        if (line.commissioning?.status !== 'commissioned') return { ok: false, code: 'not_commissioned', error: 'Commission the line and pass readback before enabling caller ID.' };
        // Re-verify readback right before enabling.
        const commission = current.commissions.find((c) => c.id === line.commissioning.commissionId);
        const readback = await adapterFor(line.provider).readVoiceRoute(line);
        if (!commission || !routesMatch(commission.route, readback)) {
          line.commissioning.status = 'readback_mismatch';
          line.callerIdEnabled = false;
          await save(current);
          return { ok: false, code: 'readback_mismatch', error: 'Voice route drifted since commissioning. Re-commission the line.' };
        }
      }
      line.callerIdEnabled = Boolean(enabled);
      line.callerIdChangedBy = actor;
      line.callerIdChangedAt = iso();
      await save(current);
      return { ok: true, line: decorate(line) };
    },

    // Dialer helper: a line usable for outbound click-to-call.
    outboundLine(lineId, { provider = 'twilio' } = {}) {
      const line = store().lines.find((l) => l.id === lineId);
      if (!line) return { ok: false, code: 'line_unavailable', error: 'Outbound line not found.' };
      const decorated = decorate(line);
      if (line.provider !== provider) return { ok: false, code: 'line_unavailable', error: `Click-to-call requires a ${provider} line.` };
      if (line.commissioning?.status !== 'commissioned') return { ok: false, code: 'line_unavailable', error: 'Outbound line is not commissioned.' };
      if (!decorated.callerIdEnabled) return { ok: false, code: 'line_unavailable', error: 'Outbound line is not enabled as caller ID.' };
      return { ok: true, line: decorated };
    },
  };
}
