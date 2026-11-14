import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { runAvaMissionController } from './ava-mission-controller.mjs';

const input = {
  sessionId: 'controlled-approval-summary-test', text: 'Show pending approvals.',
  assistantIntent: { intent: 'approval_status' },
  assistantPlan: { action: 'tool_plan', toolPlan: { toolName: 'getApprovals', providerWrite: false, params: {} } },
  toolResult: { ok: true, result: 'approval_summary', approvals: [] },
  answer: 'There are no pending approvals.',
};

test('successful read-only approval summary is completed, not a request to approve a write', async () => {
  const result = await runAvaMissionController(input);
  assert.equal(result.mission.status, 'completed');
  assert.equal(result.controlEnvelope.decision, 'allow');
});

for (const result of ['approval_required', 'queued_for_approval', 'pending_approval']) {
  test(`actual ${result} still waits`, async () => {
    const mission = await runAvaMissionController({ ...input, toolResult: { ok: true, result } });
    assert.equal(mission.mission.status, 'waiting_on_approval');
    assert.equal(mission.controlEnvelope.authorizesExecution, false);
  });
}

test('explicit approval action and provider-write intent cannot use the read exception', async () => {
  for (const assistantPlan of [
    { ...input.assistantPlan, action: 'approval_required' },
    { ...input.assistantPlan, toolPlan: { ...input.assistantPlan.toolPlan, approvalRequired: true } },
    { ...input.assistantPlan, toolPlan: { ...input.assistantPlan.toolPlan, providerWrite: true } },
    { ...input.assistantPlan, toolPlan: { toolName: 'telnyx_sms', providerWrite: true, params: {} } },
  ]) {
    const result = await runAvaMissionController({ ...input, assistantPlan });
    assert.equal(result.mission.status, 'waiting_on_approval');
    assert.equal(result.controlEnvelope.authorizesExecution, false);
  }
});

test('an explicit tool-result approval requirement still waits', async () => {
  const result = await runAvaMissionController({ ...input, toolResult: { ...input.toolResult, approvalRequired: true } });
  assert.equal(result.mission.status, 'waiting_on_approval');
  assert.equal(result.controlEnvelope.authorizesExecution, false);
});
