export function readOutlookDelivery(approval) {
  const metadata = approval?.metadata;
  const params = metadata?.executionParams;
  const result = metadata?.providerActionResult;
  const dispatch = metadata?.providerActionDispatch?.status;
  const provider =
    params?.provider || approval?.provider || result?.provider || result?.callProvider;
  const action = approval?.approvalAction || metadata?.requestedTool || approval?.action;
  if (
    !approval?.id ||
    String(provider || '').toLowerCase() !== 'outlook' ||
    action !== 'sendColdEmail'
  )
    return null;

  let state = 'approved';
  if (
    dispatch === 'reconciliation_required' ||
    result?.reconciliationRequired ||
    result?.result === 'provider_delivery_unknown'
  ) {
    state = 'recovery';
  } else if (dispatch === 'dispatching') {
    state = 'dispatching';
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
  }

  return {
    id: String(approval.id),
    subject: typeof params?.subject === 'string' ? params.subject : '',
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
  };
}
