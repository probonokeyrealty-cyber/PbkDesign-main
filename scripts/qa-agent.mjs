import { recordQaValidationMetric } from './observability.mjs';

const SECRET_KEY_PATTERN = /(secret|token|passcode|password|authorization|api[_-]?key|private[_-]?key|service[_-]?role|envvarvalue|bridge[_-]?api[_-]?key)/i;
const MAX_SANITIZE_DEPTH = 8;

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function resultOk(result = {}) {
  if (!result || typeof result !== 'object') return Boolean(result);
  if (result.ok === false || result.success === false) return false;
  if (result.error || result.error_message) return false;
  return true;
}

function hasAnyPath(result = {}, paths = []) {
  return paths.some((path) => {
    const parts = String(path || '').split('.').filter(Boolean);
    let cursor = result;
    for (const part of parts) {
      if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return false;
      cursor = cursor[part];
    }
    return hasValue(cursor);
  });
}

function qaPass(validator, details = {}) {
  return {
    ok: true,
    skipped: false,
    validator,
    reason: details.reason || 'validated',
    details,
  };
}

function qaFail(validator, reason, details = {}) {
  return {
    ok: false,
    skipped: false,
    validator,
    reason,
    details,
  };
}

function validateProviderOk(toolName, result = {}) {
  if (!resultOk(result)) return qaFail(toolName, 'provider_reported_failure');
  return null;
}

const QA_VALIDATORS = {
  sendDocuSign(result = {}) {
    const providerFailure = validateProviderOk('sendDocuSign', result);
    if (providerFailure) return providerFailure;
    const delivered = hasAnyPath(result, [
      'envelopeId',
      'envelope_id',
      'docusign.envelopeId',
      'docusign.envelope_id',
      'contract.envelopeId',
      'contract.envelope_id',
      'delivery.envelopeId',
      'delivery.envelope_id',
    ]);
    const status = String(result.status || result.docusign?.status || result.contract?.status || '').toLowerCase();
    if (delivered && (!status || /sent|delivered|complete|created/.test(status))) {
      return qaPass('sendDocuSign', { deliveryProof: true, status });
    }
    return qaFail('sendDocuSign', 'missing_delivery_proof', { status });
  },

  sendContract(result = {}) {
    return QA_VALIDATORS.sendDocuSign(result);
  },

  prepare_and_send_contract(result = {}) {
    const providerFailure = validateProviderOk('prepare_and_send_contract', result);
    if (providerFailure) return providerFailure;
    const sent = hasAnyPath(result, [
      'contractResult.envelopeId',
      'contractResult.docusign.envelopeId',
      'docusign.envelopeId',
      'envelopeId',
      'contract.envelopeId',
    ]);
    if (sent) return qaPass('prepare_and_send_contract', { deliveryProof: true });
    return qaFail('prepare_and_send_contract', 'missing_delivery_proof');
  },

  telnyx_call(result = {}) {
    const providerFailure = validateProviderOk('telnyx_call', result);
    if (providerFailure) return providerFailure;
    const callId = hasAnyPath(result, [
      'call_control_id',
      'callControlId',
      'call.call_control_id',
      'call.callControlId',
      'call.id',
      'id',
    ]);
    if (callId) return qaPass('telnyx_call', { callProof: true });
    return qaFail('telnyx_call', 'missing_call_proof');
  },

  telnyx_sms(result = {}) {
    const providerFailure = validateProviderOk('telnyx_sms', result);
    if (providerFailure) return providerFailure;
    const messageId = hasAnyPath(result, [
      'messageId',
      'message_id',
      'message.id',
      'sms.id',
      'data.id',
      'id',
    ]);
    if (messageId) return qaPass('telnyx_sms', { messageProof: true });
    return qaFail('telnyx_sms', 'missing_message_proof');
  },

  send_verification_sms(result = {}) {
    return QA_VALIDATORS.telnyx_sms(result);
  },

  sendColdEmail(result = {}) {
    const providerFailure = validateProviderOk('sendColdEmail', result);
    if (providerFailure) return providerFailure;
    const emailId = hasAnyPath(result, [
      'messageId',
      'message_id',
      'email.id',
      'delivery.id',
      'providerMessageId',
      'id',
    ]);
    const prepared = result.live === false || result.prepared === true || /prepared|draft/i.test(String(result.status || ''));
    if (emailId || prepared) return qaPass('sendColdEmail', { deliveryProof: Boolean(emailId), prepared });
    return qaFail('sendColdEmail', 'missing_email_delivery_proof');
  },

  updateCRM(result = {}) {
    const providerFailure = validateProviderOk('updateCRM', result);
    if (providerFailure) return providerFailure;
    const synced = result.synced === true
      || result.success === true
      || hasAnyPath(result, ['boxKey', 'entityId', 'crmEntityId', 'providerEntityId']);
    const skipped = result.skipped === true || /skipped|disabled|not_configured/i.test(String(result.status || result.result || ''));
    if (synced || skipped) return qaPass('updateCRM', { synced, skipped });
    return qaFail('updateCRM', 'missing_crm_sync_proof');
  },

  analyzeDeal(result = {}) {
    const providerFailure = validateProviderOk('analyzeDeal', result);
    if (providerFailure) return providerFailure;
    const offer = Number(
      result.mao
      ?? result.offer
      ?? result.targetOffer
      ?? result.analysis?.mao
      ?? result.analysis?.targetOffer
      ?? 0,
    );
    if (Number.isFinite(offer) && offer > 0) return qaPass('analyzeDeal', { offer });
    return qaFail('analyzeDeal', 'missing_offer_analysis');
  },

  uploadToS3(result = {}) {
    const providerFailure = validateProviderOk('uploadToS3', result);
    if (providerFailure) return providerFailure;
    const archived = result.s3Archive?.ok === true
      || result.uploaded === true
      || hasAnyPath(result, ['bucket', 'key', 's3Key', 'storagePath', 'url', 'signedUrl']);
    if (archived) return qaPass('uploadToS3', { archived: true });
    return qaFail('uploadToS3', 'missing_s3_archive_proof');
  },

  recording_capture(result = {}) {
    return QA_VALIDATORS.uploadToS3(result);
  },
};

export function sanitizeQaPayload(value, depth = 0) {
  if (depth > MAX_SANITIZE_DEPTH) return '[REDACTED_DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.map((item) => sanitizeQaPayload(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(String(key || ''))) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = sanitizeQaPayload(item, depth + 1);
    }
  }
  return redacted;
}

export function validateQaToolResult(toolName, result = {}) {
  const normalizedToolName = String(toolName || '').trim();
  const validator = QA_VALIDATORS[normalizedToolName];
  if (!validator) {
    if (normalizedToolName) {
      console.warn(`[qa-agent] No validator registered for tool "${normalizedToolName}". Add one to QA_VALIDATORS to enable proof checking.`);
    }
    return {
      ok: true,
      skipped: true,
      validator: 'none',
      reason: 'no_validator_registered',
      details: { toolName: normalizedToolName },
    };
  }
  return validator(result || {});
}

export function buildQaAuditRecord({
  toolName,
  params = {},
  result = {},
  qa = {},
  retryCount = 0,
  source = 'pbk-bridge',
  createdAt = new Date().toISOString(),
} = {}) {
  return {
    toolName: String(toolName || '').trim(),
    tool_name: String(toolName || '').trim(),
    passed: qa.ok === true,
    skipped: qa.skipped === true,
    reason: String(qa.reason || '').slice(0, 240),
    validator: String(qa.validator || '').slice(0, 120),
    retryCount: Math.max(0, Math.round(Number(retryCount || 0))),
    retry_count: Math.max(0, Math.round(Number(retryCount || 0))),
    params: sanitizeQaPayload(params || {}),
    result: sanitizeQaPayload(result || {}),
    qa: sanitizeQaPayload(qa || {}),
    source,
    createdAt,
    created_at: createdAt,
  };
}

export function buildQaFailureApproval({ toolName, params = {}, result = {}, qa = {}, auditRecord = {} } = {}) {
  const label = String(toolName || 'tool').replace(/_/g, ' ');
  return {
    type: 'qa_failure',
    leadName: params.leadName || params.name || params.sellerName || label,
    leadId: params.leadId || params.id || '',
    address: params.address || params.propertyAddress || params.target || '',
    phone: params.phone || params.to || '',
    email: params.email || '',
    provider: 'PBK QA Agent',
    approvalAction: 'qa_failure_review',
    notes: `QA Agent caught ${label}: ${qa.reason || 'validation_failed'}. Review before trusting this tool result.`,
    source: 'qa-agent',
    metadata: {
      kind: 'qa_failure',
      requestedTool: toolName,
      qa: sanitizeQaPayload(qa || {}),
      audit: sanitizeQaPayload(auditRecord || {}),
      params: sanitizeQaPayload(params || {}),
      result: sanitizeQaPayload(result || {}),
    },
  };
}

export async function validateToolCallWithQa({
  toolName,
  params = {},
  result = {},
  retryCount = 0,
  auditSink = null,
  approvalSink = null,
  source = 'pbk-bridge',
} = {}) {
  const qa = validateQaToolResult(toolName, result);
  recordQaValidationMetric({
    toolName,
    ok: qa.ok === true || qa.skipped === true,
    reason: qa.reason || '',
    source,
  });
  const auditRecord = buildQaAuditRecord({
    toolName,
    params,
    result,
    qa,
    retryCount,
    source,
  });

  if (typeof auditSink === 'function') {
    await auditSink(auditRecord);
  }

  let approval = null;
  if (qa.ok === false && typeof approvalSink === 'function') {
    approval = buildQaFailureApproval({ toolName, params, result, qa, auditRecord });
    await approvalSink(approval);
  }

  return {
    ok: qa.ok === true,
    skipped: qa.skipped === true,
    qa,
    auditRecord,
    approval,
    result,
  };
}

export const qaToolValidators = Object.freeze(Object.keys(QA_VALIDATORS));
