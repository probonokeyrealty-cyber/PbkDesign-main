const TOOL_URL = 'https://backend.composio.dev/api/v3.1/tools/execute/';
const VERSION = '20261120_00';
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export async function sendAvaOutlookMail({
  env = process.env, fetchImpl = globalThis.fetch, sender, recipient, subject, text,
} = {}) {
  const failed = (result, error) => ({ ok: false, provider: 'outlook', result, error });
  const apiKey = env.PBK_AVA_OUTLOOK_COMPOSIO_API_KEY?.trim();
  const accountId = env.PBK_AVA_OUTLOOK_ACCOUNT_ID?.trim();
  const userId = env.PBK_AVA_OUTLOOK_USER_ID?.trim();
  const allowedSender = env.PBK_AVA_OUTLOOK_SENDER?.trim().toLowerCase();
  const allowedRecipient = env.PBK_AVA_OUTLOOK_TEST_RECIPIENT?.trim().toLowerCase();

  if (!apiKey || !accountId || !userId || !ADDRESS.test(allowedSender || '') || !ADDRESS.test(allowedRecipient || '')) {
    return failed('provider_missing', 'The Ava Outlook connection is not configured.');
  }
  if (sender?.trim().toLowerCase() !== allowedSender || recipient?.trim().toLowerCase() !== allowedRecipient ||
    !subject?.trim() || subject.length > 255 || !text?.trim()) {
    return failed('outlook_test_scope_mismatch', 'The Outlook request must match the authorized test sender and recipient.');
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
      to: allowedRecipient, subject, body: text, is_html: false, user_id: 'me', save_to_sent_items: true,
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
