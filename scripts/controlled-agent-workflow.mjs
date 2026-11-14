import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isAgentHandlerCompletion } from './agent-fleet-measurement.mjs';

export const controlledWorkflowOrder = Object.freeze(['bant-enforcer', 'max', 'script-rotator',
  'prosody-tuner', 'call-analyzer', 'nurture-agent', 'qa-agent', 'rex', 'ava', 'research-orchestrator', 'hermes']);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const controlledOutputDigest = output => createHash('sha256').update(JSON.stringify(canonical(output))).digest('hex');

// These are handler-consumed fields, not decorative dependency metadata.
export function controlledWorkflowInput(agentId, fixture, previous) {
  const index = controlledWorkflowOrder.indexOf(agentId);
  if (index < 0) throw new Error('controlled_workflow_agent_invalid');
  if (index && (!previous || previous.agentId !== controlledWorkflowOrder[index - 1]
    || !isAgentHandlerCompletion(previous.agentId, previous.output))) throw new Error('controlled_workflow_dependency_failed');
  const output = previous?.output;
  switch (agentId) {
    case 'bant-enforcer': return { transcript: fixture.transcript, bant: fixture.bant };
    case 'max': return { bant: output.bant, query: `Explain a cash sale for this qualified seller: ${JSON.stringify(output.bant)}` };
    case 'script-rotator': return { query: `Adapt this closing advice: ${output.closing.nextBestPhrase}` };
    case 'prosody-tuner': return { text: output.nextBestPhrase };
    case 'call-analyzer': return { limit: 1, transcript: `${fixture.transcript}\nAva delivery: ${JSON.stringify(output.prosody)}` };
    case 'nurture-agent': return { score: output.analyses[0].score,
      stage: output.analyses[0].score >= 80 ? 'hot' : output.analyses[0].score >= 60 ? 'warm' : 'cold' };
    case 'qa-agent': return { toolName: 'consultNurtureAgent', params: { leadId: fixture.leadId, score: output.lead.score }, result: output };
    case 'rex': return { query: `Explain the controlled seller relocation deadline after QA ${output.qa.validator}: ${JSON.stringify(output.result)}`, conversational: false };
    case 'ava': return { query: output.answer, command: output.answer, transcript: output.answer };
    case 'research-orchestrator': return { query: 'Evaluate safety and stop risk.', transcript: 'Seller: Stop calling and remove me.', lastAvaMove: output.response.answer || output.response.response || output.response.text };
    case 'hermes': return { action: 'analyze_patterns', transcript: `Safety outcome: ${output.result}. ${output.intervention}\nFlags: ${output.flags.join(', ')}. Learn the no-contact handoff pattern.`, stoppingResult: output };
  }
}

export function controlledWorkflowLink(agentId, fixture, previous) {
  return { sequence: controlledWorkflowOrder.indexOf(agentId), predecessorAgentId: previous?.agentId || null,
    predecessorWorkOrderId: previous?.workOrderId || null,
    predecessorOutputDigest: previous ? controlledOutputDigest(previous.output) : null,
    consumedInput: controlledWorkflowInput(agentId, fixture, previous) };
}

export async function runControlledAgentWorkflow({ fixture, execute, readPrevious }) {
  let previous = null;
  for (const agentId of controlledWorkflowOrder) {
    // The next handler only sees the independent PG readback, never an unpersisted return value.
    if (previous) previous = await readPrevious(previous.agentId);
    const link = controlledWorkflowLink(agentId, fixture, previous);
    const result = await execute(agentId, link.consumedInput, link);
    if (!isAgentHandlerCompletion(agentId, result?.output) || !result?.workOrderId)
      throw new Error(`controlled_workflow_handler_failed:${agentId}`);
    previous = { agentId, ...result };
  }
}

export function verifyControlledWorkflowLink(agentId, fixture, previous, link, payload) {
  try {
    const expected = controlledWorkflowLink(agentId, fixture, previous);
    return isDeepStrictEqual(link, expected) && Object.entries(expected.consumedInput)
      .every(([key, value]) => isDeepStrictEqual(payload?.[key], value));
  } catch { return false; }
}
