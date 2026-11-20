import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import { controlledWorkflowOrder, controlledWorkflowInput, controlledWorkflowLink, controlledOutputDigest,
  verifyControlledWorkflowLink, runControlledAgentWorkflow } from './controlled-agent-workflow.mjs';
import { workflowTestOutputs } from './controlled-workflow-test-fixtures.mjs';

const fixture = { leadId: 'fixture-lead', callId: 'fixture-call', transcript: 'Seller: I am moving in thirty days.',
  bant: { budget: '100000', authority: 'owner', need: 'moving', timeline: '30 days', urgency: 'deadline' } };

test('all eleven consume the independently read predecessor, including QA, nurture and learning', async () => {
  const outputs = workflowTestOutputs(fixture);
  const stored = new Map();
  const calls = [];
  await runControlledAgentWorkflow({ fixture,
    readPrevious: async id => { calls.push(`read:${id}`); return structuredClone(stored.get(id)); },
    execute: async (id, input, link) => {
      calls.push(id);
      const previous = link.sequence ? stored.get(controlledWorkflowOrder[link.sequence - 1]) : null;
      assert(verifyControlledWorkflowLink(id, fixture, previous, link, input));
      if (id === 'qa-agent') assert.equal(JSON.stringify(input.result), JSON.stringify(outputs['nurture-agent']));
      if (id === 'hermes') assert.equal(JSON.stringify(input.stoppingResult), JSON.stringify(outputs['research-orchestrator']));
      const result = { agentId: id, workOrderId: `work-${id}`, output: outputs[id] };
      stored.set(id, structuredClone(result));
      return result;
    } });
  assert.deepEqual(calls.filter(id => !id.startsWith('read:')), [...controlledWorkflowOrder]);
  assert.equal(calls.filter(id => id.startsWith('read:')).length, 10);
});

for (const failedAgent of controlledWorkflowOrder) {
  test(`failure at ${failedAgent} prevents every downstream invocation`, async () => {
    const outputs = workflowTestOutputs(fixture);
    const stored = new Map();
    const called = [];
    await assert.rejects(runControlledAgentWorkflow({ fixture,
      readPrevious: async id => stored.get(id),
      execute: async id => {
        called.push(id);
        const result = { agentId: id, workOrderId: `work-${id}`, output: id === failedAgent ? { ok: false } : outputs[id] };
        stored.set(id, result);
        return result;
      } }), /controlled_workflow_handler_failed/);
    assert.deepEqual(called, controlledWorkflowOrder.slice(0, controlledWorkflowOrder.indexOf(failedAgent) + 1));
  });
}

test('missing or corrupted persisted predecessor blocks the next handler', async () => {
  let invoked = 0;
  await assert.rejects(runControlledAgentWorkflow({ fixture, readPrevious: async () => null,
    execute: async id => { invoked++; return { workOrderId: 'first', output: workflowTestOutputs(fixture)[id] }; } }), /dependency_failed/);
  assert.equal(invoked, 1);
});

test('canonical digest survives JSONB key order but rejects output or consumed-input tampering', () => {
  const previous = { agentId: 'max', workOrderId: 'max-task', output: workflowTestOutputs(fixture).max };
  const link = controlledWorkflowLink('script-rotator', fixture, previous);
  assert.equal(controlledOutputDigest({ a: 1, b: { c: 2, d: 3 } }), controlledOutputDigest({ b: { d: 3, c: 2 }, a: 1 }));
  assert(verifyControlledWorkflowLink('script-rotator', fixture, previous, link, link.consumedInput));
  const changed = structuredClone(previous);
  changed.output.closing.nextBestPhrase = 'Different actual advice';
  assert.notDeepEqual(controlledWorkflowInput('script-rotator', fixture, changed), link.consumedInput);
  assert.equal(verifyControlledWorkflowLink('script-rotator', fixture, changed, link, link.consumedInput), false);
  assert.equal(verifyControlledWorkflowLink('script-rotator', fixture, previous, link, { query: 'independent input' }), false);
});

test('each of ten handoffs changes consumed business input when predecessor business output changes', () => {
  const outputs = workflowTestOutputs(fixture);
  const changes = {
    'bant-enforcer': output => { output.bant.budget = '200000'; },
    max: output => { output.closing.nextBestPhrase = 'Clarify the seller timeline.'; },
    'script-rotator': output => { output.nextBestPhrase = 'Please explain the estate process.'; },
    'prosody-tuner': output => { output.prosody.speed = 0.8; },
    'call-analyzer': output => { output.analyses[0].score = 25; },
    'nurture-agent': output => { output.recommendation.channel = 'email'; },
    'qa-agent': output => { output.result = { result: 'recommendation', recommendation: { channel: 'email' } }; },
    rex: output => { output.answer = 'Clarify estate executor authority.'; },
    ava: output => { output.response.answer = 'The seller requested an attorney.'; },
    'research-orchestrator': output => { output.intervention = 'Honor the stop request and retain the compliance reason.'; },
  };
  for (let index = 1; index < controlledWorkflowOrder.length; index++) {
    const agentId = controlledWorkflowOrder[index];
    const predecessorAgentId = controlledWorkflowOrder[index - 1];
    const previous = { agentId: predecessorAgentId, output: JSON.parse(JSON.stringify(outputs[predecessorAgentId])) };
    const before = JSON.stringify(controlledWorkflowInput(agentId, fixture, previous));
    changes[predecessorAgentId](previous.output);
    const after = controlledWorkflowInput(agentId, fixture, previous);
    assert.notEqual(JSON.stringify(after), before, `${predecessorAgentId}->${agentId}: decorative dependency`);
  }
});
