export function normalizeOutlookReceiptUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (
      url.hostname === 'mail.google.com' &&
      /^\/mail\/(?:u\/(?:\d+\/)?)?$/.test(url.pathname) &&
      /^#(?:all|inbox)\/[a-z0-9_-]{12,}$/i.test(url.hash)
    ) {
      const authUser = url.searchParams.get('authuser');
      url.search = '';
      if (authUser && /^[a-z0-9@._+-]{1,254}$/i.test(authUser))
        url.searchParams.set('authuser', authUser);
      return url.href;
    }
    if (
      ['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(url.hostname) &&
      /^\/mail\/(?:\d+\/)?(?:inbox\/id|deeplink\/read)\/[a-z0-9_%=-]{12,}\/?$/i.test(url.pathname)
    ) {
      url.search = '';
      url.hash = '';
      return url.href;
    }
  } catch {
    return '';
  }
  return '';
}

export function readOutlookDelivery(approval) {
  const metadata = approval?.metadata;
  const params = metadata?.executionParams;
  const result = metadata?.providerActionResult;
  const dispatch = metadata?.providerActionDispatch?.status;
  const provider =
    params?.provider || approval?.provider || result?.provider || result?.callProvider;
  const action = approval?.approvalAction || metadata?.requestedTool || approval?.action;
  const documentEmail =
    action === 'sendSellerDocs' &&
    (String(provider || '').toLowerCase() === 'outlook' ||
      approval?.source === 'seller_docs_manual' ||
      params?.source === 'seller_docs_manual');
  if (
    !approval?.id ||
    (!documentEmail &&
      (String(provider || '').toLowerCase() !== 'outlook' || action !== 'sendColdEmail'))
  )
    return null;

  const saved = metadata?.outlookDeliveryConfirmation;
  const receiptUrl = normalizeOutlookReceiptUrl(saved?.receiptUrl);
  const confirmation =
    receiptUrl && saved?.confirmedAt && saved?.confirmedBy
      ? { receiptUrl, confirmedAt: saved.confirmedAt, confirmedBy: saved.confirmedBy }
      : null;
  let state = 'approved';
  if (approval.status === 'approved' && confirmation) {
    state = 'delivered';
  } else if (
    dispatch === 'reconciliation_required' ||
    result?.reconciliationRequired ||
    ['provider_delivery_unknown', 'outlook_send_unknown'].includes(result?.result)
  ) {
    state = 'recovery';
  } else if (dispatch === 'dispatching') {
    state = 'dispatching';
  } else if (
    documentEmail &&
    dispatch === 'completed' &&
    result?.ok === false &&
    result.result === 'outlook_not_sent' &&
    metadata?.outlookDeliveryReconciliation?.status === 'unsent'
  ) {
    state = 'unsent';
  } else if (result?.ok === false) {
    state = 'failed';
  } else if (result?.deliveryStatus === 'delivered') {
    state = 'delivered';
  } else if (
    result?.deliveryStatus === 'accepted' ||
    (dispatch === 'completed' && result?.ok === true && result.result === 'live')
  ) {
    state = 'accepted';
  } else if (approval.status !== 'approved') {
    state = approval.status === 'pending' || !approval.status ? 'pending' : 'closed';
  } else if (documentEmail) {
    state = 'recovery';
  }

  return {
    id: String(approval.id),
    subject:
      typeof params?.subject === 'string' && params.subject
        ? params.subject
        : documentEmail
          ? `Your property at ${params?.address || approval.address || 'PBK'} - ${params?.selectedDocuments?.length > 1 ? 'seller packet' : 'document package'}`
          : '',
    leadName: typeof approval.leadName === 'string' ? approval.leadName : '',
    at: String(
      metadata?.providerActionDispatch?.reconciliationRequiredAt ||
        metadata?.providerActionDispatch?.completedAt ||
        approval.actedAt ||
        approval.decidedAt ||
        approval.createdAt ||
        ''
    ),
    state,
    receiptId: typeof result?.providerRequestId === 'string' ? result.providerRequestId : '',
    confirmation,
    canConfirm: approval.status === 'approved' && (state === 'accepted' || state === 'recovery'),
  };
}
