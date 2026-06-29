import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const bridgeSource = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
assert(
  bridgeSource.includes('function findManualProviderDeliveryRecord'),
  'Manual provider proof should recover live delivery from durable message receipts.'
);
assert(
  bridgeSource.includes('durableDeliveryRecord'),
  'Manual provider proof should expose the durable delivery receipt used for classification.'
);

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

const docusignCalls = [];
const mockDocuSignFetch = async (url, init = {}) => {
  docusignCalls.push({
    url: String(url),
    method: init.method,
    body: init.body ? JSON.parse(init.body) : null,
  });
  let body = { ok: true };
  let status = 200;
  if (String(url).endsWith('/api/contracts') && init.method === 'POST') {
    status = 202;
    body = {
      ok: true,
      result: 'docusign_queued',
      accepted: true,
      queued: true,
      jobId: 'pbk-live-proof-docusign-20260629010101',
      contract: {
        id: 'contract-pbk-live-proof-docusign-20260629010101',
        idempotencyKey: 'pbk-live-proof-docusign-20260629010101',
        status: 'pending-provider',
        envelopeId: '',
        docusignJobId: 'pbk-live-proof-docusign-20260629010101',
      },
    };
  } else if (String(url).endsWith('/api/contracts/contract-pbk-live-proof-docusign-20260629010101')) {
    body = {
      ok: true,
      contract: {
        id: 'contract-pbk-live-proof-docusign-20260629010101',
        idempotencyKey: 'pbk-live-proof-docusign-20260629010101',
        status: 'sent',
        envelopeId: '00000000-0000-4000-9000-000000000001',
        docusignAsync: true,
        docusignJobId: 'pbk-live-proof-docusign-20260629010101',
        providerProofCompletedAt: '2026-06-29T01:01:02.000Z',
        docusignJob: {
          status: 'completed',
          envelopeId: '00000000-0000-4000-9000-000000000001',
        },
      },
    };
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const liveDocuSign = await runProviderLiveProof({
  provider: 'docusign',
  dryRun: false,
  now: new Date('2026-06-29T01:01:01.000Z'),
  fetchImpl: mockDocuSignFetch,
  env: {
    PBK_LIVE_PROOF_EMAIL_TO: 'canary@example.test',
    PBK_DOCUSIGN_ACCOUNT_ID: 'account-id',
    PBK_BRIDGE_API_KEY: 'bridge-secret',
    PBK_LIVE_PROOF_CONFIRM: 'send',
    PBK_LIVE_PROOF_DOCUSIGN_SEND: 'true',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_MS: '1000',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_INTERVAL_MS: '1',
    PBK_LIVE_PROOF_BRIDGE_URL: 'https://bridge.example.test',
  },
});

assert.equal(liveDocuSign.ok, true);
assert.equal(liveDocuSign.queued, true);
assert.equal(liveDocuSign.proofStatus, 'provider_confirmed');
assert.equal(liveDocuSign.providerAttemptId, '00000000-0000-4000-9000-000000000001');
assert.equal(docusignCalls.length, 2);
assert.equal(docusignCalls[0].url, 'https://bridge.example.test/api/contracts');
assert.equal(docusignCalls[0].body.id, 'contract-pbk-live-proof-docusign-20260629010101');
assert.equal(docusignCalls[1].url, 'https://bridge.example.test/api/contracts/contract-pbk-live-proof-docusign-20260629010101');

const staleDocuSign = await runProviderLiveProof({
  provider: 'docusign',
  dryRun: false,
  now: new Date('2026-06-29T01:01:01.000Z'),
  fetchImpl: async (url, init = {}) => {
    if (String(url).endsWith('/api/contracts') && init.method === 'POST') {
      return new Response(
        JSON.stringify({
          ok: true,
          result: 'docusign_queued',
          accepted: true,
          queued: true,
          contract: {
            id: 'contract-pbk-live-proof-docusign-20260629010101',
            idempotencyKey: 'pbk-live-proof-docusign-20260629010101',
          },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        contract: {
          id: 'contract-pbk-live-proof-docusign-20260629010101',
          idempotencyKey: 'pbk-live-proof-docusign-OLD',
          status: 'sent',
          envelopeId: '00000000-0000-4000-9000-000000000001',
          docusignAsync: true,
          docusignJob: { status: 'completed' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  },
  env: {
    PBK_LIVE_PROOF_EMAIL_TO: 'canary@example.test',
    PBK_DOCUSIGN_ACCOUNT_ID: 'account-id',
    PBK_BRIDGE_API_KEY: 'bridge-secret',
    PBK_LIVE_PROOF_CONFIRM: 'send',
    PBK_LIVE_PROOF_DOCUSIGN_SEND: 'true',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_MS: '1000',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_INTERVAL_MS: '1',
    PBK_LIVE_PROOF_BRIDGE_URL: 'https://bridge.example.test',
  },
});
assert.equal(staleDocuSign.ok, false);
assert.equal(staleDocuSign.proofStatus, 'stale_contract_receipt');

const queuedButHttpFailedDocuSign = await runProviderLiveProof({
  provider: 'docusign',
  dryRun: false,
  now: new Date('2026-06-29T01:01:01.000Z'),
  fetchImpl: async (url, init = {}) => {
    if (String(url).endsWith('/api/contracts') && init.method === 'POST') {
      return new Response(
        JSON.stringify({
          ok: false,
          result: 'docusign_queued',
          accepted: true,
          queued: true,
          contract: {
            id: 'contract-pbk-live-proof-docusign-20260629010101',
            idempotencyKey: 'pbk-live-proof-docusign-20260629010101',
          },
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        contract: {
          id: 'contract-pbk-live-proof-docusign-20260629010101',
          idempotencyKey: 'pbk-live-proof-docusign-20260629010101',
          status: 'provider-error',
          envelopeId: '',
          providerError: 'DocuSign JWT auth failed: issuer_not_found',
          docusignAsync: true,
          docusignJob: { status: 'failed', error: 'DocuSign JWT auth failed: issuer_not_found' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  },
  env: {
    PBK_LIVE_PROOF_EMAIL_TO: 'canary@example.test',
    PBK_DOCUSIGN_ACCOUNT_ID: 'account-id',
    PBK_BRIDGE_API_KEY: 'bridge-secret',
    PBK_LIVE_PROOF_CONFIRM: 'send',
    PBK_LIVE_PROOF_DOCUSIGN_SEND: 'true',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_MS: '1000',
    PBK_LIVE_PROOF_DOCUSIGN_POLL_INTERVAL_MS: '1',
    PBK_LIVE_PROOF_BRIDGE_URL: 'https://bridge.example.test',
  },
});
assert.equal(queuedButHttpFailedDocuSign.ok, false);
assert.equal(queuedButHttpFailedDocuSign.queued, true);
assert.equal(queuedButHttpFailedDocuSign.proofStatus, 'provider_error');
assert.match(queuedButHttpFailedDocuSign.error, /issuer_not_found/);
assert.equal(queuedButHttpFailedDocuSign.initialBridgeResult.status, 502);

const unknownProvider = await runProviderLiveProof({
  provider: 'typo',
  dryRun: true,
  env: {},
});

assert.equal(unknownProvider.ok, false);
assert.equal(unknownProvider.proofStatus, 'unknown_provider');

console.log('provider live proof harness smoke passed');
