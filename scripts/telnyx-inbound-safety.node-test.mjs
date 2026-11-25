import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { normalizeConversationPhone } from './conversation-identity.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function functionSource(name, optional = false) {
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  if (optional && !node) return '';
  assert.ok(node, `Missing bridge function: ${name}`);
  return node.getText(ast);
}

const sampleCall = 'v3:sample-inbound';
const sampleLead = {
  found: true, leadId: 'sample-lead', leadName: 'Sample Caller', address: 'Sample property',
  status: 'callback_requested', motivationScore: 3,
};
const inbound = { call_control_id: sampleCall, from: '+12025550101', to: '+12025550102' };

function fixture({ recordingEnabled = false, human = '', underwriting = '', transferOk = true,
  transferSkipped = false, streamOk = true, lead = sampleLead } = {}) {
  const dispatches = [];
  const spoken = [];
  const streams = [];
  const notifications = [];
  const traces = [];
  const tasks = [];
  const state = { calls: [], inboundCallRoutes: [], leads: [structuredClone(lead)],
    drafts: { analyzer: { notes: 'Original sample draft', comps: [{ id: 'sample-comp' }] } } };
  const preserved = JSON.stringify({ leads: state.leads, drafts: state.drafts });
  const context = vm.createContext({
    state, console: { log() {} }, Date,
    // No host process, provider SDK, filesystem, timers or real network is available in this context.
    process: { env: {} }, fetch: () => { throw Error('Unexpected network access'); },
    PBK_TELNYX_RECORD_INBOUND_CALLS: recordingEnabled,
    HUMAN_AGENT_PHONE: human, UNDERWRITING_AGENT_PHONE: underwriting,
    INBOUND_QUALIFY_BEFORE_TRANSFER: false, INBOUND_AFTER_HOURS_VOICEMAIL_ENABLED: false,
    INBOUND_TIMEZONE: 'America/Los_Angeles', PBK_AVA_INBOUND_CALL_CONTROL_GREETING_ENABLED: false,
    DEEPGRAM_STREAM_TRACK: 'inbound_track', DEEPGRAM_STREAM_CODEC: 'PCMU',
    SLACK_UPDATES_CHANNEL_ID: '', SLACK_APPROVAL_CHANNEL_ID: '',
    normalizeConversationPhone,
    fireTelnyxRequest: async (method, endpoint, payload) => {
      dispatches.push({ method, endpoint, payload });
      return endpoint.endsWith('/transfer')
        ? { ok: transferOk, skipped: transferSkipped, error: transferOk ? '' : 'Sample provider rejection' }
        : { ok: true };
    },
    recordCallTrace: (event, data) => traces.push({ event, ...data }), recordToolUse() {},
    parseTelnyxCallPayload: body => ({ callControlId: body.call_control_id, from: body.from,
      to: body.to, direction: 'inbound', eventType: 'call.initiated' }),
    clearInboundLeadContextCaches: async () => {}, withTimeout: async value => value,
    findInboundLeadContext: async () => structuredClone(lead),
    ensureInboundLeadProfileContext: async value => value,
    getSpokenLeadName: value => value, maskPhoneForDiagnostics: () => '***0101',
    isInboundAfterHours: () => false,
    buildAvaInboundPromptContext: ({ route }) => `Sample prompt: ${route}`,
    slugify: value => value, randomUUID: () => 'sample-id', isoNow: () => '2026-11-25T20:30:00Z',
    createCallRecord: value => ({ ...value }), upsertCall: (target, call) => {
      const index = target.calls.findIndex(item => item.id === call.id);
      if (index < 0) target.calls.push({ ...call });
      else target.calls[index] = { ...target.calls[index], ...call };
    },
    answerTelnyxCall: async () => ({ ok: true }),
    speakTelnyxCall: async (id, text) => { spoken.push({ id, text }); return { ok: true }; },
    speakAvaPhoneReplyByCallId: async (id, text) => { spoken.push({ id, text }); return { ok: true }; },
    startTelnyxMediaStream: async (id, details) => {
      streams.push({ id, ...details }); return { ok: streamOk };
    },
    startTelnyxAiAssistant: async () => ({ ok: true, skipped: true }),
    persistInboundCallRoute: async () => {}, addActivity() {}, makeActivity: value => value,
    addAdminAudit() {}, persistState: async () => {}, projectLiveConversationRecord: async () => {},
    projectCallEvent() {},
    toolHandlers: { slackNotify: async value => { notifications.push(value); return { ok: true }; } },
    findLeadContext: () => structuredClone(lead), normalizeAgentName: value => value,
    recordAgentHandoffTask: async value => { tasks.push(value); return value; },
  });
  for (const name of ['normalizePhone', 'normalizeTelnyxTransferTarget', 'transferTelnyxCall', 'recordTelnyxCall', 'maybeRecordInboundTelnyxCall',
    'handleAvaInboundRoute', 'requestHumanHandoffRecord']) {
    vm.runInContext(functionSource(name, ['recordTelnyxCall', 'normalizeTelnyxTransferTarget'].includes(name)), context);
  }
  return { context, dispatches, spoken, streams, notifications, traces, tasks, state,
    assertPreserved() { assert.equal(JSON.stringify({ leads: state.leads, drafts: state.drafts }), preserved); } };
}

test('automatic inbound recording defaults off, including unknown flag values', () => {
  const declaration = ast.statements.find(item => ts.isVariableStatement(item)
    && item.declarationList.declarations.some(value => value.name.getText(ast) === 'PBK_TELNYX_RECORD_INBOUND_CALLS'));
  assert.ok(declaration);
  for (const value of [undefined, '', 'false', '0', 'garbage']) {
    const ctx = vm.createContext({ process: { env: { PBK_TELNYX_RECORD_INBOUND_CALLS: value } } });
    vm.runInContext(`${declaration.getText(ast)}; globalThis.enabled = PBK_TELNYX_RECORD_INBOUND_CALLS;`, ctx);
    assert.equal(ctx.enabled, false, `Unexpected recording enablement: ${value}`);
  }
});

test('an environment opt-in and forged consent fields cannot start a recording', async () => {
  const f = fixture({ recordingEnabled: true });
  const result = await f.context.maybeRecordInboundTelnyxCall(sampleCall, {
    consent: true, recordingConsent: { granted: true, callId: sampleCall }, approvalId: 'sample-approved',
  });
  assert.equal(f.dispatches.length, 0);
  assert.equal(result.result, 'recording_consent_required');
  assert.equal(result.skipped, true);
  assert.equal(result.ok, false);
  f.assertPreserved();
});

test('disabled recording is an explicit non-dispatching skip', async () => {
  const f = fixture();
  const result = await f.context.maybeRecordInboundTelnyxCall(sampleCall);
  assert.equal(result.result, 'recording_disabled');
  assert.equal(result.skipped, true);
  assert.equal(f.dispatches.length, 0);
});

for (const route of ['transfer_jordan', 'transfer_underwriting']) {
  test(`${route} without a valid destination keeps Ava and never promises a transfer`, async () => {
    const lead = { ...sampleLead, motivationScore: 9,
      status: route === 'transfer_underwriting' ? 'contract_sent' : 'callback_requested' };
    const f = fixture({ recordingEnabled: true, human: 'invalid', underwriting: 'invalid', lead });
    const result = await f.context.handleAvaInboundRoute({ ...inbound, recordingConsent: true });
    assert.equal(result.route, 'ava_qualify');
    assert.equal(result.call.status, 'live');
    assert.equal(result.result, 'live');
    assert.equal(f.dispatches.length, 0);
    assert.equal(f.streams.length, 1);
    assert.match(f.spoken.map(item => item.text).join(' '), /can't connect/i);
    assert.doesNotMatch(f.spoken.map(item => item.text).join(' '), /connecting you|please hold|bring in my manager/i);
    assert.doesNotMatch(JSON.stringify(f.notifications), /Inbound call routed to/);
    assert.equal(f.state.inboundCallRoutes[0].route, 'ava_qualify');
    assert.equal(f.state.calls.length, 1);
    assert.equal(f.state.calls[0].status, 'live');
    f.assertPreserved();
  });
}

test('a rejected transfer resumes Ava without marking a successful handoff', async () => {
  const f = fixture({ human: '+12025550103', transferOk: false,
    lead: { ...sampleLead, motivationScore: 9 } });
  const result = await f.context.handleAvaInboundRoute(inbound);
  assert.equal(result.route, 'ava_qualify');
  assert.equal(result.call.status, 'live');
  assert.equal(f.streams.length, 1);
  assert.equal(f.dispatches.filter(item => item.endpoint.endsWith('/transfer')).length, 1);
  assert.doesNotMatch(f.spoken.map(item => item.text).join(' '), /connecting you|please hold/i);
  assert.doesNotMatch(JSON.stringify(f.notifications), /Inbound call routed to/);
  f.assertPreserved();
});

test('a skipped transfer is not accepted even when the provider wrapper reports ok', async () => {
  const f = fixture({ human: '+12025550103', transferSkipped: true,
    lead: { ...sampleLead, motivationScore: 9 } });
  const result = await f.context.handleAvaInboundRoute(inbound);
  assert.equal(result.route, 'ava_qualify');
  assert.equal(result.call.status, 'live');
});

test('an accepted configured transfer dispatches once and does not start a second AI path', async () => {
  const f = fixture({ human: '+12025550103', lead: { ...sampleLead, motivationScore: 9 } });
  const result = await f.context.handleAvaInboundRoute(inbound);
  assert.equal(result.route, 'transfer_jordan');
  assert.equal(result.call.status, 'transferring');
  assert.equal(f.dispatches.length, 1);
  assert.equal(f.dispatches[0].payload.to, '+12025550103');
  assert.equal(f.streams.length, 0);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].status, 'transferring');
  f.assertPreserved();
});

test('failed fallback media is not promoted to a live route just because answer succeeded', async () => {
  const f = fixture({ streamOk: false, lead: { ...sampleLead, motivationScore: 9 } });
  const result = await f.context.handleAvaInboundRoute(inbound);
  assert.equal(result.route, 'ava_qualify');
  assert.equal(result.result, 'provider_missing');
});

test('after hours cannot advertise a recorded voicemail without a consent flow', async () => {
  const f = fixture({ recordingEnabled: true });
  const result = await f.context.handleAvaInboundRoute(inbound, { forceAfterHours: true });
  assert.equal(result.route, 'ava_qualify');
  assert.equal(result.call.status, 'live');
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.streams.length, 1);
  assert.doesNotMatch(f.spoken.map(item => item.text).join(' '), /leave.*(name|number|message)|call you back/i);
  assert.doesNotMatch(JSON.stringify(f.notifications), /voicemail flow started/i);
  f.assertPreserved();
});

for (const failure of ['missing', 'rejected', 'skipped', 'not-requested']) {
  test(`human-handoff ${failure} returns truthful caller copy`, async () => {
    const f = fixture({ human: failure === 'missing' ? '' : '+12025550103',
      transferOk: failure !== 'rejected', transferSkipped: failure === 'skipped' });
    const result = await f.context.requestHumanHandoffRecord({ callControlId: sampleCall,
      transfer: failure !== 'not-requested' });
    assert.equal(result.result, 'handoff_queued');
    assert.doesNotMatch(result.phrase, /bring in my manager|connecting you|one moment/i);
    assert.doesNotMatch(f.spoken.map(item => item.text).join(' '), /bring in my manager|connecting you|one moment/i);
    f.assertPreserved();
  });
}

test('an accepted human handoff is described as requested, not completed', async () => {
  const f = fixture({ human: '+12025550103' });
  const result = await f.context.requestHumanHandoffRecord({ callControlId: sampleCall });
  assert.equal(result.result, 'live_transfer');
  assert.match(result.phrase, /requested/i);
  assert.equal(f.dispatches.length, 1);
  f.assertPreserved();
});

test('a normal inbound call ignores fabricated recording consent and preserves exact sample lead context', async () => {
  const f = fixture({ recordingEnabled: true });
  const result = await f.context.handleAvaInboundRoute({ ...inbound,
    recordingConsent: { granted: true, callId: sampleCall }, recordingConsentVerified: true });
  assert.equal(result.call.leadId, sampleLead.leadId);
  assert.equal(result.call.id, sampleCall);
  assert.equal(f.dispatches.length, 0);
  assert.equal(result.actions.find(item => item.action === 'record').result.result, 'recording_consent_required');
  assert.equal(f.streams.length, 1);
  f.assertPreserved();
});

test('malformed numeric destinations fail closed in routing and the shared transfer dispatcher', async () => {
  for (const target of ['123', '+00000000000', '+1234567890123456']) {
    const f = fixture({ human: target, lead: { ...sampleLead, motivationScore: 9 } });
    const result = await f.context.handleAvaInboundRoute(inbound);
    assert.equal(result.route, 'ava_qualify', target);
    const transfer = await f.context.transferTelnyxCall(sampleCall, target);
    assert.equal(transfer.ok, false, target);
    assert.equal(f.dispatches.length, 0, target);
  }
});
