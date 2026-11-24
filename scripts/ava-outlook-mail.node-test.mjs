import assert from 'node:assert/strict';
import test from 'node:test';
import { sendAvaOutlookMail } from './ava-outlook-mail.mjs';
import * as outlook from './ava-outlook-mail.mjs';

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

test('finds a unique inbox receipt and refuses to guess between duplicate matches', async () => {
  const lookupEnv = {
    ...env, PBK_AVA_RECEIPT_GMAIL_ACCOUNT_ID: 'receipt-account',
    PBK_AVA_RECEIPT_GMAIL_USER_ID: 'receipt-user', PBK_AVA_RECEIPT_GMAIL_ADDRESS: 'pbk@gmail.com',
  };
  const recipient = 'pbk+qa@gmail.com';
  const exact = {
    messageId: '1234567890abcdef', threadId: '1234567890abcdef', labelIds: ['INBOX'],
    messageTimestamp: '2026-11-20T22:54:00Z', sender: `Ava <${sender}>`, to: recipient,
    subject: options.subject, messageText: options.text,
  };
  const wrong = { ...exact, messageId: '234567890abcdef1', messageText: 'Same subject, different message' };
  const earlier = { ...exact, messageId: '34567890abcdef12', messageTimestamp: '2026-11-19T22:54:00Z' };
  async function lookup(messages, mail = 'pbk@gmail.com', to = recipient, nextPageToken = null) {
    return outlook.findAvaOutlookReceipt({
      ...options, env: lookupEnv, recipient: to, sentAt: '2026-11-20T22:53:55Z',
      fetchImpl: async (url, request) => {
        const { connected_account_id, arguments: args } = JSON.parse(request.body);
        assert.equal(connected_account_id, 'receipt-account');
        if (url.endsWith('/GMAIL_GET_PROFILE')) return Response.json({ successful: true, data: { emailAddress: mail } });
        assert.ok(url.endsWith('/GMAIL_FETCH_EMAILS'));
        assert.ok(args.query.includes('to:pbk+qa@gmail.com'));
        return Response.json({ successful: true, data: { messages, nextPageToken } });
      },
    });
  }
  const match = await lookup([wrong, earlier, exact]);
  assert.equal(match.receiptUrl, 'https://mail.google.com/mail/u/?authuser=pbk%40gmail.com#all/1234567890abcdef');
  assert.equal((await lookup([wrong, earlier])).status, 404);
  assert.equal((await lookup([exact, { ...exact, messageId: '4567890abcdef123' }])).status, 409);
  assert.equal((await lookup([exact], 'pbk@gmail.com', recipient, 'more')).status, 409);
  assert.equal((await lookup([exact], 'other@gmail.com')).status, 503);
  assert.equal((await lookup([exact], 'pbk@gmail.com', 'other@gmail.com')).status, 422);
});

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

test('attaches the PDF before submitting an Outlook draft', async () => {
  const calls = [];
  const content = Buffer.from('%PDF-1.7\nTest document').toString('base64');
  const fetchImpl = async (url, request) => {
    const tool = url.split('/').at(-1);
    const { arguments: args } = JSON.parse(request.body);
    calls.push(tool);
    switch (tool) {
      case 'OUTLOOK_GET_PROFILE': return Response.json({ successful: true, data: { mail: sender } });
      case 'OUTLOOK_CREATE_DRAFT':
        assert.deepEqual(args.to_recipients, [recipient]);
        return Response.json({ successful: true, data: { id: 'fixture-draft' } });
      case 'OUTLOOK_ADD_MAIL_ATTACHMENT':
        assert.equal(args.message_id, 'fixture-draft');
        assert.equal(args.name, 'PBK-test.pdf');
        assert.equal(args.contentBytes, content);
        assert.equal(args.contentType, 'application/pdf');
        return Response.json({ successful: true, data: { id: 'fixture-attachment' } });
      case 'OUTLOOK_SEND_DRAFT':
        assert.equal(args.message_id, 'fixture-draft');
        return Response.json({ successful: true, log_id: 'fixture-send' });
      default: assert.fail('Unexpected Outlook action');
    }
  };
  const result = await sendAvaOutlookMail({ ...options, attachments: [{ filename: 'PBK-test.pdf', content }], fetchImpl });
  assert.deepEqual(calls, ['OUTLOOK_GET_PROFILE', 'OUTLOOK_CREATE_DRAFT', 'OUTLOOK_ADD_MAIL_ATTACHMENT', 'OUTLOOK_SEND_DRAFT']);
  assert.equal(result.deliveryStatus, 'accepted');
  assert.equal(result.providerRequestId, 'fixture-send');
});

test('leaves an unsent Outlook draft when the attachment is rejected', async () => {
  const calls = [];
  const result = await sendAvaOutlookMail({
    ...options,
    attachments: [{ filename: 'PBK-test.pdf', content: Buffer.from('%PDF-1.7').toString('base64') }],
    fetchImpl: async (url) => {
      const tool = url.split('/').at(-1);
      calls.push(tool);
      if (tool === 'OUTLOOK_GET_PROFILE') return Response.json({ successful: true, data: { mail: sender } });
      if (tool === 'OUTLOOK_CREATE_DRAFT') return Response.json({ successful: true, data: { id: 'fixture-draft' } });
      if (tool === 'OUTLOOK_ADD_MAIL_ATTACHMENT') return Response.json({ successful: false, error: 'attachment denied' });
      assert.fail('A draft without its attachment must never be sent');
    },
  });
  assert.equal(result.result, 'outlook_attachment_failed');
  assert.equal(result.draftId, 'fixture-draft');
  assert.equal(calls.length, 3);
});

test('reports an Exchange Send As denial for a verified alternate From draft', async () => {
  const alternate = 'alternate@example.com';
  const operations = [];
  const result = await sendAvaOutlookMail({
    ...options,
    sender: alternate,
    alternateSenders: [alternate],
    attachments: [{ filename: 'test.pdf', content: Buffer.from('%PDF-1.7').toString('base64') }],
    fetchImpl: async (url, request) => {
      const operation = url.split('/').at(-1);
      operations.push(operation);
      const { arguments: args } = JSON.parse(request.body);
      switch (operation) {
        case 'OUTLOOK_GET_PROFILE': return Response.json({ successful: true, data: { mail: sender } });
        case 'OUTLOOK_CREATE_DRAFT': return Response.json({ successful: true, data: { id: 'draft' } });
        case 'OUTLOOK_UPDATE_EMAIL':
          assert.equal(args.From.emailAddress.address, alternate);
          return Response.json({ successful: true });
        case 'OUTLOOK_GET_MESSAGE':
          return Response.json({ successful: true, data: { isDraft: true, from: { emailAddress: { address: alternate } } } });
        case 'OUTLOOK_ADD_MAIL_ATTACHMENT': return Response.json({ successful: true, data: { id: 'attachment' } });
        case 'OUTLOOK_SEND_DRAFT':
          return Response.json({ successful: false, error: 'The account does not have the right to send mail on behalf of the specified sending account' });
        default: assert.fail('Unexpected Outlook operation');
      }
    },
  });
  assert.equal(operations.at(-1), 'OUTLOOK_SEND_DRAFT');
  assert.equal(result.result, 'outlook_send_as_denied');
  assert.equal(result.draftId, 'draft');
});
