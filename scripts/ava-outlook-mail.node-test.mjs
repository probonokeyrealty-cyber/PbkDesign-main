import assert from 'node:assert/strict';
import test from 'node:test';
import { sendAvaOutlookMail } from './ava-outlook-mail.mjs';

const sender = 'acquisition@example.com';
const recipient = 'internal-test@example.net';
const env = {
  PBK_AVA_OUTLOOK_ACCOUNT_ID: 'ca_test_account',
  PBK_AVA_OUTLOOK_USER_ID: 'test-user',
  PBK_AVA_OUTLOOK_SENDER: sender,
  PBK_AVA_OUTLOOK_TEST_RECIPIENT: recipient,
  PBK_AVA_OUTLOOK_COMPOSIO_API_KEY: 'test-only',
};
const options = { env, sender, recipient, subject: 'Ava internal verification', text: 'Test message' };

test('uses the pinned mailbox and sends plain text to exactly one authorized recipient', async () => {
  const calls = [];
  const result = await sendAvaOutlookMail({
    ...options,
    fetchImpl: async (url, request) => {
      calls.push({ url, ...JSON.parse(request.body) });
      return Response.json(calls.length === 1
        ? { successful: true, data: { mail: sender } }
        : { successful: true, data: {}, log_id: 'test-log' });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'accepted');
  assert.deepEqual(calls.map((call) => call.url.split('/').at(-1)), ['OUTLOOK_GET_PROFILE', 'OUTLOOK_SEND_EMAIL']);
  assert.ok(calls.every((call) => call.connected_account_id === env.PBK_AVA_OUTLOOK_ACCOUNT_ID &&
    call.user_id === env.PBK_AVA_OUTLOOK_USER_ID));
  assert.deepEqual(calls[1].arguments, {
    to: recipient, subject: options.subject, body: options.text, is_html: false, user_id: 'me', save_to_sent_items: true,
  });
});

test('blocks a recipient mismatch before opening a provider connection', async () => {
  const result = await sendAvaOutlookMail({
    ...options, recipient: `${recipient}, external@example.com`,
    fetchImpl: () => assert.fail('No provider request should run'),
  });
  assert.equal(result.ok, false);
});

test('lead email mode uses the approved recipient and preserves the acceptance receipt', async () => {
  const leadEmail = 'seller@example.net';
  const calls = [];
  const result = await sendAvaOutlookMail({
    ...options,
    env: { ...env, PBK_AVA_OUTLOOK_LEAD_EMAIL_ENABLED: '1' },
    recipient: leadEmail,
    fetchImpl: async (_url, request) => {
      calls.push(JSON.parse(request.body).arguments);
      return Response.json(calls.length === 1
        ? { successful: true, data: { mail: sender } }
        : { successful: true, log_id: 'accepted-outlook-receipt' });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].to, leadEmail);
  assert.equal(result.deliveryStatus, 'accepted');
  assert.equal(result.providerRequestId, 'accepted-outlook-receipt');
});

test('does not send if the authenticated Outlook mailbox is different', async () => {
  let requests = 0;
  const result = await sendAvaOutlookMail({
    ...options,
    fetchImpl: async () => {
      requests++;
      return Response.json({ successful: true, data: { mail: 'info@example.com' } });
    },
  });
  assert.equal(result.ok, false);
  assert.equal(requests, 1);
});

test('a lost send acknowledgement surfaces to the approval lease for reconciliation', async () => {
  let requests = 0;
  await assert.rejects(sendAvaOutlookMail({
    ...options,
    fetchImpl: async () => {
      if (++requests === 1) return Response.json({ successful: true, data: { mail: sender } });
      throw new Error('network disconnected after dispatch');
    },
  }), /Outlook send outcome is unknown/);
  assert.equal(requests, 2);
});
