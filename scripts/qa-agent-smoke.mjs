import assert from 'node:assert/strict';
import {
  buildQaAuditRecord,
  sanitizeQaPayload,
  validateQaToolResult,
  validateToolCallWithQa,
} from './qa-agent.mjs';

function assertRedacted(value, label) {
  assert.equal(value, '[REDACTED]', `${label} should be redacted before QA audit persistence.`);
}

async function main() {
  const sentContract = validateQaToolResult('sendDocuSign', {
    ok: true,
    docusign: { configured: true },
    envelopeId: 'env_123',
    status: 'sent',
  });
  assert.equal(sentContract.ok, true, 'sendDocuSign with an envelope id should pass QA.');
  assert.equal(sentContract.skipped, false, 'known provider tools should not be marked skipped.');

  const fakeContract = validateQaToolResult('sendDocuSign', {
    ok: true,
    envelopeId: 'test-123',
    status: 'sent',
  });
  assert.equal(fakeContract.ok, false, 'sendDocuSign should reject obviously fake envelope ids.');
  assert.match(fakeContract.reason, /invalid_delivery_proof/);

  const brokenContract = validateQaToolResult('sendDocuSign', {
    ok: true,
    status: 'drafted',
  });
  assert.equal(brokenContract.ok, false, 'sendDocuSign without delivery proof should fail QA.');
  assert.match(brokenContract.reason, /missing_delivery_proof|provider_reported_failure/);

  const brainState = validateQaToolResult('getBrainState', { ok: true, answer: 'PBK brain is available.' });
  assert.equal(brainState.ok, true, 'getBrainState should pass as a known read-only tool.');
  assert.equal(brainState.skipped, false, 'getBrainState should have a registered QA validator.');

  const nurtureConsult = validateQaToolResult('consultNurtureAgent', {
    ok: true,
    recommendation: {
      channel: 'sms',
      urgency: 'today',
      reason: 'Seller replied recently.',
    },
  });
  assert.equal(nurtureConsult.ok, true, 'consultNurtureAgent should have a semantic QA validator.');

  const brokenNurtureStart = validateQaToolResult('startNurtureSequence', {
    ok: true,
    status: 'started',
  });
  assert.equal(brokenNurtureStart.ok, false, 'startNurtureSequence should fail QA without approval or sequence proof.');

  const originalWarn = console.warn;
  let unknown;
  try {
    console.warn = () => {};
    unknown = validateQaToolResult('unregisteredReadOnlyTool', { ok: true });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(unknown.ok, true, 'unknown/read-only tools should not block the bridge.');
  assert.equal(unknown.skipped, true, 'unknown/read-only tools should be marked skipped.');

  const redacted = sanitizeQaPayload({
    phone: '+15551234567',
    apiKey: 'secret-key',
    nested: {
      Authorization: 'Bearer nope',
      safe: 'keep-me',
      envVarValue: 'also-secret',
    },
  });
  assert.equal(redacted.phone, '+15551234567');
  assertRedacted(redacted.apiKey, 'apiKey');
  assertRedacted(redacted.nested.Authorization, 'Authorization');
  assertRedacted(redacted.nested.envVarValue, 'envVarValue');
  assert.equal(redacted.nested.safe, 'keep-me');

  const auditRecord = buildQaAuditRecord({
    toolName: 'telnyx_sms',
    params: { to: '+15551234567', PBK_BRIDGE_API_KEY: 'do-not-store' },
    result: { ok: false, error: 'provider down', authorization: 'bearer token' },
    qa: { ok: false, reason: 'provider_reported_failure', validator: 'telnyx_sms' },
    retryCount: 0,
    source: 'smoke',
  });
  assert.equal(auditRecord.toolName, 'telnyx_sms');
  assert.equal(auditRecord.passed, false);
  assertRedacted(auditRecord.params.PBK_BRIDGE_API_KEY, 'PBK_BRIDGE_API_KEY');
  assertRedacted(auditRecord.result.authorization, 'result authorization');

  const auditEvents = [];
  const approvalEvents = [];
  const qaFailure = await validateToolCallWithQa({
    toolName: 'telnyx_call',
    params: { phone: '+15551234567' },
    result: { ok: true, status: 'queued' },
    auditSink: async (record) => auditEvents.push(record),
    approvalSink: async (approval) => approvalEvents.push(approval),
    source: 'smoke',
  });
  assert.equal(qaFailure.ok, false, 'telnyx_call without call id should fail QA.');
  assert.equal(auditEvents.length, 1, 'failed QA should write exactly one audit record.');
  assert.equal(approvalEvents.length, 1, 'failed provider QA should create an escalation event.');
  assert.equal(approvalEvents[0].type, 'qa_failure');

  const fallbackEvents = [];
  const qaWithMetricFailure = await validateToolCallWithQa({
    toolName: 'telnyx_sms',
    params: { phone: '+15551234567' },
    result: { ok: true, messageId: 'msg_123' },
    metricSink: () => {
      throw new Error('observability unavailable');
    },
    auditFallbackSink: async (record) => fallbackEvents.push(record),
    source: 'smoke-metric-fallback',
  });
  assert.equal(qaWithMetricFailure.ok, true, 'QA should still return validation results if observability recording fails.');
  assert.equal(fallbackEvents.length, 1, 'QA should write an audit fallback when observability recording fails.');
  assert.match(fallbackEvents[0].fallbackReason, /observability unavailable/);

  console.log('QA agent smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
