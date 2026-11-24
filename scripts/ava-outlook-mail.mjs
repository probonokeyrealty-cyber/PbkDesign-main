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

export async function verifyOutlookDocumentReceipt({
  env = process.env, fetchImpl = globalThis.fetch, receiptUrl, sender, recipient, subject, approvedAt,
} = {}) {
  const apiKey = env.PBK_AVA_OUTLOOK_COMPOSIO_API_KEY?.trim();
  const accountId = env.PBK_AVA_OUTLOOK_ACCOUNT_ID?.trim();
  const userId = env.PBK_AVA_OUTLOOK_USER_ID?.trim();
  const mailbox = env.PBK_AVA_OUTLOOK_SENDER?.trim().toLowerCase();
  const start = Date.parse(approvedAt);
  const unavailable = { status: 503, error: 'Outlook did not verify the document receipt.' };
  const mismatch = { status: 422, error: 'The Outlook receipt does not match this approved PDF send.' };
  if (!apiKey || !accountId || !userId || !mailbox) return unavailable;
  try {
    const messageId = decodeURIComponent(new URL(receiptUrl).pathname.replace(/\/$/, '').split('/').at(-1));
    const read = async (tool, args) => {
      const response = await fetchImpl(TOOL_URL + tool, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connected_account_id: accountId, user_id: userId, version: VERSION, arguments: args }),
      });
      const value = response.ok ? await response.json() : null;
      return value?.successful === true && !value.error ? value.data : null;
    };
    const profile = await read('OUTLOOK_GET_PROFILE', { user_id: 'me', select: ['mail', 'userPrincipalName'] });
    if (receiptAddress(profile?.mail || profile?.userPrincipalName) !== mailbox) return unavailable;
    const message = await read('OUTLOOK_GET_MESSAGE', {
      user_id: 'me', message_id: messageId,
      select: ['id', 'subject', 'from', 'toRecipients', 'isDraft', 'hasAttachments', 'sentDateTime', 'internetMessageId'],
    });
    if (!message) return unavailable;
    const sent = Date.parse(message.sentDateTime);
    if (message.id !== messageId || message.isDraft !== false || message.hasAttachments !== true ||
        message.subject !== subject || !sender || !recipient ||
        receiptAddress(message.from?.emailAddress?.address) !== receiptAddress(sender) ||
        message.toRecipients?.length !== 1 ||
        receiptAddress(message.toRecipients[0]?.emailAddress?.address) !== receiptAddress(recipient) ||
        !Number.isFinite(start) || !Number.isFinite(sent) || sent < start - RECEIPT_CLOCK_SKEW_MS ||
        sent > start + RECEIPT_WINDOW_MS) return mismatch;
    return { status: 200, sentAt: message.sentDateTime, messageId: message.internetMessageId || messageId };
  } catch {
    return unavailable;
  }
}

export async function sendAvaOutlookMail({
  env = process.env, fetchImpl = globalThis.fetch, sender, recipient, subject, text, attachments = [], alternateSenders = [],
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
  const from = sender?.trim().toLowerCase();
  const alternate = Array.isArray(attachments) && attachments.length > 0 &&
    Array.isArray(alternateSenders) && alternateSenders.includes(from);
  if (!ADDRESS.test(from || '') || (from !== allowedSender && !alternate) || !ADDRESS.test(to || '') ||
    (!leadEmailEnabled && to.toLowerCase() !== allowedRecipient) ||
    !subject?.trim() || subject.length > 255 || !text?.trim()) {
    return failed('outlook_address_or_content_invalid', 'Check the approved Outlook sender, recipient, subject, and message.');
  }

  if (!Array.isArray(attachments) || attachments.some((file) =>
    !file || !/\.pdf$/i.test(file.filename || '') ||
    typeof file.content !== 'string' || !file.content.startsWith('JVBERi0') ||
    file.content.length > 4_000_000
  )) {
    return failed('outlook_attachment_invalid', 'Each Outlook attachment must be a valid PDF under 3 MB.');
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

  if (attachments.length) {
    const receiptFor = async (tool, args) => {
      const response = await execute(tool, args);
      const receipt = response.ok ? await response.json() : null;
      return receipt?.successful === true && !receipt.error ? receipt : null;
    };
    let draftId = '';
    try {
      const draft = await receiptFor('OUTLOOK_CREATE_DRAFT', {
        to_recipients: [to], subject, body: text, is_html: false,
      });
      draftId = draft?.data?.id || '';
      if (typeof draftId !== 'string' || !draftId) {
        return failed('outlook_draft_failed', 'Outlook did not confirm creation of the PDF email draft.');
      }
      if (from !== allowedSender) {
        const message = { user_id: 'me', message_id: draftId };
        const updated = await receiptFor('OUTLOOK_UPDATE_EMAIL', {
          ...message, From: { emailAddress: { address: from } },
        });
        const checked = updated && await receiptFor('OUTLOOK_GET_MESSAGE', {
          ...message, select: ['from', 'isDraft'],
        });
        if (checked?.data?.from?.emailAddress?.address?.toLowerCase() !== from || checked?.data?.isDraft !== true) {
          return { ...failed('outlook_sender_unverified', 'Outlook did not confirm the selected From address. The draft was not sent.'), draftId };
        }
      }
      for (const file of attachments) {
        const added = await receiptFor('OUTLOOK_ADD_MAIL_ATTACHMENT', {
          user_id: 'me', message_id: draftId, name: file.filename,
          contentType: 'application/pdf', contentBytes: file.content,
          odata_type: '#microsoft.graph.fileAttachment',
        });
        if (!added?.data?.id) {
          return { ...failed('outlook_attachment_failed', 'Outlook did not confirm the PDF attachment. The draft was not sent.'), draftId };
        }
      }
    } catch {
      return { ...failed('outlook_draft_failed', 'Outlook could not prepare the draft and its attachments.'), draftId };
    }
    try {
      const response = await execute('OUTLOOK_SEND_DRAFT', { user_id: 'me', message_id: draftId });
      if ([400, 401, 403, 404].includes(response.status)) {
        return { ...failed('outlook_send_rejected', 'Outlook rejected the PDF email. Review the draft before retrying.'), draftId };
      }
      const receipt = response.ok ? await response.json() : null;
      if (receipt?.successful === true && !receipt.error) {
        return {
          ok: true, provider: 'outlook', status: response.status, deliveryStatus: 'accepted',
          providerRequestId: receipt.log_id || receipt.logId || '', draftId,
        };
      }
      const providerError = typeof receipt?.error === 'string' ? receipt.error : receipt?.error?.message || '';
      if (/does not have the right to send mail on behalf|ErrorSendAsDenied/i.test(providerError)) {
        return { ...failed('outlook_send_as_denied', 'Outlook has not granted permission to send from the selected address.'), draftId };
      }
      if ([400, 401, 403, 404].includes(Number(receipt?.data?.status_code))) {
        return { ...failed('outlook_send_rejected', 'Outlook rejected the PDF email. Review the draft before retrying.'), draftId };
      }
    } catch {
      // Outlook might have accepted the send before the connection failed.
    }
    return { ...failed('outlook_send_unknown', 'Check Outlook Sent Items before retrying the PDF email.'), draftId };
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
