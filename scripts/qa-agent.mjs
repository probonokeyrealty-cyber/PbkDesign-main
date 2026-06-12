import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordQaValidationMetric } from './observability.mjs';

const SECRET_KEY_PATTERN = /(secret|token|passcode|password|authorization|api[_-]?key|private[_-]?key|service[_-]?role|envvarvalue|bridge[_-]?api[_-]?key)/i;
const MAX_SANITIZE_DEPTH = 8;
const QA_AUDIT_FALLBACK_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '.pbk-local',
  'qa-audit-fallback.ndjson'
);

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
  return paths.some((path) => hasValue(getPathValue(result, path)));
}

function getPathValue(result = {}, path = '') {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = result;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function getFirstPathValue(result = {}, paths = []) {
  for (const path of paths) {
    const value = getPathValue(result, path);
    if (hasValue(value)) return value;
  }
  return '';
}

function hasSemanticProviderId(value = '', { allowEnvPrefix = false } = {}) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(?:test|fake|demo|mock|sample)[_-]?[a-z0-9-]*$/i.test(text)) return false;
  if (/00000000-0000-0000-0000-000000000000/.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) return true;
  if (allowEnvPrefix && /^env(?:elope)?[_-]?[a-z0-9-]{3,}$/i.test(text)) return true;
  return /^[a-z][a-z0-9_-]{7,}$/i.test(text);
}

function hasNurtureRecommendation(result = {}) {
  const recommendation =
    result.recommendation && typeof result.recommendation === 'object'
      ? result.recommendation
      : result.nurtureRecommendation && typeof result.nurtureRecommendation === 'object'
        ? result.nurtureRecommendation
        : {};
  const channel = String(recommendation.channel || result.channel || '').toLowerCase();
  const hasChannel = /^(sms|email|call|manual|none)$/.test(channel);
  const hasReason = hasValue(recommendation.reason || recommendation.rationale || result.reason || result.summary);
  return hasChannel && hasReason;
}

async function writeQaAuditFallback(record = {}) {
  await mkdir(path.dirname(QA_AUDIT_FALLBACK_PATH), { recursive: true });
  await appendFile(QA_AUDIT_FALLBACK_PATH, `${JSON.stringify(record)}\n`, 'utf8');
  return { ok: true, path: QA_AUDIT_FALLBACK_PATH };
}

async function writeAuditFallback(auditFallbackSink, auditRecord, reason) {
  if (typeof auditFallbackSink !== 'function') return null;
  const fallbackRecord = {
    ...auditRecord,
    fallbackReason: String(reason || 'qa_audit_fallback').slice(0, 500),
    fallbackAt: new Date().toISOString(),
  };
  const output = await auditFallbackSink(fallbackRecord);
  return {
    ok: true,
    record: fallbackRecord,
    output: output || null,
  };
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
    const envelopeId = getFirstPathValue(result, [
      'envelopeId',
      'envelope_id',
      'docusign.envelopeId',
      'docusign.envelope_id',
      'contract.envelopeId',
      'contract.envelope_id',
      'delivery.envelopeId',
      'delivery.envelope_id',
    ]);
    const delivered = hasValue(envelopeId);
    const status = String(result.status || result.docusign?.status || result.contract?.status || '').toLowerCase();
    if (delivered && !hasSemanticProviderId(envelopeId, { allowEnvPrefix: true })) {
      return qaFail('sendDocuSign', 'invalid_delivery_proof', { envelopeId: '[invalid-format]', status });
    }
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
    const envelopeId = getFirstPathValue(result, [
      'contractResult.envelopeId',
      'contractResult.docusign.envelopeId',
      'docusign.envelopeId',
      'envelopeId',
      'contract.envelopeId',
    ]);
    const sent = hasValue(envelopeId);
    if (sent && !hasSemanticProviderId(envelopeId, { allowEnvPrefix: true })) {
      return qaFail('prepare_and_send_contract', 'invalid_delivery_proof', { envelopeId: '[invalid-format]' });
    }
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

  pbk_call_operator(result = {}) {
    return QA_VALIDATORS.telnyx_call(result);
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

  scheduleAppointment(result = {}) {
    const providerFailure = validateProviderOk('scheduleAppointment', result);
    if (providerFailure) return providerFailure;
    const appointmentId = getFirstPathValue(result, [
      'appointment.id',
      'appointmentId',
      'appointment_id',
      'id',
    ]);
    const status = String(result.appointment?.status || result.status || '').toLowerCase();
    if (hasValue(appointmentId) && /scheduled|confirmed|requested|pending-confirmation|drafted/.test(status)) {
      return qaPass('scheduleAppointment', { appointmentProof: true, status });
    }
    if (hasValue(appointmentId)) {
      return qaPass('scheduleAppointment', { appointmentProof: true, status: status || 'recorded' });
    }
    return qaFail('scheduleAppointment', 'missing_appointment_proof', { status });
  },

  sendSellerDocs(result = {}) {
    const providerFailure = validateProviderOk('sendSellerDocs', result);
    if (providerFailure) return providerFailure;
    const deliveryId = getFirstPathValue(result, [
      'delivery.id',
      'delivery.deliveryId',
      'delivery.delivery_id',
      'email.messageId',
      'email.message_id',
      'email.providerMessageId',
      'email.provider_message_id',
      'messageId',
      'message_id',
      'id',
    ]);
    const status = String(result.delivery?.status || result.email?.status || result.status || result.result || '').toLowerCase();
    const sent = /sent|delivered|queued|accepted|live/.test(status) || result.delivery?.status === 'sent';
    if (hasValue(deliveryId) && sent) {
      return qaPass('sendSellerDocs', {
        deliveryProof: true,
        status,
        attachmentCount: Array.isArray(result.attachments) ? result.attachments.length : 0,
      });
    }
    return qaFail('sendSellerDocs', 'missing_seller_docs_delivery_proof', { status });
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

  sendNegotiationApproval(result = {}) {
    const providerFailure = validateProviderOk('sendNegotiationApproval', result);
    if (providerFailure) return providerFailure;
    const queued = hasAnyPath(result, [
      'approvalId',
      'approval_id',
      'approval.id',
      'id',
    ]);
    if (queued) return qaPass('sendNegotiationApproval', { approvalProof: true });
    return qaFail('sendNegotiationApproval', 'missing_approval_proof');
  },

  avaOverrideOffer(result = {}) {
    const providerFailure = validateProviderOk('avaOverrideOffer', result);
    if (providerFailure) return providerFailure;
    const finalOffer = Number(result.finalOffer ?? result.offer ?? 0);
    const recorded = hasAnyPath(result, ['offerOverrideId', 'offer_override_id', 'overrideId', 'id'])
      || (Number.isFinite(finalOffer) && finalOffer > 0);
    if (recorded) return qaPass('avaOverrideOffer', { overrideProof: true });
    return qaFail('avaOverrideOffer', 'missing_override_proof');
  },

  launchBrowserResearch(result = {}) {
    const providerFailure = validateProviderOk('launchBrowserResearch', result);
    if (providerFailure) return providerFailure;
    const launched = hasAnyPath(result, ['jobId', 'job_id', 'job.id', 'answer', 'research.id']);
    if (launched) return qaPass('launchBrowserResearch', { jobProof: true });
    return qaFail('launchBrowserResearch', 'missing_job_proof');
  },

  addPbkMemory(result = {}) {
    const providerFailure = validateProviderOk('addPbkMemory', result);
    if (providerFailure) return providerFailure;
    const stored = hasAnyPath(result, ['memoryId', 'memory_id', 'memory.id', 'id'])
      || result.stored === true
      || result.saved === true;
    if (stored) return qaPass('addPbkMemory', { memoryProof: true });
    return qaFail('addPbkMemory', 'missing_memory_proof');
  },

  rememberPersonalFact(result = {}) {
    return QA_VALIDATORS.addPbkMemory(result);
  },

  transferAgentSkill(result = {}) {
    const providerFailure = validateProviderOk('transferAgentSkill', result);
    if (providerFailure) return providerFailure;
    const transferred = hasAnyPath(result, ['transferId', 'transfer_id', 'id'])
      || result.transferred === true
      || result.ok === true;
    if (transferred) return qaPass('transferAgentSkill', { transferProof: true });
    return qaFail('transferAgentSkill', 'missing_transfer_proof');
  },

  pbk_transfer_agent_skill(result = {}) {
    return QA_VALIDATORS.transferAgentSkill(result);
  },

  listAgents(result = {}) {
    const providerFailure = validateProviderOk('listAgents', result);
    if (providerFailure) return providerFailure;
    if (Array.isArray(result.agents)) return qaPass('listAgents', { count: result.agents.length });
    if (result.ok === true) return qaPass('listAgents', { empty: true });
    return qaFail('listAgents', 'missing_agent_list');
  },

  pbk_list_agents(result = {}) {
    return QA_VALIDATORS.listAgents(result);
  },

  getBrainState(result = {}) {
    const providerFailure = validateProviderOk('getBrainState', result);
    if (providerFailure) return providerFailure;
    const hasReadableOutput = hasAnyPath(result, [
      'answer',
      'summary',
      'readableSummary',
      'state.status.agent',
      'brainDocs',
      'docs',
    ]);
    if (hasReadableOutput || result.ok === true) {
      return qaPass('getBrainState', { readOnly: true, grounded: hasReadableOutput });
    }
    return qaFail('getBrainState', 'missing_brain_state_output');
  },

  consultNurtureAgent(result = {}) {
    const providerFailure = validateProviderOk('consultNurtureAgent', result);
    if (providerFailure) return providerFailure;
    if (hasNurtureRecommendation(result)) return qaPass('consultNurtureAgent', { recommendationProof: true });
    return qaFail('consultNurtureAgent', 'missing_nurture_recommendation');
  },

  startNurtureSequence(result = {}) {
    const providerFailure = validateProviderOk('startNurtureSequence', result);
    if (providerFailure) return providerFailure;
    const proofId = getFirstPathValue(result, [
      'approvalId',
      'approval_id',
      'approval.id',
      'nurtureInstance.id',
      'instance.id',
      'instanceId',
      'sequenceId',
      'sequence.id',
      'id',
    ]);
    const status = String(result.status || result.result || result.approval?.status || result.instance?.status || '').toLowerCase();
    const queued = /approval|queued|scheduled|created|pending|active|started/.test(status);
    if (hasValue(proofId) && queued) return qaPass('startNurtureSequence', { sequenceProof: true, status });
    return qaFail('startNurtureSequence', 'missing_nurture_sequence_proof', { status });
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
  metricSink = recordQaValidationMetric,
  auditSink = null,
  auditFallbackSink = writeQaAuditFallback,
  approvalSink = null,
  source = 'pbk-bridge',
} = {}) {
  const qa = validateQaToolResult(toolName, result);
  let metricError = null;
  try {
    await metricSink({
      toolName,
      ok: qa.ok === true || qa.skipped === true,
      reason: qa.reason || '',
      source,
    });
  } catch (error) {
    metricError = error;
  }
  const auditRecord = buildQaAuditRecord({
    toolName,
    params,
    result,
    qa,
    retryCount,
    source,
  });
  let auditFallback = null;
  if (metricError) {
    auditFallback = await writeAuditFallback(auditFallbackSink, auditRecord, metricError.message || metricError);
  }

  if (typeof auditSink === 'function') {
    try {
      await auditSink(auditRecord);
    } catch (error) {
      auditFallback = await writeAuditFallback(auditFallbackSink, auditRecord, error.message || error);
    }
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
    auditFallback,
    result,
  };
}

export const qaToolValidators = Object.freeze(Object.keys(QA_VALIDATORS));
