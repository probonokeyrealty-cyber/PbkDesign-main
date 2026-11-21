import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  addressKey, buildFixtureParcels, computeTwilioSignature, createFixtureParcelSource, matchParcelToLeads,
  resolveParcelSource, validateParcelFeature, verifyTwilioSignature,
} from './parcel-dialer.mjs';
import { createPhoneDialerRouter, createPhoneDialerRuntime, resolvePhoneProviderMode } from './phone-dialer-routes.mjs';

// ---------------------------------------------------------------------------
// Harness: mock-mode runtime over an in-memory bridge state + approval queue.
// ---------------------------------------------------------------------------
function harness({ dnc = [], leads = [], env = {}, state: sharedState } = {}) {
  const state = sharedState || { approvals: [], leadImports: leads, activity: [] };
  const runtime = createPhoneDialerRuntime({
    env: { PBK_PHONE_PROVIDER_MODE: 'mock', ...env },
    getState: () => state,
    persistState: async () => {},
    isPhoneDnc: (phone) => dnc.includes(phone),
    logActivity: (entry) => state.activity.push(entry),
  });
  const createApproval = async (params) => {
    const approval = { id: `appr-${state.approvals.length + 1}`, status: 'pending', ...params };
    state.approvals.unshift(approval);
    return { approval };
  };
  const router = createPhoneDialerRouter({
    runtime,
    json: (res, status, payload) => { res.status = status; res.payload = payload; },
    readBody: async (req) => req.body || {},
    readRawBodyBuffer: async (req) => Buffer.from(req.raw || ''),
    getState: () => state,
    getTeamPermissions: () => ({ canPlaceCalls: true, canManagePhoneNumbers: false, canApproveProviderActions: true }),
    createApproval,
  });
  const call = async (method, path, body, { team = false, headers = {}, raw } = {}) => {
    const url = new URL(path, 'http://localhost');
    const req = { method, url: path, body, raw, headers, pbkDirectTeamAuth: team, pbkTeamAuth: team ? { actor: 'tester' } : undefined };
    const res = { writeHead(status, h) { this.status = status; this.headers = h; }, end(body) { this.body = body; } };
    const handled = await router(req, res, url.pathname, url);
    return { handled, status: res.status, body: res.body, headers: res.headers, ...res.payload };
  };
  const approve = (id) => { state.approvals.find((a) => a.id === id).status = 'approved'; };
  return { state, runtime, call, approve };
}

async function commissionTwilioLine(h) {
  const imported = await h.call('POST', '/api/phone-numbers/import', { provider: 'twilio', phoneNumber: '+15555550150' });
  const lineId = imported.line.id;
  const req = await h.call('POST', `/api/phone-numbers/lines/${lineId}/commission`);
  h.approve(req.approvalId);
  const exec = await h.call('POST', `/api/phone-numbers/commissions/${req.commissionId}/execute`);
  assert.equal(exec.ok, true, 'commissioned');
  const cid = await h.call('POST', `/api/phone-numbers/lines/${lineId}/caller-id`, { enabled: true });
  assert.equal(cid.ok, true);
  return lineId;
}

// ---------------------------------------------------------------------------
test('fixture parcel source exposes a clear coverage state and valid polygons', async () => {
  const features = buildFixtureParcels();
  assert.ok(features.length >= 30);
  assert.ok(features.every(validateParcelFeature));
  const source = createFixtureParcelSource();
  const coverage = source.coverage();
  assert.equal(coverage.status, 'fixture');
  assert.equal(coverage.licensed, false);
  assert.equal(resolveParcelSource({ PBK_PARCEL_FIXTURES: 'off' }).coverage().status, 'unconfigured');
  assert.equal(resolveParcelSource({ PBK_PARCEL_SOURCE_URL: 'https://parcels.example.test' }).kind, 'fixture', 'URL without license does not activate the live source');
  assert.equal(resolveParcelSource({ PBK_PARCEL_SOURCE_URL: 'https://parcels.example.test', PBK_PARCEL_SOURCE_LICENSE: 'lic' }).kind, 'licensed');
  assert.equal(addressKey({ line1: '100 Maple Hollow Road', zip: '43999-1234' }), addressKey({ line1: '100 maple hollow rd.', zip: '43999' }));
});

test('parcel association is exact and rejects ambiguous matches', async () => {
  const source = createFixtureParcelSource();
  const parcel = await source.getById('fx-01-001-00');
  const leads = [
    { id: 'a', property: { parcelId: 'FX-01-001-00' } },
    { id: 'b', property: { address: '999 Elsewhere St, Fixtureville, OH 43999' } },
  ];
  assert.equal(matchParcelToLeads(parcel, leads).lead.id, 'a');
  assert.equal(matchParcelToLeads(parcel, [{ id: 'c', property: { address: '100 Maple Hollow Road, Fixtureville, OH 43999' } }]).matchedOn, 'address');
  assert.equal(matchParcelToLeads(parcel, [{ id: 'd', property: { address: '100 Maple Hollow Rd, Other, OH 43001' } }]).status, 'no_match', 'different ZIP is not a match');
  assert.equal(matchParcelToLeads(parcel, [...leads, { id: 'e', property: { address: '100 Maple Hollow Rd, Fixtureville, OH 43999' } }]).status, 'ambiguous');
  // Two parcels share one situs address in the fixtures: address lookup must refuse.
  const h = harness();
  const dupAddr = (await source.getById('FX-04-008-01')).properties.situs;
  const res = await h.call('POST', '/api/dialer/select', { address: `${dupAddr.line1}, ${dupAddr.city}, ${dupAddr.state} ${dupAddr.zip}` });
  assert.equal(res.lookup, 'ambiguous');
});

test('parcel selection returns contact, activity and eligibility but creates zero calls', async () => {
  const h = harness();
  const res = await h.call('POST', '/api/dialer/select', { parcelId: 'FX-01-001-00' });
  assert.equal(res.ok, true);
  assert.equal(res.match.status, 'matched');
  assert.equal(res.contact.id, 'fixture-lead-01');
  assert.equal(res.contact.phoneLast4, '0101');
  assert.equal(res.contact.phoneDisplay.includes('555'), false, 'full phone is not returned to the client');
  assert.ok(Array.isArray(res.activity));
  assert.equal(res.eligibility.eligible, false);
  assert.ok(res.eligibility.reasons.some((r) => r.code === 'line_unavailable'));
  assert.equal(h.state.approvals.length, 0);
  assert.equal((h.state.parcelDialer?.callRequests || []).length, 0, 'no call request');
  assert.equal((h.state.parcelDialer?.calls || []).length, 0, 'no call record');
  assert.equal(h.runtime.adapters._mock.calls.length, 0);
});

test('one-contact dial eligibility: DNC, missing phone, ambiguous and unavailable lines are rejected', async () => {
  const h = harness({ dnc: ['+15555550107'] });
  const lineId = await commissionTwilioLine(h);
  const check = async (parcelId) => (await h.call('POST', '/api/dialer/select', { parcelId, lineId })).eligibility;
  assert.equal((await check('FX-01-001-00')).eligible, true);
  assert.ok((await check('FX-02-002-00')).reasons.some((r) => r.code === 'dnc'), 'lead DNC flag');
  assert.ok((await check('FX-04-006-00')).reasons.some((r) => r.code === 'dnc'), 'PBK DNC list via address match');
  assert.ok((await check('FX-02-005-00')).reasons.some((r) => r.code === 'no_phone'));
  assert.ok((await check('FX-03-004-00')).reasons.some((r) => r.code === 'ambiguous_match'));
  // Telnyx default line cannot be used for Twilio click-to-call.
  const inv = await h.call('GET', '/api/phone-numbers');
  const telnyxDefault = inv.lines.find((l) => l.roles.defaultCallerId);
  assert.ok((await h.call('POST', '/api/dialer/select', { parcelId: 'FX-01-001-00', lineId: telnyxDefault.id })).eligibility.reasons.some((r) => r.code === 'line_unavailable'));
  // Disabling caller ID makes the line unavailable again.
  await h.call('POST', `/api/phone-numbers/lines/${lineId}/caller-id`, { enabled: false });
  const rejected = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-01-001-00', leadId: 'fixture-lead-01', lineId });
  assert.equal(rejected.code, 'line_unavailable');
  const ambiguous = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-03-004-00', leadId: 'fixture-lead-05', lineId });
  assert.equal(ambiguous.code, 'ambiguous_match');
  assert.equal(h.runtime.adapters._mock.calls.length, 0);
});

test('click-to-call requires an approved, exactly bound approval and places one call', async () => {
  const h = harness();
  const lineId = await commissionTwilioLine(h);
  const mismatch = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-01-001-00', leadId: 'fixture-lead-02', lineId });
  assert.equal(mismatch.code, 'lead_mismatch');
  const req = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-01-001-00', leadId: 'fixture-lead-01', lineId });
  assert.equal(req.ok, true);
  const approval = h.state.approvals.find((a) => a.id === req.approvalId);
  assert.equal(approval.type, 'dialer_call');
  assert.equal(approval.status, 'pending');
  assert.equal(JSON.stringify(approval).includes('+15555550101'), false, 'approval does not carry the full contact number');
  const dup = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-01-001-00', leadId: 'fixture-lead-01', lineId });
  assert.equal(dup.code, 'request_pending');

  const resumed = await h.call('POST', '/api/dialer/select', { parcelId: 'FX-01-001-00', lineId });
  assert.equal(resumed.pendingRequest.id, req.request.id, 'selection surfaces the open request for resume');
  assert.equal(resumed.pendingRequest.approvalStatus, 'pending');
  assert.equal(h.runtime.adapters._mock.calls.length, 0, 'resuming via selection does not dial');
  const early = await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`);
  assert.equal(early.code, 'approval_required');
  assert.equal(h.runtime.adapters._mock.calls.length, 0);

  h.approve(req.approvalId);
  approval.metadata.bindingHash = 'tampered';
  assert.equal((await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`)).code, 'approval_binding_mismatch');
  approval.metadata.bindingHash = h.runtime.dialer.getRequest(req.request.id).bindingHash;

  assert.equal((await h.call('POST', '/api/dialer/select', { parcelId: 'FX-01-001-00', lineId })).pendingRequest.approvalStatus, 'approved');
  const dialed = await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`);
  assert.equal(dialed.ok, true);
  const again = await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`);
  assert.equal(again.replay, true);
  const placed = h.runtime.adapters._mock.calls;
  assert.equal(placed.length, 1, 'exactly one call');
  assert.equal(placed[0].from, '+15555550150', 'from the commissioned Twilio line');
  assert.equal(placed[0].to, '+15555550199', 'operator leg first (agent bridge)');
});

test('signed Twilio callbacks reconcile outcome and talk time onto the exact CRM lead', async () => {
  const realLead = { id: 'crm-lead-77', seller: { name: 'Synthetic CRM Owner', phone: '+15555550177' }, property: { parcelId: 'FX-04-002-00' } };
  const h = harness({ leads: [realLead] });
  const lineId = await commissionTwilioLine(h);
  const req = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-04-002-00', leadId: 'crm-lead-77', lineId });
  h.approve(req.approvalId);
  const { call } = await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`);
  const raw = h.state.parcelDialer.calls.find((c) => c.id === call.id);
  const token = h.runtime.twilioAuthToken;
  const send = async (leg, params, { sign = true } = {}) => {
    const path = `/api/webhooks/twilio/voice-status?pbkCallId=${encodeURIComponent(call.id)}&leg=${leg}`;
    const url = `http://localhost${path}`;
    const signature = sign ? computeTwilioSignature(token, url, params) : 'bogus';
    return h.call('POST', path, undefined, { raw: new URLSearchParams(params).toString(), headers: { 'x-twilio-signature': signature } });
  };
  const forged = await send('lead', { CallSid: 'CAx', ParentCallSid: raw.agentCallSid, CallStatus: 'completed', CallDuration: '999' }, { sign: false });
  assert.equal(forged.status, 403);
  assert.equal(realLead.dialerCalls, undefined);

  await send('agent', { CallSid: raw.agentCallSid, CallStatus: 'in-progress', SequenceNumber: '1' });
  const stranger = await send('lead', { CallSid: 'CAlead1', ParentCallSid: 'CAsomeoneelse', CallStatus: 'completed', CallDuration: '500' });
  assert.equal(stranger.ok, true);
  assert.equal(realLead.dialerCalls, undefined, 'callbacks from another parent call are ignored');
  await send('lead', { CallSid: 'CAlead1', ParentCallSid: raw.agentCallSid, CallStatus: 'ringing', SequenceNumber: '0' });
  const done = { CallSid: 'CAlead1', ParentCallSid: raw.agentCallSid, CallStatus: 'completed', CallDuration: '73', SequenceNumber: '2' };
  await send('lead', done);
  await send('lead', done); // duplicate delivery
  await send('agent', { CallSid: raw.agentCallSid, CallStatus: 'completed', CallDuration: '90', SequenceNumber: '3' });
  assert.equal(realLead.dialerCalls.length, 1, 'recorded once on the exact lead');
  assert.equal(realLead.dialerCalls[0].outcome, 'connected');
  assert.equal(realLead.dialerCalls[0].talkSeconds, 73, 'talk time is the lead leg duration, not the operator leg');
  assert.equal(realLead.lastCallTalkSeconds, 73);
  assert.equal(h.state.parcelDialer.calls[0].finalizedAt != null, true);
});

test('dev simulator drives the same signed path for fixture contacts', async () => {
  const h = harness();
  const lineId = await commissionTwilioLine(h);
  const req = await h.call('POST', '/api/dialer/call-requests', { parcelId: 'FX-01-003-00', leadId: 'fixture-lead-02', lineId });
  h.approve(req.approvalId);
  const { call } = await h.call('POST', `/api/dialer/call-requests/${req.request.id}/dial`);
  const sim = await h.call('POST', `/api/dialer/calls/${call.id}/simulate`, { outcome: 'no-answer' });
  assert.equal(sim.call.outcome, 'no-answer');
  assert.equal(sim.call.talkSeconds, 0);
  const select = await h.call('POST', '/api/dialer/select', { parcelId: 'FX-01-003-00', lineId });
  assert.equal(select.activity[0].outcome, 'no-answer');
});

test('team sessions: phone number management and dialing follow PBK permissions', async () => {
  const h = harness();
  const inv = await h.call('GET', '/api/phone-numbers', undefined, { team: true });
  assert.equal(inv.ok, true);
  assert.equal(inv.canManage, false);
  for (const [method, path] of [['POST', '/api/phone-numbers/import'], ['POST', '/api/phone-numbers/search'], ['POST', '/api/phone-numbers/quotes'], ['POST', '/api/phone-numbers/orders']]) {
    const res = await h.call(method, path, { provider: 'twilio', phoneNumber: '+15555550150' }, { team: true });
    assert.equal(res.status, 403, `${path} denied`);
    assert.equal(res.permission, 'canManagePhoneNumbers');
  }
  assert.equal(resolvePhoneProviderMode({}, true), 'live', 'hosted defaults to live adapters (no mock data in production)');
  assert.equal(resolvePhoneProviderMode({}, false), 'mock');
});

test('bridge team gate denies phone-number writes and dialer calls without permission', () => {
  const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fn = bridge.match(/^function authorizeDirectTeamBridgeRequest\(\{[\s\S]*?\n\}\n(?=\nfunction getTeamApprovalRestriction)/m)?.[0];
  assert.ok(fn);
  const authorize = runInNewContext(`${fn}\nauthorizeDirectTeamBridgeRequest`, { getAvaChatRequiredPermissions: () => new Set() });
  const base = { canPlaceCalls: true, canSendSms: true, canSendEmail: true, canDeleteLeads: true, canApproveProviderActions: true };
  const purchase = authorize({ method: 'POST', pathname: '/api/phone-numbers/orders/x/execute', permissions: base });
  assert.equal(purchase.ok, false);
  assert.equal(purchase.permission, 'canManagePhoneNumbers');
  assert.equal(authorize({ method: 'GET', pathname: '/api/phone-numbers', permissions: base }).ok, true);
  assert.equal(authorize({ method: 'POST', pathname: '/api/phone-numbers/import', permissions: { ...base, canManagePhoneNumbers: true } }).ok, true);
  const dial = authorize({ method: 'POST', pathname: '/api/dialer/call-requests/x/dial', permissions: { ...base, canPlaceCalls: false } });
  assert.equal(dial.permission, 'canPlaceCalls');
  assert.equal(authorize({ method: 'POST', pathname: '/api/dialer/select', permissions: { ...base, canPlaceCalls: false } }).ok, true, 'selection stays read-only and allowed');
  const publicPaths = bridge.match(/const PUBLIC_PATHS = new Set\(\[[\s\S]*?\]\);/)[0];
  assert.ok(/'\/api\/webhooks\/twilio\/voice-status'/.test(publicPaths));
  assert.ok(/'\/api\/webhooks\/twilio\/voice'/.test(publicPaths));
  // Purchase/commission approvals are admin-only under the existing restriction rule.
  const restriction = bridge.match(/^function getTeamApprovalRestriction\([\s\S]*?^\}/m)[0];
  const restrict = runInNewContext(`${restriction}\ngetTeamApprovalRestriction`, { toNumber: (v, d) => Number(v) || d, TEAM_APPROVAL_LIMIT: 50000, currency: String, getTeamPermissions: () => ({}) });
  assert.match(restrict({ type: 'phone_number_purchase', approvalAction: 'admin_phone_number_purchase' }, 'approved', base), /Admin approval required/);
  assert.match(restrict({ type: 'phone_number_commission', approvalAction: 'admin_voice_route' }, 'approved', base), /Admin approval required/);
  assert.equal(restrict({ type: 'dialer_call', approvalAction: 'twilio_click_to_call' }, 'approved', base), null);
  assert.match(restrict({ type: 'dialer_call', approvalAction: 'twilio_click_to_call' }, 'approved', { ...base, canApproveProviderActions: false }), /Admin approval required/);
});

test('twilio signature helper matches the documented algorithm', () => {
  // Reference value computed independently (Python hmac/sha1 over URL + sorted
  // key/value pairs, per Twilio's documented request-validation algorithm).
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  assert.equal(computeTwilioSignature('12345', url, params), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert.equal(verifyTwilioSignature({ authToken: '12345', url, params, signature: '0/KCTR6DLpKmkAf8muzZqo1nDgQ=' }), true);
  assert.equal(verifyTwilioSignature({ authToken: '12345', url, params: { ...params, Digits: '9' }, signature: '0/KCTR6DLpKmkAf8muzZqo1nDgQ=' }), false);
});

// ---------------------------------------------------------------------------
// Signed Twilio inbound Voice webhook
// ---------------------------------------------------------------------------
async function inbound(h, params, { sign = true } = {}) {
  const path = '/api/webhooks/twilio/voice';
  const signature = sign ? computeTwilioSignature(h.runtime.twilioAuthToken, `http://localhost${path}`, params) : '';
  return h.call('POST', path, undefined, { raw: new URLSearchParams(params).toString(), headers: signature ? { 'x-twilio-signature': signature } : {} });
}

test('inbound voice: a valid signed call to a commissioned line forwards to the configured destination', async () => {
  const h = harness();
  await commissionTwilioLine(h);
  const res = await inbound(h, { CallSid: 'CAinbound1', From: '+15555550142', To: '+15555550150', CallStatus: 'ringing' });
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/xml/);
  assert.match(res.body, /<Dial answerOnBridge="true" timeout="25"><Number>\+15555550198<\/Number><\/Dial>/);
  assert.equal(/8134|5307/.test(res.body), false, 'never forwards to the default or Ava line');
  assert.equal(h.state.activity.at(-1).status, 'forwarded');
  // Commissioning wrote exactly the PBK inbound route to the provider.
  const route = h.runtime.adapters._mock.owned.twilio.get('+15555550150').voiceRoute;
  assert.equal(route.voiceUrl, 'http://localhost/api/webhooks/twilio/voice');
});

test('inbound voice: unsigned and forged requests are rejected before routing', async () => {
  const h = harness();
  await commissionTwilioLine(h);
  const params = { CallSid: 'CAinbound2', From: '+15555550142', To: '+15555550150' };
  const unsigned = await inbound(h, params, { sign: false });
  assert.equal(unsigned.status, 403);
  assert.equal(unsigned.code, 'bad_signature');
  assert.equal(unsigned.body, undefined, 'no TwiML returned');
  const forged = await h.call('POST', '/api/webhooks/twilio/voice', undefined, { raw: new URLSearchParams(params).toString(), headers: { 'x-twilio-signature': computeTwilioSignature('wrong-token', 'http://localhost/api/webhooks/twilio/voice', params) } });
  assert.equal(forged.status, 403);
  const tampered = await h.call('POST', '/api/webhooks/twilio/voice', undefined, { raw: new URLSearchParams({ ...params, To: '+15555550151' }).toString(), headers: { 'x-twilio-signature': computeTwilioSignature(h.runtime.twilioAuthToken, 'http://localhost/api/webhooks/twilio/voice', params) } });
  assert.equal(tampered.status, 403);
  assert.equal((await h.call('GET', '/api/webhooks/twilio/voice')).status, 405);
});

test('inbound voice: missing routing configuration fails closed (no forward) and blocks commissioning', async () => {
  const h = harness();
  await commissionTwilioLine(h);
  // Same bridge state, destination removed from configuration after commissioning.
  const h2 = harness({ state: h.state, env: { PBK_TWILIO_INBOUND_DESTINATION: '' } });
  const res = await inbound(h2, { CallSid: 'CAinbound3', From: '+15555550142', To: '+15555550150' });
  assert.equal(res.status, 200);
  assert.equal(/<Dial/.test(res.body), false);
  assert.match(res.body, /<Hangup\/>/);
  assert.equal(h2.state.activity.at(-1).status, 'inbound_destination_unconfigured');
  // A fresh workspace without the destination cannot even request commissioning.
  const h3 = harness({ env: { PBK_TWILIO_INBOUND_DESTINATION: '' } });
  const imported = await h3.call('POST', '/api/phone-numbers/import', { provider: 'twilio', phoneNumber: '+15555550150' });
  const req = await h3.call('POST', `/api/phone-numbers/lines/${imported.line.id}/commission`);
  assert.equal(req.status, 409);
  assert.equal(req.code, 'inbound_destination_unconfigured');
  assert.equal(h3.state.approvals.length, 0, 'no approval queued for an unroutable line');
  // Calls to lines PBK has not commissioned are rejected.
  const unknown = await inbound(h, { CallSid: 'CAinbound4', From: '+15555550142', To: '+15555550111' });
  assert.match(unknown.body, /<Reject/);
});
