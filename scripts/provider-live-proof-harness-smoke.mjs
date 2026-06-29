import assert from 'node:assert/strict';

import {
  assertLiveProofCanSend,
  assertLiveProofSafe,
  getProviderLiveProofRequirements,
  getProviderProofRequirements,
  runProviderLiveProof,
} from './provider-live-proof-harness.mjs';

assert.deepEqual(getProviderProofRequirements('sms'), [
  'PBK_LIVE_PROOF_SMS_TO',
  'PBK_TELNYX_FROM_NUMBER',
]);

const missingSms = assertLiveProofSafe({
  provider: 'sms',
  env: {},
});

assert.equal(missingSms.ok, false);
assert.deepEqual(missingSms.missing, [
  'PBK_LIVE_PROOF_SMS_TO',
  'PBK_TELNYX_FROM_NUMBER',
]);
assert.equal(missingSms.proofStatus, 'missing_env');

const dryRun = await runProviderLiveProof({
  provider: 'sms',
  dryRun: true,
  env: {
    PBK_LIVE_PROOF_SMS_TO: '+15555550101',
    PBK_TELNYX_FROM_NUMBER: '+15555550102',
  },
});

assert.equal(dryRun.ok, true);
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.proofStatus, 'dry_run_ready');
assert.deepEqual(dryRun.missing, []);

assert(
  getProviderLiveProofRequirements('sms').includes('PBK_BRIDGE_API_KEY'),
  'Non-dry-run proof should require the authenticated bridge key.'
);
assert(
  getProviderLiveProofRequirements('sms').includes('PBK_LIVE_PROOF_CONFIRM'),
  'Non-dry-run proof should require an explicit send confirmation.'
);

const missingConfirmation = assertLiveProofCanSend({
  provider: 'sms',
  env: {
    PBK_LIVE_PROOF_SMS_TO: '+15555550101',
    PBK_TELNYX_FROM_NUMBER: '+15555550102',
  },
});
assert.equal(missingConfirmation.ok, false);
assert.equal(missingConfirmation.proofStatus, 'confirmation_required');
assert.deepEqual(missingConfirmation.missing, [
  'PBK_BRIDGE_API_KEY',
  'PBK_LIVE_PROOF_CONFIRM=send',
]);

const bridgeCalls = [];
const mockFetch = async (url, init = {}) => {
  bridgeCalls.push({
    url: String(url),
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null,
    authorization: init.headers?.Authorization || '',
  });
  const body = bridgeCalls.length === 1
    ? {
        ok: true,
        result: 'live',
        outbox: {
          idempotencyKey: 'pbk-live-proof-sms-20260629010101',
          status: 'sent',
        },
      }
    : { ok: true, result: 'live' };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const liveSms = await runProviderLiveProof({
  provider: 'sms',
  dryRun: false,
  now: new Date('2026-06-29T01:01:01.000Z'),
  fetchImpl: mockFetch,
  env: {
    PBK_LIVE_PROOF_SMS_TO: '+15555550101',
    PBK_TELNYX_FROM_NUMBER: '+15555550102',
    PBK_BRIDGE_API_KEY: 'bridge-secret',
    PBK_LIVE_PROOF_CONFIRM: 'send',
    PBK_LIVE_PROOF_BRIDGE_URL: 'https://bridge.example.test/',
  },
});

assert.equal(liveSms.ok, true);
assert.equal(liveSms.dryRun, false);
assert.equal(liveSms.proofStatus, 'sent_waiting_for_receipt');
assert.equal(bridgeCalls.length, 1);
assert.equal(bridgeCalls[0].url, 'https://bridge.example.test/api/messages');
assert.equal(bridgeCalls[0].authorization, 'Bearer bridge-secret');
assert.equal(bridgeCalls[0].body.channel, 'sms');
assert.equal(bridgeCalls[0].body.phone, '+15555550101');
assert.equal(bridgeCalls[0].body.source, 'provider_live_proof');
assert.equal(bridgeCalls[0].body.manual, true);
assert.equal(bridgeCalls[0].body.manualSend, true);

const slackCalls = [];
const mockSlackFetch = async (url, init = {}) => {
  slackCalls.push({
    url: String(url),
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null,
  });
  let body = { ok: true };
  if (String(url).endsWith('/api/approvals')) {
    body = {
      ok: true,
      approval: {
        id: 'pbk-live-proof-slack-20260629010101',
        slackMessage: { channel: 'C123', ts: '123.456' },
      },
    };
  } else if (String(url).includes('/api/approvals?')) {
    body = { ok: true, approvals: [] };
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const liveSlack = await runProviderLiveProof({
  provider: 'slack',
  dryRun: false,
  now: new Date('2026-06-29T01:01:01.000Z'),
  fetchImpl: mockSlackFetch,
  env: {
    PBK_SLACK_APPROVAL_CHANNEL_ID: 'C123',
    PBK_BRIDGE_API_KEY: 'bridge-secret',
    PBK_LIVE_PROOF_CONFIRM: 'send',
    PBK_LIVE_PROOF_BRIDGE_URL: 'https://bridge.example.test',
  },
});

assert.equal(liveSlack.ok, true);
assert.equal(liveSlack.posted, true);
assert.equal(liveSlack.clearedFromPending, true);
assert.equal(slackCalls.length, 3);
assert.equal(slackCalls[0].url, 'https://bridge.example.test/api/approvals');
assert.equal(slackCalls[1].url, 'https://bridge.example.test/api/approvals/pbk-live-proof-slack-20260629010101/approve');
assert.equal(slackCalls[2].url, 'https://bridge.example.test/api/approvals?status=pending&limit=200');

const unknownProvider = await runProviderLiveProof({
  provider: 'typo',
  dryRun: true,
  env: {},
});

assert.equal(unknownProvider.ok, false);
assert.equal(unknownProvider.proofStatus, 'unknown_provider');

console.log('provider live proof harness smoke passed');
