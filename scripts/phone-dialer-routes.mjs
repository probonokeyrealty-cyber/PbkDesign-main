// Bridge routes for the PBK Phone Numbers manager and parcel dialer.
// The bridge injects its own state, approval queue, DNC lookup, permissions
// and persistence so these routes reuse the existing PBK gates.
import { createMockAdapters, createPhoneNumberService, createTelnyxAdapter, createTwilioAdapter, last4, normalizeE164, TWILIO_INBOUND_VOICE_PATH } from './phone-numbers.mjs';
import { createParcelDialer, resolveParcelSource, verifyTwilioSignature } from './parcel-dialer.mjs';

const MOCK_TWILIO_AUTH_TOKEN = 'pbk-dev-mock-twilio-signing'; // dev-only, not a credential
const ALL_PERMISSIONS = { canPlaceCalls: true, canManagePhoneNumbers: true, canApproveProviderActions: true };

export function resolvePhoneProviderMode(env = {}, isHosted = false) {
  const explicit = String(env.PBK_PHONE_PROVIDER_MODE || '').trim().toLowerCase();
  if (explicit === 'live' || explicit === 'mock') return explicit;
  return isHosted ? 'live' : 'mock';
}

export function createPhoneDialerRuntime({
  env = process.env,
  isHosted = false,
  getState,
  persistState,
  createApproval,
  isPhoneDnc,
  defaultCallerId = '',
  logActivity = () => {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  adapters: adapterOverride,
} = {}) {
  const mode = resolvePhoneProviderMode(env, isHosted);
  const mock = mode === 'mock';
  const effectiveEnv = { ...env };
  let effectiveDefault = normalizeE164(defaultCallerId);
  let adapters = adapterOverride;
  if (!adapters && mock) {
    // Synthetic numbers only: 8134 default + 5307 Ava/ElevenLabs line on
    // Telnyx, and one owned-but-unimported Twilio line for commissioning.
    effectiveDefault = effectiveDefault || '+15555558134';
    if (!effectiveEnv.PBK_AVA_ELEVENLABS_PHONE_LINES) effectiveEnv.PBK_AVA_ELEVENLABS_PHONE_LINES = '+18885555307';
    if (!effectiveEnv.PBK_PUBLIC_BASE_URL) effectiveEnv.PBK_PUBLIC_BASE_URL = 'http://localhost';
    if (!effectiveEnv.PBK_TELNYX_CONNECTION_ID) effectiveEnv.PBK_TELNYX_CONNECTION_ID = 'mock-connection';
    // Synthetic inbound destination for mock mode only; never a PBK line.
    if (!effectiveEnv.PBK_TWILIO_INBOUND_DESTINATION && !('PBK_TWILIO_INBOUND_DESTINATION' in env)) effectiveEnv.PBK_TWILIO_INBOUND_DESTINATION = '+15555550198';
    adapters = createMockAdapters({
      seedOwned: [
        { provider: 'telnyx', providerId: 'txmock8134', phoneNumber: effectiveDefault, capabilities: { voice: true, sms: true }, voiceRoute: { connectionId: 'mock-connection' } },
        { provider: 'telnyx', providerId: 'txmock5307', phoneNumber: '+18885555307', capabilities: { voice: true, sms: true }, voiceRoute: { connectionId: 'mock-connection' } },
        { provider: 'twilio', providerId: 'PNmock0150', phoneNumber: '+15555550150', capabilities: { voice: true, sms: true }, voiceRoute: { voiceUrl: '', voiceMethod: 'POST', statusCallback: '' } },
      ],
    });
  } else if (!adapters) {
    adapters = {
      twilio: createTwilioAdapter({ accountSid: env.PBK_TWILIO_ACCOUNT_SID, authToken: env.PBK_TWILIO_AUTH_TOKEN, fetchImpl }),
      telnyx: createTelnyxAdapter({ apiKey: env.PBK_TELNYX_API_KEY || env.TELNYX_API_KEY, connectionId: env.PBK_TELNYX_CONNECTION_ID, fetchImpl }),
    };
  }
  const twilioAuthToken = mock ? MOCK_TWILIO_AUTH_TOKEN : String(env.PBK_TWILIO_AUTH_TOKEN || '');

  const phoneStore = () => { const s = getState(); if (!s.phoneNumbers) s.phoneNumbers = {}; return s.phoneNumbers; };
  const dialerStore = () => { const s = getState(); if (!s.parcelDialer) s.parcelDialer = {}; return s.parcelDialer; };
  const persist = async () => { await persistState(getState()); };

  const phoneNumbers = createPhoneNumberService({
    adapters,
    readStore: phoneStore,
    writeStore: async (next) => { getState().phoneNumbers = next; await persist(); },
    env: effectiveEnv,
    now,
    defaultCallerId: effectiveDefault,
    purchasesEnabled: String(env.PBK_PHONE_NUMBER_PURCHASES_ENABLED || '').trim() === 'true',
  });

  const listCrmLeads = () => {
    const s = getState();
    return [...(s.leadImports || []), ...(s.leads || [])];
  };

  async function recordLeadResult(leadId, result) {
    const lead = listCrmLeads().find((l) => (l.id || l.leadId) === leadId);
    if (!lead) return false;
    lead.dialerCalls = [result, ...(Array.isArray(lead.dialerCalls) ? lead.dialerCalls : [])].slice(0, 25);
    lead.lastCallOutcome = result.outcome;
    lead.lastCallTalkSeconds = result.talkSeconds;
    lead.lastContactedAt = result.at;
    logActivity({ category: 'CALL', status: result.outcome, text: `Parcel dialer call ${result.outcome} (${result.talkSeconds}s talk)`, target: lead.seller?.name || lead.leadName || leadId });
    return true;
  }

  const dialer = createParcelDialer({
    parcelSource: resolveParcelSource(effectiveEnv, { fetchImpl }),
    phoneNumbers,
    twilio: adapters.twilio,
    listLeads: listCrmLeads,
    isDnc: async (phone) => Boolean(await isPhoneDnc(phone)),
    readStore: dialerStore,
    writeStore: async (next) => { getState().parcelDialer = next; await persist(); },
    recordLeadResult,
    env: effectiveEnv,
    now,
    mock,
  });

  return { mode, mock, phoneNumbers, dialer, adapters, twilioAuthToken, logActivity, publicBase: String(effectiveEnv.PBK_PUBLIC_BASE_URL || '').replace(/\/+$/, '') };
}

function sessionContext(request, getTeamPermissions) {
  if (request.pbkDirectTeamAuth) {
    return { role: 'team', actor: request.pbkTeamAuth?.actor || 'PBK team', permissions: getTeamPermissions() };
  }
  return { role: 'admin', actor: 'PBK founder', permissions: ALL_PERMISSIONS };
}

export function createPhoneDialerRouter({ runtime, json, readBody, readRawBodyBuffer, getState, getTeamPermissions, createApproval }) {
  const { phoneNumbers, dialer } = runtime;
  const findApproval = (id) => (getState().approvals || []).find((a) => a.id === id) || null;
  const match = (pathname, re) => pathname.match(re);
  const deny = (response, permission) => json(response, 403, { ok: false, code: 'team_permission_denied', permission, error: 'This PBK team session is not permitted to do that.' });
  const fail = (response, result, status = 409) => json(response, status, { ok: false, ...result });

  return async function handle(request, response, pathname, url) {
    if (!pathname.startsWith('/api/phone-numbers') && !pathname.startsWith('/api/dialer') && pathname !== '/api/webhooks/twilio/voice-status' && pathname !== TWILIO_INBOUND_VOICE_PATH) return false;
    const method = String(request.method || 'GET').toUpperCase();

    // Signed Twilio inbound Voice webhook (public route; signature is the auth).
    // Unsigned or forged requests are rejected before any routing decision.
    if (pathname === TWILIO_INBOUND_VOICE_PATH) {
      if (method !== 'POST') { json(response, 405, { ok: false, code: 'method_not_allowed' }); return true; }
      const raw = (await readRawBodyBuffer(request)).toString('utf8');
      const params = Object.fromEntries(new URLSearchParams(raw));
      const fullUrl = `${runtime.publicBase || 'http://localhost'}${request.url}`;
      if (!runtime.twilioAuthToken || !verifyTwilioSignature({ url: fullUrl, params, signature: request.headers['x-twilio-signature'], authToken: runtime.twilioAuthToken })) {
        json(response, 403, { ok: false, code: 'bad_signature' });
        return true;
      }
      const result = phoneNumbers.inboundVoiceTwiml({ to: params.To, callSid: params.CallSid });
      runtime.logActivity({ category: 'CALL', status: result.outcome, text: `Inbound Twilio call ${result.outcome.replace(/_/g, ' ')}`, target: result.lineLast4 ? `line ending ${result.lineLast4}` : 'unknown line' });
      response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(result.twiml);
      return true;
    }

    // Signed Twilio status callback (public route; signature is the auth).
    if (pathname === '/api/webhooks/twilio/voice-status' && method === 'POST') {
      const raw = (await readRawBodyBuffer(request)).toString('utf8');
      const params = Object.fromEntries(new URLSearchParams(raw));
      const fullUrl = `${runtime.publicBase || 'http://localhost'}${request.url}`;
      const result = await dialer.handleStatusCallback({ url: fullUrl, params, signature: request.headers['x-twilio-signature'], authToken: runtime.twilioAuthToken });
      if (!result.ok) { json(response, result.statusCode || 400, { ok: false, code: result.code }); return true; }
      json(response, 200, { ok: true });
      return true;
    }

    const ctx = sessionContext(request, getTeamPermissions);
    const body = method === 'GET' ? {} : await readBody(request);
    const canManage = ctx.permissions.canManagePhoneNumbers === true;

    try {
      // ----------------------------- Phone Numbers -----------------------------
      if (pathname === '/api/phone-numbers' && method === 'GET') {
        json(response, 200, { ok: true, mode: runtime.mode, ...(await phoneNumbers.inventory()), canManage });
        return true;
      }
      if (pathname.startsWith('/api/phone-numbers') && !canManage) { deny(response, 'canManagePhoneNumbers'); return true; }

      if (pathname === '/api/phone-numbers/import' && method === 'POST') {
        const result = await phoneNumbers.importOwned({ provider: body.provider, phoneNumber: body.phoneNumber, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result, 422);
        return true;
      }
      if (pathname === '/api/phone-numbers/search' && method === 'POST') {
        const result = await phoneNumbers.search({ provider: body.provider, type: body.type, areaCode: body.areaCode, contains: body.contains, limit: 15 });
        result.ok ? json(response, 200, result) : fail(response, result, 422);
        return true;
      }
      if (pathname === '/api/phone-numbers/quotes' && method === 'POST') {
        const result = await phoneNumbers.quote({ provider: body.provider, phoneNumber: body.phoneNumber, type: body.type, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result);
        return true;
      }
      if (pathname === '/api/phone-numbers/orders' && method === 'POST') {
        const result = await phoneNumbers.createOrder({ ...body, actor: ctx.actor });
        if (!result.ok) { fail(response, result); return true; }
        const { order } = result;
        const created = await createApproval({
          type: 'phone_number_purchase',
          approvalAction: 'admin_phone_number_purchase',
          provider: order.provider,
          leadName: `${order.provider} line ending ${last4(order.phoneNumber)}`,
          address: `${order.type === 'toll_free' ? 'Toll-free' : 'Local'} number purchase`,
          amount: order.price.monthly,
          source: 'phone-numbers-manager',
          notes: `Purchase exact number ending ${last4(order.phoneNumber)} on ${order.provider}: $${order.price.upfront ?? 0} upfront, $${order.price.monthly}/mo (${order.price.currency}).`,
          metadata: { orderId: order.id, provider: order.provider, phoneNumber: order.phoneNumber, price: order.price },
        });
        const updated = await phoneNumbers.attachApproval(order.id, created.approval.id);
        json(response, 200, { ok: true, order: updated, approvalId: created.approval.id });
        return true;
      }
      let m = match(pathname, /^\/api\/phone-numbers\/orders\/([^/]+)\/execute$/);
      if (m && method === 'POST') {
        const order = phoneNumbers.getOrder(m[1]);
        const result = await phoneNumbers.executeOrder({ orderId: m[1], approval: order ? findApproval(order.approvalId) : null, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result);
        return true;
      }
      m = match(pathname, /^\/api\/phone-numbers\/lines\/([^/]+)\/commission$/);
      if (m && method === 'POST') {
        const result = await phoneNumbers.requestCommission({ lineId: m[1], actor: ctx.actor });
        if (!result.ok) { fail(response, result); return true; }
        const { commission } = result;
        const line = result.line;
        const created = await createApproval({
          type: 'phone_number_commission',
          approvalAction: 'admin_voice_route',
          provider: line.provider,
          leadName: `${line.provider} line ending ${line.last4}`,
          address: 'Apply PBK voice route',
          source: 'phone-numbers-manager',
          notes: `Apply the PBK voice route (route ${commission.routeHash}) to the ${line.provider} line ending ${line.last4}, then verify readback.`,
          metadata: { commissionId: commission.id, lineId: line.id, routeHash: commission.routeHash },
        });
        await phoneNumbers.attachCommissionApproval(commission.id, created.approval.id);
        json(response, 200, { ok: true, commissionId: commission.id, approvalId: created.approval.id, line });
        return true;
      }
      m = match(pathname, /^\/api\/phone-numbers\/commissions\/([^/]+)\/execute$/);
      if (m && method === 'POST') {
        const commission = phoneNumbers.getCommission(m[1]);
        const result = await phoneNumbers.executeCommission({ commissionId: m[1], approval: commission ? findApproval(commission.approvalId) : null, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result);
        return true;
      }
      m = match(pathname, /^\/api\/phone-numbers\/lines\/([^/]+)\/caller-id$/);
      if (m && method === 'POST') {
        const result = await phoneNumbers.setCallerIdEnabled({ lineId: m[1], enabled: body.enabled === true, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result);
        return true;
      }

      // ------------------------------- Dialer ---------------------------------
      if (pathname === '/api/dialer/coverage' && method === 'GET') {
        json(response, 200, { ok: true, coverage: await dialer.coverage(), lines: await dialer.outboundLines(), canPlaceCalls: ctx.permissions.canPlaceCalls === true });
        return true;
      }
      if (pathname === '/api/dialer/parcels' && method === 'GET') {
        const bbox = String(url.searchParams.get('bbox') || '').split(',').map(Number);
        json(response, 200, { ok: true, ...(await dialer.parcelsInBounds(bbox.length === 4 && bbox.every(Number.isFinite) ? bbox : null)) });
        return true;
      }
      if (pathname === '/api/dialer/select' && method === 'POST') {
        const result = await dialer.selectParcel({ parcelId: body.parcelId, address: body.address, lineId: body.lineId, canPlaceCalls: ctx.permissions.canPlaceCalls === true });
        if (result.pendingRequest) result.pendingRequest.approvalStatus = String(findApproval(result.pendingRequest.approvalId)?.status || 'pending');
        json(response, result.ok ? 200 : 404, result);
        return true;
      }
      if (pathname === '/api/dialer/calls' && method === 'GET') {
        json(response, 200, { ok: true, calls: dialer.listCalls() });
        return true;
      }
      if (pathname.startsWith('/api/dialer/call') && ctx.permissions.canPlaceCalls !== true) { deny(response, 'canPlaceCalls'); return true; }
      if (pathname === '/api/dialer/call-requests' && method === 'POST') {
        const result = await dialer.requestCall({ parcelId: body.parcelId, leadId: body.leadId, lineId: body.lineId, canPlaceCalls: true, actor: ctx.actor });
        if (!result.ok) { fail(response, result, 422); return true; }
        const raw = dialer.getRequest(result.request.id);
        const created = await createApproval({
          type: 'dialer_call',
          approvalAction: 'twilio_click_to_call',
          provider: 'twilio',
          leadId: raw.leadId,
          leadName: result.contact.name,
          address: result.contact.address,
          source: 'parcel-dialer',
          notes: `Manual click-to-call to the contact ending ${result.request.toLast4} from Twilio line ending ${result.request.fromLast4}. One call, operator-bridged.`,
          metadata: { requestId: raw.id, bindingHash: raw.bindingHash, parcelId: raw.parcelId },
        });
        await dialer.attachApproval(raw.id, created.approval.id);
        json(response, 200, { ok: true, request: dialer.publicRequest(dialer.getRequest(raw.id)), approvalId: created.approval.id });
        return true;
      }
      m = match(pathname, /^\/api\/dialer\/call-requests\/([^/]+)\/dial$/);
      if (m && method === 'POST') {
        const req = dialer.getRequest(m[1]);
        const result = await dialer.placeCall({ requestId: m[1], approval: req ? findApproval(req.approvalId) : null, canPlaceCalls: true, actor: ctx.actor });
        result.ok ? json(response, 200, result) : fail(response, result);
        return true;
      }
      m = match(pathname, /^\/api\/dialer\/calls\/([^/]+)\/simulate$/);
      if (m && method === 'POST') {
        if (!runtime.mock) { json(response, 404, { ok: false, code: 'mock_only' }); return true; }
        const result = await dialer.simulateCallbacks({ callId: m[1], outcome: body.outcome || 'connected', talkSeconds: Number(body.talkSeconds) || 42, authToken: runtime.twilioAuthToken });
        json(response, result.ok ? 200 : 404, result);
        return true;
      }
    } catch (error) {
      json(response, error?.code === 'not_configured' ? 503 : 502, { ok: false, code: error?.code || 'provider_error', error: String(error?.message || 'Provider request failed.').slice(0, 240) });
      return true;
    }
    return false;
  };
}
