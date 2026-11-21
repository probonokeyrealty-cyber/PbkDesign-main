import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAdapters, createPhoneNumberService, createTelnyxAdapter, createTwilioAdapter, ProviderError, resolveVoiceRoute } from './phone-numbers.mjs';

const DEFAULT_LINE = '+15555558134';
const AVA_LINE = '+18885555307';
const TWILIO_OWNED = '+15555550150';

function setup({ faults = {}, env = {}, purchasesEnabled = false, clock } = {}) {
  let store = null;
  let writes = [];
  const adapters = createMockAdapters({
    faults,
    seedOwned: [
      { provider: 'telnyx', providerId: 'tx1', phoneNumber: DEFAULT_LINE, capabilities: { voice: true }, voiceRoute: { connectionId: 'c' } },
      { provider: 'twilio', providerId: 'PN1', phoneNumber: TWILIO_OWNED, capabilities: { voice: true }, voiceRoute: { voiceUrl: '' } },
    ],
  });
  const t = clock || { now: Date.parse('2026-11-21T12:00:00Z') };
  const service = createPhoneNumberService({
    adapters,
    readStore: () => store,
    writeStore: async (next) => { store = JSON.parse(JSON.stringify(next)); writes.push(JSON.parse(JSON.stringify(next))); },
    env: { PBK_PUBLIC_BASE_URL: 'https://bridge.example.test', PBK_TELNYX_CONNECTION_ID: 'conn-1', PBK_AVA_ELEVENLABS_PHONE_LINES: AVA_LINE, PBK_TWILIO_INBOUND_DESTINATION: '+15555550198', ...env },
    now: () => t.now,
    defaultCallerId: DEFAULT_LINE,
    purchasesEnabled,
  });
  return { service, adapters, writes: () => writes, clock: t };
}

const approved = (id) => ({ id, status: 'approved' });

test('inventory keeps the 8134 default caller ID and 5307 ElevenLabs line with SMS blocked', async () => {
  const { service } = setup();
  const { lines } = await service.inventory();
  const def = lines.find((l) => l.phoneNumber === DEFAULT_LINE);
  const ava = lines.find((l) => l.phoneNumber === AVA_LINE);
  assert.equal(def.roles.defaultCallerId, true);
  assert.equal(def.callerIdEnabled, true);
  assert.equal(def.commissioning.status, 'legacy_routed');
  assert.equal(ava.roles.avaVoiceEngine, 'elevenlabs');
  assert.equal(ava.type, 'toll_free');
  assert.equal(ava.sms.registrationStatus, 'pending_toll_free_verification');
  assert.equal(ava.sms.sendingAllowed, false);
  const lock = await service.setCallerIdEnabled({ lineId: def.id, enabled: false });
  assert.equal(lock.code, 'default_line_locked');
  const legacy = await service.requestCommission({ lineId: ava.id });
  assert.equal(legacy.code, 'legacy_line');
});

test('import accepts only numbers actually owned on the provider account', async () => {
  const { service } = setup();
  const notOwned = await service.importOwned({ provider: 'twilio', phoneNumber: '+15555550999' });
  assert.equal(notOwned.ok, false);
  assert.equal(notOwned.code, 'not_owned');
  const wrongProvider = await service.importOwned({ provider: 'telnyx', phoneNumber: TWILIO_OWNED });
  assert.equal(wrongProvider.code, 'not_owned');
  const ok = await service.importOwned({ provider: 'twilio', phoneNumber: '(555) 555-0150' });
  assert.equal(ok.ok, true);
  assert.equal(ok.line.commissioning.status, 'uncommissioned');
  assert.equal(ok.line.callerIdEnabled, false);
});

test('search returns local and toll-free inventory with prices', async () => {
  const { service } = setup();
  const local = await service.search({ provider: 'telnyx', type: 'local', areaCode: '555' });
  assert.ok(local.results.length > 0);
  assert.ok(local.results.every((r) => r.price.monthly > 0));
  const tf = await service.search({ provider: 'twilio', type: 'toll_free' });
  assert.ok(tf.results.every((r) => r.phoneNumber.startsWith('+1888')));
  assert.equal((await service.search({ provider: 'bandwidth', type: 'local' })).ok, false);
});

test('order confirmation requires the exact quoted number and price, unexpired', async () => {
  const { service, clock } = setup();
  const [pick] = (await service.search({ provider: 'telnyx', type: 'local' })).results;
  const { quote } = await service.quote({ provider: 'telnyx', phoneNumber: pick.phoneNumber });
  const base = { quoteId: quote.id, confirmPhoneNumber: quote.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront };
  assert.equal((await service.createOrder({ ...base, confirmMonthly: quote.price.monthly - 0.01 })).code, 'price_mismatch');
  assert.equal((await service.createOrder({ ...base, confirmUpfront: 0 })).code, 'price_mismatch');
  assert.equal((await service.createOrder({ ...base, confirmPhoneNumber: '+15555550000' })).code, 'confirmation_mismatch');
  clock.now += 11 * 60 * 1000;
  assert.equal((await service.createOrder(base)).code, 'quote_expired');
});

test('purchase is persisted before submit and never runs without an approved approval', async () => {
  const { service, adapters, writes } = setup();
  const [pick] = (await service.search({ provider: 'twilio', type: 'local' })).results;
  const { quote } = await service.quote({ provider: 'twilio', phoneNumber: pick.phoneNumber });
  const { order } = await service.createOrder({ quoteId: quote.id, confirmPhoneNumber: pick.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront });
  assert.equal(order.status, 'awaiting_approval');
  await service.attachApproval(order.id, 'appr-1');
  assert.equal((await service.executeOrder({ orderId: order.id, approval: { id: 'appr-1', status: 'pending' } })).code, 'approval_required');
  assert.equal((await service.executeOrder({ orderId: order.id, approval: approved('other') })).code, 'approval_required');
  assert.equal(adapters._mock.orders.size, 0, 'no provider order without approval');

  const before = writes().length;
  const done = await service.executeOrder({ orderId: order.id, approval: approved('appr-1') });
  assert.equal(done.ok, true);
  assert.equal(done.order.status, 'purchased');
  const submitted = writes().slice(before).find((s) => s.orders[0].status === 'submitting');
  assert.ok(submitted, 'order was persisted as submitting before the provider call');
  assert.equal(submitted.orders[0].phoneNumber, pick.phoneNumber);
  // Replays are idempotent.
  const replay = await service.executeOrder({ orderId: order.id, approval: approved('appr-1') });
  assert.equal(replay.replay, true);
  assert.equal(adapters._mock.orders.size, 1);
});

test('ambiguous purchase response is reconciled against inventory instead of re-buying', async () => {
  const { service, adapters } = setup({ faults: { ambiguousPurchase: 1 } });
  const [pick] = (await service.search({ provider: 'telnyx', type: 'toll_free' })).results;
  const { quote } = await service.quote({ provider: 'telnyx', phoneNumber: pick.phoneNumber });
  const { order } = await service.createOrder({ quoteId: quote.id, confirmPhoneNumber: pick.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront });
  await service.attachApproval(order.id, 'a');
  const result = await service.executeOrder({ orderId: order.id, approval: approved('a') });
  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'purchased');
  assert.equal(result.order.attempts.length, 1, 'single submit; ownership confirmed by reconciliation');
  assert.equal(result.order.attempts[0].result, 'ambiguous');
  assert.equal(adapters._mock.orders.size, 1);
});

test('unknown order with no ownership evidence retries with the same client reference', async () => {
  const { service, adapters } = setup();
  const [pick] = (await service.search({ provider: 'twilio', type: 'local' })).results;
  const { quote } = await service.quote({ provider: 'twilio', phoneNumber: pick.phoneNumber });
  const { order } = await service.createOrder({ quoteId: quote.id, confirmPhoneNumber: pick.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront });
  await service.attachApproval(order.id, 'a');
  const realPurchase = adapters.twilio.purchase;
  const refs = [];
  adapters.twilio.purchase = async (args) => { refs.push(args.clientRequestId); throw new ProviderError('timeout', { ambiguous: true }); };
  const first = await service.executeOrder({ orderId: order.id, approval: approved('a') });
  assert.equal(first.code, 'ambiguous_reconcile_required');
  assert.equal(first.order.status, 'unknown');
  adapters.twilio.purchase = async (args) => { refs.push(args.clientRequestId); return realPurchase(args); };
  const second = await service.executeOrder({ orderId: order.id, approval: approved('a') });
  assert.equal(second.order.status, 'purchased');
  assert.equal(new Set(refs).size, 1, 'retries reuse the persisted exact-number order reference');
});

test('live purchases stay disabled unless explicitly enabled', async () => {
  let store = null;
  const live = createMockAdapters();
  live.twilio.mock = false;
  const service = createPhoneNumberService({ adapters: live, readStore: () => store, writeStore: async (n) => { store = n; }, env: {}, purchasesEnabled: false });
  const [pick] = (await service.search({ provider: 'twilio', type: 'local' })).results;
  const { quote } = await service.quote({ provider: 'twilio', phoneNumber: pick.phoneNumber });
  const { order } = await service.createOrder({ quoteId: quote.id, confirmPhoneNumber: pick.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront });
  await service.attachApproval(order.id, 'a');
  assert.equal((await service.executeOrder({ orderId: order.id, approval: approved('a') })).code, 'purchases_disabled');
});

test('commissioning applies the approved route, validates readback, then gates caller ID', async () => {
  const { service } = setup();
  const { line } = await service.importOwned({ provider: 'twilio', phoneNumber: TWILIO_OWNED });
  assert.equal((await service.setCallerIdEnabled({ lineId: line.id, enabled: true })).code, 'not_commissioned');
  const { commission } = await service.requestCommission({ lineId: line.id });
  assert.equal(commission.route.voiceUrl, 'https://bridge.example.test/api/webhooks/twilio/voice');
  await service.attachCommissionApproval(commission.id, 'c1');
  assert.equal((await service.executeCommission({ commissionId: commission.id, approval: { id: 'c1', status: 'pending' } })).code, 'approval_required');
  const done = await service.executeCommission({ commissionId: commission.id, approval: approved('c1') });
  assert.equal(done.ok, true);
  assert.equal(done.line.commissioning.status, 'commissioned');
  assert.equal(done.line.sms.registrationStatus, 'not_registered', 'voice commissioning does not touch SMS status');
  const enabled = await service.setCallerIdEnabled({ lineId: line.id, enabled: true });
  assert.equal(enabled.line.callerIdEnabled, true);
  assert.equal(service.outboundLine(line.id).ok, true);
});

test('readback mismatch keeps the line disabled', async () => {
  const { service } = setup({ faults: { routeDrift: true } });
  const { line } = await service.importOwned({ provider: 'twilio', phoneNumber: TWILIO_OWNED });
  const { commission } = await service.requestCommission({ lineId: line.id });
  await service.attachCommissionApproval(commission.id, 'c1');
  const result = await service.executeCommission({ commissionId: commission.id, approval: approved('c1') });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'readback_mismatch');
  assert.equal((await service.setCallerIdEnabled({ lineId: line.id, enabled: true })).code, 'not_commissioned');
  assert.equal(service.outboundLine(line.id).ok, false);
});

test('provider adapters build the documented Twilio and Telnyx requests', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body, auth: init.headers?.Authorization });
    const u = String(url);
    const body = u.includes('pricing.twilio.com') ? { price_unit: 'USD', phone_number_prices: [{ number_type: 'local', current_price: '1.15' }] }
      : u.includes('AvailablePhoneNumbers') ? { available_phone_numbers: [{ phone_number: '+15555550123', capabilities: { voice: true } }] }
      : u.includes('/available_phone_numbers') ? { data: [{ phone_number: '+18885550111', features: [{ name: 'voice' }], cost_information: { upfront_cost: '1.00', monthly_cost: '1.50', currency: 'USD' } }] }
      : u.includes('/number_orders') ? { data: { id: 'ord1', status: 'pending' } }
      : { incoming_phone_numbers: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const twilio = createTwilioAdapter({ accountSid: 'ACtest', authToken: 'tok', fetchImpl });
  const [tw] = await twilio.searchAvailable({ type: 'local', areaCode: '555' });
  assert.equal(tw.price.monthly, 1.15);
  assert.ok(calls[0].url.includes('/Accounts/ACtest/AvailablePhoneNumbers/US/Local.json'));
  assert.ok(calls[0].url.includes('AreaCode=555'));
  const telnyx = createTelnyxAdapter({ apiKey: 'k', fetchImpl });
  const [tx] = await telnyx.searchAvailable({ type: 'toll_free' });
  assert.deepEqual(tx.price, { upfront: 1, monthly: 1.5, currency: 'USD' });
  assert.ok(calls.at(-1).url.includes('filter%5Bphone_number_type%5D=toll_free'));
  await telnyx.purchase({ phoneNumber: '+18885550111', clientRequestId: 'pbk-ref' });
  const order = calls.at(-1);
  assert.equal(order.method, 'POST');
  assert.ok(order.url.endsWith('/v2/number_orders'));
  assert.deepEqual(JSON.parse(order.body), { phone_numbers: [{ phone_number: '+18885550111' }], customer_reference: 'pbk-ref' });
  await assert.rejects(createTwilioAdapter({}).listOwned(), /not configured/);
});

// ---------------------------------------------------------------------------
// Fail-closed voice routing (live commissioning gap)
// ---------------------------------------------------------------------------
function spyApply(adapters) {
  const writes = [];
  for (const provider of ['twilio', 'telnyx']) {
    const real = adapters[provider].applyVoiceRoute;
    adapters[provider].applyVoiceRoute = async (...args) => { writes.push(provider); return real(...args); };
  }
  return writes;
}

test('commissioning fails closed with no provider write when the inbound destination is missing', async () => {
  const { service, adapters } = setup({ env: { PBK_TWILIO_INBOUND_DESTINATION: '' } });
  const writes = spyApply(adapters);
  const { line } = await service.importOwned({ provider: 'twilio', phoneNumber: TWILIO_OWNED });
  const result = await service.requestCommission({ lineId: line.id });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'inbound_destination_unconfigured');
  assert.equal(writes.length, 0);
});

test('destination is never inferred from or allowed to be the 8134 or 5307 lines', () => {
  const base = { PBK_PUBLIC_BASE_URL: 'https://bridge.example.test' };
  const protectedNumbers = [DEFAULT_LINE, AVA_LINE];
  assert.equal(resolveVoiceRoute('twilio', base, { protectedNumbers }).code, 'inbound_destination_unconfigured');
  for (const dest of [DEFAULT_LINE, AVA_LINE, '(555) 555-8134']) {
    assert.equal(resolveVoiceRoute('twilio', { ...base, PBK_TWILIO_INBOUND_DESTINATION: dest }, { protectedNumbers }).code, 'inbound_destination_loop');
  }
  assert.equal(resolveVoiceRoute('twilio', { ...base, PBK_TWILIO_INBOUND_DESTINATION: 'abc' }, { protectedNumbers }).code, 'inbound_destination_invalid');
});

test('voice URL selection fails closed for unsupported, insecure or unconfigured routes', () => {
  const dest = { PBK_TWILIO_INBOUND_DESTINATION: '+15555550198' };
  const base = 'https://bridge.example.test';
  const r = (env, opts = {}) => resolveVoiceRoute('twilio', { ...dest, ...env }, opts);
  assert.equal(r({}).code, 'public_base_unconfigured');
  assert.equal(r({ PBK_PUBLIC_BASE_URL: 'http://bridge.example.test' }).code, 'public_base_unconfigured');
  assert.equal(r({ PBK_PUBLIC_BASE_URL: base, PBK_TWILIO_VOICE_URL: `${base}/api/webhooks/telnyx` }).code, 'voice_url_unsupported');
  assert.equal(r({ PBK_PUBLIC_BASE_URL: base, PBK_TWILIO_VOICE_URL: `${base}/api/webhooks/twilio/voice-status` }).code, 'voice_url_unsupported');
  assert.equal(r({ PBK_PUBLIC_BASE_URL: base, PBK_TWILIO_VOICE_URL: `${base}/api/webhooks/twilio/voice?x=1` }).code, 'voice_url_unsupported');
  assert.equal(r({ PBK_TWILIO_VOICE_URL: 'http://voice.example.test/in' }).code, 'voice_url_insecure');
  assert.equal(r({ PBK_TWILIO_VOICE_URL: 'not a url' }).code, 'voice_url_invalid');
  const self = r({ PBK_PUBLIC_BASE_URL: base });
  assert.equal(self.ok, true);
  assert.equal(self.route.voiceUrl, `${base}/api/webhooks/twilio/voice`);
  const viaOverride = r({ PBK_PUBLIC_BASE_URL: base, PBK_TWILIO_VOICE_URL: `${base}/api/webhooks/twilio/voice` });
  assert.equal(viaOverride.ok, true);
  assert.equal(viaOverride.selfHosted, true);
  assert.equal(resolveVoiceRoute('twilio', { PBK_PUBLIC_BASE_URL: base, PBK_TWILIO_VOICE_URL: `${base}/api/webhooks/twilio/voice` }).code, 'inbound_destination_unconfigured', 'self-hosted override still needs a destination');
  const external = resolveVoiceRoute('twilio', { PBK_TWILIO_VOICE_URL: 'https://voice.example.test/pbk-inbound' });
  assert.equal(external.ok, true, 'explicit external HTTPS override is honored as configured');
  assert.equal(external.selfHosted, false);
  assert.equal(resolveVoiceRoute('telnyx', {}).code, 'route_not_configured');
});

test('a routing change after approval is caught before the provider write', async () => {
  const env = { PBK_PUBLIC_BASE_URL: 'https://bridge.example.test', PBK_TWILIO_INBOUND_DESTINATION: '+15555550198' };
  let store = null;
  const adapters = createMockAdapters({ seedOwned: [{ provider: 'twilio', providerId: 'PN1', phoneNumber: TWILIO_OWNED, voiceRoute: { voiceUrl: '' } }] });
  const service = createPhoneNumberService({ adapters, env, readStore: () => store, writeStore: async (n) => { store = n; } });
  const writes = spyApply(adapters);
  const { line } = await service.importOwned({ provider: 'twilio', phoneNumber: TWILIO_OWNED });
  const { commission } = await service.requestCommission({ lineId: line.id });
  await service.attachCommissionApproval(commission.id, 'c1');
  env.PBK_TWILIO_INBOUND_DESTINATION = '+15555550197'; // reconfigured after approval
  const changed = await service.executeCommission({ commissionId: commission.id, approval: approved('c1') });
  assert.equal(changed.code, 'route_changed');
  env.PBK_TWILIO_INBOUND_DESTINATION = ''; // removed after approval
  assert.equal((await service.executeCommission({ commissionId: commission.id, approval: approved('c1') })).code, 'inbound_destination_unconfigured');
  env.PBK_PUBLIC_BASE_URL = 'https://bridge.example.test';
  env.PBK_TWILIO_VOICE_URL = 'https://bridge.example.test/api/admin/anything';
  env.PBK_TWILIO_INBOUND_DESTINATION = '+15555550198';
  assert.equal((await service.executeCommission({ commissionId: commission.id, approval: approved('c1') })).code, 'voice_url_unsupported');
  assert.equal(writes.length, 0, 'no provider write on any fail-closed path');
  delete env.PBK_TWILIO_VOICE_URL;
  const ok = await service.executeCommission({ commissionId: commission.id, approval: approved('c1') });
  assert.equal(ok.ok, true);
  assert.equal(writes.length, 1);
});
