const TOOL_URL = 'https://backend.composio.dev/api/v3.1/tools/execute/';
const VERSION = '20261120_00';
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const SEARCH_ADDRESS = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const RECEIPT_CLOCK_SKEW_MS = 5_000;
const RECEIPT_WINDOW_MS = 48 * 60 * 60 * 1000;

function receiptAddress(value) {
  const header = typeof value === 'string' ? value.trim() : '';
  const address = header.match(/^[^<>]*<([^<>]+)>$/)?.[1] || header;
  return SEARCH_ADDRESS.test(address) ? address.toLowerCase() : '';
}

function normalizeMailText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : '';
}

export async function findAvaOutlookReceipt({
  env = process.env, fetchImpl = globalThis.fetch, sender, recipient, subject, text, sentAt,
} = {}) {
  const mailbox = env.PBK_AVA_RECEIPT_GMAIL_ADDRESS?.trim().toLowerCase();
  const accountId = env.PBK_AVA_RECEIPT_GMAIL_ACCOUNT_ID?.trim();
  const userId = env.PBK_AVA_RECEIPT_GMAIL_USER_ID?.trim();
  const apiKey = env.PBK_AVA_OUTLOOK_COMPOSIO_API_KEY?.trim();
  const unavailable = { status: 503, error: 'Ava could not access the PBK inbox. You can still confirm delivery with a receipt link.' };
  if (!SEARCH_ADDRESS.test(mailbox || '') || !accountId || !userId || !apiKey) return unavailable;

  const to = receiptAddress(recipient);
  const from = receiptAddress(sender);
  const approvedSubject = normalizeMailText(subject);
  const approvedText = normalizeMailText(text);
  const sentTime = Date.parse(sentAt);
  const [localPart, domain] = mailbox.split('@');
  const [recipientLocal, recipientDomain] = to.split('@');
  if (recipientDomain !== domain || recipientLocal.split('+')[0] !== localPart) {
    return { status: 422, error: 'This email was not addressed to the PBK inbox or one of its test aliases.' };
  }
  if (!from || from !== env.PBK_AVA_OUTLOOK_SENDER?.trim().toLowerCase() ||
    !approvedSubject || !approvedText || !Number.isFinite(sentTime)) {
    return { status: 422, error: 'This approval does not have enough send details for inbox matching.' };
  }

  async function read(tool, args) {
    const response = await fetchImpl(TOOL_URL + tool, {
      method: 'POST',
      redirect: 'error',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        connected_account_id: accountId, user_id: userId, version: VERSION,
        arguments: { user_id: 'me', ...args },
      }),
    });
    const result = response.ok ? await response.json() : null;
    return result?.successful === true && !result.error ? result.data : null;
  }

  const earliest = sentTime - RECEIPT_CLOCK_SKEW_MS;
  const latest = sentTime + RECEIPT_WINDOW_MS;
  const query = [
    'in:inbox', 'from:' + from, 'to:' + to,
    'after:' + Math.floor((earliest - 1000) / 1000),
    'before:' + Math.ceil((latest + 1000) / 1000),
  ].join(' ');

  try {
    const profile = await read('GMAIL_GET_PROFILE', {});
    if (receiptAddress(profile?.emailAddress) !== mailbox) return unavailable;
    const result = await read('GMAIL_FETCH_EMAILS', {
      query, label_ids: ['INBOX'], max_results: 25, verbose: true, include_payload: true,
    });
    if (!result || !Array.isArray(result.messages)) return unavailable;
    const matches = new Map();
    for (const message of result.messages) {
      const receivedAt = Date.parse(message?.messageTimestamp);
      if (/^[a-f0-9]{12,}$/i.test(message?.messageId || '') &&
        /^[a-f0-9]{12,}$/i.test(message?.threadId || '') &&
        message.labelIds?.includes('INBOX') && receivedAt >= earliest && receivedAt <= latest &&
        receiptAddress(message.sender) === from && receiptAddress(message.to) === to &&
        normalizeMailText(message.subject) === approvedSubject &&
        normalizeMailText(message.messageText) === approvedText) {
        matches.set(message.messageId, message.threadId);
      }
    }
    if (result.nextPageToken || matches.size > 1) {
      return { status: 409, error: 'Ava could not narrow the inbox search to one receipt. Check the message before confirming delivery.' };
    }
    if (matches.size === 0) return { status: 404, error: 'No matching message was found in the PBK inbox.' };
    const [threadId] = matches.values();
    const url = new URL('https://mail.google.com/mail/u/');
    url.searchParams.set('authuser', mailbox);
    url.hash = 'all/' + threadId;
    return { status: 200, receiptUrl: url.href };
  } catch {
    return unavailable;
  }
}

export async function sendAvaOutlookMail({
  env = process.env, fetchImpl = globalThis.fetch, sender, recipient, subject, text,
} = {}) {
  const failed = (result, error) => ({ ok: false, provider: 'outlook', result, error });
  const apiKey = env.PBK_AVA_OUTLOOK_COMPOSIO_API_KEY?.trim();
  const accountId = env.PBK_AVA_OUTLOOK_ACCOUNT_ID?.trim();
  const userId = env.PBK_AVA_OUTLOOK_USER_ID?.trim();
  const allowedSender = env.PBK_AVA_OUTLOOK_SENDER?.trim().toLowerCase();
  const allowedRecipient = env.PBK_AVA_OUTLOOK_TEST_RECIPIENT?.trim().toLowerCase();
  const leadEmailEnabled = env.PBK_AVA_OUTLOOK_LEAD_EMAIL_ENABLED === '1';
  const to = recipient?.trim();

  if (!apiKey || !accountId || !userId || !ADDRESS.test(allowedSender || '') ||
    (!leadEmailEnabled && !ADDRESS.test(allowedRecipient || ''))) {
    return failed('provider_missing', 'The Ava Outlook connection is not configured.');
  }
  if (sender?.trim().toLowerCase() !== allowedSender || !ADDRESS.test(to || '') ||
    (!leadEmailEnabled && to.toLowerCase() !== allowedRecipient) ||
    !subject?.trim() || subject.length > 255 || !text?.trim()) {
    return failed('outlook_address_or_content_invalid', 'Check the approved Outlook sender, recipient, subject, and message.');
  }

  async function execute(tool, args) {
    return fetchImpl(TOOL_URL + tool, {
      method: 'POST',
      redirect: 'error',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ connected_account_id: accountId, user_id: userId, version: VERSION, arguments: args }),
    });
  }

  try {
    const response = await execute('OUTLOOK_GET_PROFILE', { user_id: 'me', select: ['mail', 'userPrincipalName'] });
    const profile = response.ok ? await response.json() : null;
    const mailbox = profile?.data?.mail || profile?.data?.userPrincipalName;
    if (profile?.successful !== true || typeof mailbox !== 'string' || mailbox.toLowerCase() !== allowedSender) {
      return failed('outlook_sender_unverified', 'The Outlook connection did not verify the approved sender.');
    }
  } catch {
    return failed('outlook_sender_unverified', 'Ava could not verify the approved Outlook sender.');
  }

  try {
    const response = await execute('OUTLOOK_SEND_EMAIL', {
      to, subject, body: text, is_html: false, user_id: 'me', save_to_sent_items: true,
    });
    if ([400, 401, 403, 404].includes(response.status)) {
      return failed('outlook_send_rejected', 'Composio rejected the Outlook send request.');
    }
    const receipt = response.ok ? await response.json() : null;
    if (receipt?.successful === true && !receipt.error) {
      return {
        ok: true, provider: 'outlook', status: response.status, deliveryStatus: 'accepted',
        providerRequestId: receipt.log_id || receipt.logId || '',
      };
    }
  } catch {
    // The request may already have reached Outlook. Reconciliation belongs to the approval lease.
  }
  throw new Error('Outlook send outcome is unknown. Check the provider before trying again.');
}
