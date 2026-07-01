import { orchestrateAvaTurn } from './ava-turn-orchestrator.mjs';

const PROVIDER_WRITE_TO_ACTION_TYPE = Object.freeze({
  telnyx_call: 'call.start',
  telnyx_sms: 'sms.send',
  sendColdEmail: 'email.send',
  prepare_and_send_contract: 'docusign.send',
  startNurtureSequence: 'campaign.launch',
});

function cleanString(value = '') {
  return String(value || '').trim();
}

function lower(value = '') {
  return cleanString(value).toLowerCase();
}

function pickLead(state = {}, leadId = '', toolParams = {}) {
  const candidates = Array.isArray(state.leadImports) ? state.leadImports : [];
  const cleanLeadId = cleanString(leadId || toolParams.leadId || toolParams.lead_id);
  const address = lower(toolParams.address || toolParams.propertyAddress);
  const query = lower(toolParams.query);
  return (
    candidates.find((lead) => {
      const ids = [lead.id, lead.leadId, lead.lead_id].map(cleanString).filter(Boolean);
      if (cleanLeadId && ids.includes(cleanLeadId)) return true;
      const haystack = lower(
        [lead.leadName, lead.name, lead.sellerName, lead.address, lead.phone, lead.email]
          .filter(Boolean)
          .join(' ')
      );
      return Boolean((address && haystack.includes(address)) || (query && haystack.includes(query)));
    }) || null
  );
}

function inferActionType(toolName = '', assistantPlan = {}) {
  if (PROVIDER_WRITE_TO_ACTION_TYPE[toolName]) return PROVIDER_WRITE_TO_ACTION_TYPE[toolName];
  if (toolName === 'addPbkMemory') return 'lead.note';
  if (assistantPlan.action === 'approval_required') return 'provider.write';
  return '';
}

function inferMissionStatus({ assistantPlan = {}, toolResult = null, orchestration = {} }) {
  const action = lower(assistantPlan.action);
  const result = lower(toolResult?.result || toolResult?.outcome || toolResult?.status);
  const decision = lower(orchestration.actionDecision?.decision);
  if (action === 'mission_intake') return 'planning';
  if (action === 'approval_required' || result.includes('approval') || result.includes('queued')) {
    return 'waiting_on_approval';
  }
  if (decision === 'blocked' || orchestration.guard?.result === 'blocked') return 'blocked';
  if (toolResult?.ok === false) return 'needs_review';
  return 'completed';
}

function stableHash(value = '') {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function fingerprintParams(params = {}) {
  if (!params || typeof params !== 'object') return '';
  const safe = {};
  for (const key of ['leadId', 'lead_id', 'address', 'propertyAddress', 'phone', 'to', 'email', 'recipientEmail']) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      safe[key] = String(params[key]).slice(0, 160);
    }
  }
  return stableHash(JSON.stringify(safe));
}

function buildAvaControlEnvelope({
  input = {},
  assistantPlan = {},
  toolName = '',
  actionType = '',
  providerWrite = false,
  status = '',
  orchestration = {},
  controllerStage = 'final',
}) {
  const guardResult = lower(orchestration.guard?.result);
  const guardBlocked = orchestration.guard?.blocked === true || guardResult === 'blocked' || guardResult === 'handoff';
  const actionDecision = orchestration.actionDecision || {};
  const orchestratorDecision = lower(actionDecision.decision);
  const missingGoal = !cleanString(input.text);
  let decision = 'allow';
  let reason = actionDecision.reason || 'Ava controller allowed the next step.';

  if (missingGoal) {
    decision = 'ask_user';
    reason = 'Ava needs a clear operator request before choosing a tool or action.';
  } else if (guardBlocked) {
    decision = 'blocked';
    reason = actionDecision.reason || orchestration.guard?.reasons?.[0] || 'Ava blocked this step for safety.';
  } else if (orchestratorDecision === 'blocked') {
    decision = 'blocked';
    reason = actionDecision.reason || 'Ava blocked this step for safety.';
  } else if (
    providerWrite ||
    assistantPlan.action === 'approval_required' ||
    status === 'waiting_on_approval' ||
    actionDecision.approvalRequired === true
  ) {
    decision = 'approval_required';
    reason = actionDecision.reason || 'Provider-write actions must move through the approval rail before execution.';
  }

  const approvalRequired = decision === 'approval_required';
  const authorizesExecution = decision === 'allow';
  const proofRequirements = [];
  if (decision === 'allow') proofRequirements.push('mission_trace');
  if (approvalRequired) proofRequirements.push('approval_receipt');
  if (providerWrite) proofRequirements.push('provider_result');
  if (decision === 'blocked') proofRequirements.push('blocked_reason');
  if (decision === 'ask_user') proofRequirements.push('operator_clarification');

  const paramsFingerprint = fingerprintParams(assistantPlan.toolPlan?.params || {});
  const decisionSeed = [
    input.sessionId || '',
    controllerStage,
    input.text || '',
    assistantPlan.action || '',
    toolName,
    paramsFingerprint,
    decision,
  ].join('|');

  return {
    schema: 'pbk.ava.control_envelope.v1',
    controllerDecisionId: `ava-control-${stableHash(decisionSeed)}`,
    controllerStage,
    source: input.source || 'ava-assistant-chat',
    sessionId: input.sessionId || '',
    leadId: input.leadId || '',
    intent: input.assistantIntent?.intent || assistantPlan.usedIntent || '',
    action: assistantPlan.action || 'answered',
    decision,
    authorizesExecution,
    approvalRequired,
    providerWritesBlocked: providerWrite && !authorizesExecution,
    reason,
    exactAction: {
      toolName,
      actionType,
      providerWrite,
      paramsFingerprint,
    },
    proofRequirements,
  };
}

function buildMissionSteps({ text, assistantPlan = {}, toolResult = null, orchestration = {} }) {
  const toolName = cleanString(assistantPlan.toolPlan?.toolName);
  const executionStatus = toolResult?.ok === false ? 'needs_review' : 'completed';
  const approvalStatus =
    assistantPlan.action === 'approval_required' ? 'waiting_on_approval' : executionStatus;
  return [
    {
      id: 'understand',
      label: 'Understand the request',
      status: text ? 'completed' : 'needs_input',
      summary: cleanString(text).slice(0, 240),
    },
    {
      id: 'orchestrate',
      label: 'Load memory and choose the safest next move',
      status: orchestration.ok ? 'completed' : 'needs_review',
      summary: orchestration.turnDecision?.reason || orchestration.guard?.result || 'orchestrated',
    },
    {
      id: 'plan',
      label: toolName ? `Plan ${toolName}` : 'Plan reply',
      status: assistantPlan.action ? 'completed' : 'needs_review',
      summary: assistantPlan.action || 'answered',
    },
    {
      id: 'execute',
      label: assistantPlan.action === 'approval_required' ? 'Prepare approval' : 'Return result',
      status: approvalStatus,
      summary:
        toolResult?.result ||
        toolResult?.outcome ||
        toolResult?.status ||
        assistantPlan.action ||
        'answered',
    },
  ];
}

function compactOrchestration(orchestration = {}) {
  return {
    ok: Boolean(orchestration.ok),
    result: orchestration.result || '',
    turnDecision: orchestration.turnDecision || null,
    actionDecision: orchestration.actionDecision || null,
    guard: orchestration.guard
      ? {
          result: orchestration.guard.result || '',
          reasons: orchestration.guard.reasons || [],
          repeatedQuestionBlocked: Boolean(orchestration.guard.repeatedQuestionBlocked),
        }
      : null,
    memory: orchestration.memory || null,
    workingMemory: orchestration.workingMemory
      ? {
          brief: orchestration.workingMemory.brief || '',
          memories: Array.isArray(orchestration.workingMemory.memories)
            ? orchestration.workingMemory.memories.slice(0, 5)
            : [],
        }
      : null,
    activeSkill: orchestration.activeSkill || null,
    confidence: orchestration.confidence || null,
    state: orchestration.state || null,
    unison: orchestration.unison || null,
  };
}

export async function runAvaMissionController(input = {}) {
  const assistantPlan = input.assistantPlan || {};
  const controllerStage = cleanString(input.controllerStage || input.controller_stage || 'final') || 'final';
  const toolPlan = assistantPlan.toolPlan || {};
  const toolName = cleanString(toolPlan.toolName);
  const lead = pickLead(input.state || {}, input.leadId, toolPlan.params || {});
  const actionType = inferActionType(toolName, assistantPlan);
  const providerWrite = Boolean(toolPlan.providerWrite || PROVIDER_WRITE_TO_ACTION_TYPE[toolName]);
  const orchestration = orchestrateAvaTurn({
    sessionId: input.sessionId,
    query: input.text,
    text: input.text,
    transcript: input.text,
    leadId: input.leadId || lead?.id || lead?.leadId || '',
    lead: lead || {
      id: input.leadId || '',
      address: toolPlan.params?.address || '',
    },
    history: input.assistantSession?.history || input.messages || [],
    memories: input.memories || [],
    availableTools: toolName ? [toolName] : [],
    proposedActionType: actionType,
    actionSource: input.source || 'ava-assistant-chat',
    actionConfidence: providerWrite ? 0.75 : 0.9,
    evidence: {
      intent: input.assistantIntent?.intent || assistantPlan.usedIntent || '',
      toolName,
      hasToolResult: Boolean(input.toolResult),
    },
    approvalState: assistantPlan.action === 'approval_required' ? 'pending' : '',
    safetyPassed: input.safety?.ok === true || input.qa?.ok === true || providerWrite === false,
    candidateAnswer: input.answer || assistantPlan.answer || '',
  });
  const compact = compactOrchestration(orchestration);
  const status = inferMissionStatus({ assistantPlan, toolResult: input.toolResult, orchestration });
  const controlEnvelope = buildAvaControlEnvelope({
    input,
    assistantPlan,
    toolName,
    actionType,
    providerWrite,
    status,
    orchestration,
    controllerStage,
  });
  const mission = {
    schema: 'pbk.ava.mission_controller.v1',
    id: `${input.sessionId || 'ava-session'}:${Date.now()}`,
    sessionId: input.sessionId || '',
    leadId: input.leadId || lead?.id || lead?.leadId || '',
    source: input.source || 'ava-assistant-chat',
    controllerStage,
    goal: cleanString(input.text).slice(0, 280),
    status,
    approvalRequired: status === 'waiting_on_approval' || orchestration.actionDecision?.approvalRequired === true,
    currentStep: status === 'waiting_on_approval' ? 'execute' : 'complete',
    nextAction: {
      type: assistantPlan.action || 'answered',
      toolName,
      providerWrite,
      requiresApproval: status === 'waiting_on_approval',
    },
    steps: buildMissionSteps({
      text: input.text,
      assistantPlan,
      toolResult: input.toolResult,
      orchestration,
    }),
  };
  const trace = {
    schema: 'pbk.ava.mission_trace.v1',
    controllerPath: 'orchestrateAvaTurn',
    controllerStage,
    source: input.source || 'ava-assistant-chat',
    intent: input.assistantIntent?.intent || assistantPlan.usedIntent || '',
    action: assistantPlan.action || 'answered',
    toolName,
    actionPolicy: {
      providerWritesBlocked: controlEnvelope.providerWritesBlocked,
      approvalRequired: controlEnvelope.approvalRequired,
      decision: controlEnvelope.decision,
      reason: controlEnvelope.reason,
    },
    controlEnvelope,
    turnDecision: compact.turnDecision,
    actionDecision: compact.actionDecision,
    guard: compact.guard,
    memory: compact.memory,
    workingMemory: compact.workingMemory,
    activeSkill: compact.activeSkill,
    confidence: compact.confidence,
    state: compact.state,
    unison: compact.unison,
  };

  return {
    ok: true,
    result: 'ava_mission_controller_ready',
    mission,
    trace,
    controlEnvelope,
    orchestration: compact,
  };
}
