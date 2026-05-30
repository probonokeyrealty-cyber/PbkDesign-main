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

  const brokenContract = validateQaToolResult('sendDocuSign', {
    ok: true,
    status: 'drafted',
  });
  assert.equal(brokenContract.ok, false, 'sendDocuSign without delivery proof should fail QA.');
  assert.match(brokenContract.reason, /missing_delivery_proof|provider_reported_failure/);

  const unknown = validateQaToolResult('getBrainState', { ok: true });
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

  console.log('QA agent smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
