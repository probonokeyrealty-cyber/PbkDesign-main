const PROVIDER_WRITES = new Set([
  'sms.send',
  'email.send',
  'call.start',
  'docusign.send',
  'campaign.launch',
  'offer.send',
]);

const MANUAL_ONE_TO_ONE_SENDS = new Set(['sms.send', 'email.send']);

const BLOCKING_FLAGS = [
  'stopLanguageDetected',
  'dncMatched',
  'quietHours',
  'consentMissing',
  'legalAdviceRequested',
  'taxAdviceRequested',
  'threatDetected',
];

function cleanString(value = '') {
  return String(value || '').trim().toLowerCase();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function decideAvaAction(input = {}) {
  const actionType = cleanString(input.actionType);
  const source = cleanString(input.source || 'ava');
  const confidence = number(input.confidence, 0);
  const evidenceCount = number(input.evidenceCount, 0);
  const approvalState = cleanString(input.approvalState);

  const blockingFlag = BLOCKING_FLAGS.find((flag) => input[flag] === true);
  if (blockingFlag) {
    return {
      decision: 'blocked',
      reason: blockingFlag,
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (input.humanRequested === true || input.disputeDetected === true) {
    return {
      decision: 'handoff',
      reason: input.humanRequested === true ? 'human_requested' : 'dispute_detected',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (PROVIDER_WRITES.has(actionType)) {
    if (source === 'manual' && MANUAL_ONE_TO_ONE_SENDS.has(actionType) && input.safetyPassed === true) {
      return {
        decision: 'autonomous',
        reason: 'operator_authored_safety_passed',
        approvalRequired: false,
        providerWriteAllowed: true,
      };
    }

    if (approvalState === 'approved') {
      if (input.safetyPassed !== true) {
        return {
          decision: 'approval_required',
          reason: 'provider_write_requires_safety_validation',
          approvalRequired: true,
          providerWriteAllowed: false,
        };
      }

      return {
        decision: 'autonomous',
        reason: 'approval_already_granted',
        approvalRequired: false,
        providerWriteAllowed: true,
      };
    }

    return {
      decision: 'approval_required',
      reason: 'provider_write_requires_approval',
      approvalRequired: true,
      providerWriteAllowed: false,
    };
  }

  if (actionType === 'crm.update' && confidence >= 0.85 && evidenceCount >= 1) {
    return {
      decision: 'autonomous',
      reason: 'high_confidence_internal_crm_update',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  if (actionType === 'lead.note' && confidence >= 0.65) {
    return {
      decision: 'log_only',
      reason: 'internal_note_with_sufficient_confidence',
      approvalRequired: false,
      providerWriteAllowed: false,
    };
  }

  return {
    decision: 'ask',
    reason: 'insufficient_evidence_or_unknown_action',
    approvalRequired: false,
    providerWriteAllowed: false,
  };
}
