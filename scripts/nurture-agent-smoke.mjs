import assert from 'node:assert/strict';

import {
  buildNurtureComplianceHealth,
  executeApprovedSequence,
  renderNurtureMessage,
  requireNurturePool,
  shouldDeferNurtureSend,
} from './nurture-agent.mjs';

assert.throws(
  () => requireNurturePool(null),
  /PBK_DATABASE_URL\/DATABASE_URL is required/i,
  'Nurture agent should fail loudly when Postgres is not configured.',
);

const personalized = await renderNurtureMessage(
  'Hey {name}, still interested in {address}?',
  { first_name: 'Diane', address: '123 Oak St', motivation_score: 72 },
  {
    useLLMPersonalization: true,
    personalizeMessage: async ({ draft, lead }) => `${draft} Motivation score: ${lead.motivation_score}.`,
  },
);
assert.equal(
  personalized,
  'Hey Diane, still interested in 123 Oak St? Motivation score: 72.',
  'Optional LLM personalization should be able to refine the rendered template.',
);

const quietDecision = shouldDeferNurtureSend(
  { now: new Date('2026-06-02T22:30:00-07:00'), sentToday: 0 },
  { quietHours: { startHour: 21, endHour: 8 }, maxPerDay: 3 },
);
assert.equal(quietDecision.defer, true);
assert.equal(quietDecision.reason, 'quiet_hours');
assert(quietDecision.nextAllowedAt instanceof Date, 'Quiet-hour deferrals should include the next allowed send time.');

const throttleDecision = shouldDeferNurtureSend(
  { now: new Date('2026-06-02T12:00:00-07:00'), sentToday: 3 },
  { quietHours: { startHour: 21, endHour: 8 }, maxPerDay: 3 },
);
assert.equal(throttleDecision.defer, true);
assert.equal(throttleDecision.reason, 'daily_throttle');

const compliance = buildNurtureComplianceHealth({});
assert.equal(compliance.ok, false);
assert.equal(compliance.stopReplyWebhookConfigured, false);
assert(
  compliance.warnings.some((warning) => /telnyx inbound webhook/i.test(warning)),
  'Compliance health should warn when Telnyx inbound STOP webhook routing is not configured.',
);

const approved = await executeApprovedSequence(
  {
    async query(sql, params = []) {
      if (/SELECT ni\.\*, nst\.steps/is.test(sql)) {
        return {
          rows: [
            {
              id: params[0],
              lead_id: 'lead-1',
              current_step: 0,
              status: 'active',
              steps: [{ channel: 'sms', template: 'Hi {name}', delay_hours: 0 }],
            },
          ],
        };
      }
      if (/SELECT id, lead_name, first_name, email, phone, address/is.test(sql)) {
        return { rows: [{ id: 'lead-1', first_name: 'Diane', phone: '+15555550123', email: '', address: '123 Oak St' }] };
      }
      return { rows: [] };
    },
  },
  { nurtureInstanceId: 'nurture-1', approvalId: 'approval-1' },
  {
    ensureSchema: false,
    skipPolicy: true,
    invokeTool: async () => ({ ok: true, result: 'sent' }),
  },
);
assert.equal(approved.ok, true);
assert.equal(approved.approvalId, 'approval-1');
assert.equal(approved.result, 'approved_sequence_executed');

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'nurture_agent_smoke_passed',
      quietReason: quietDecision.reason,
      complianceWarnings: compliance.warnings.length,
    },
    null,
    2,
  ),
);
