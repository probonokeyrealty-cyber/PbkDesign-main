import { calibrateAvaConfidence } from './ava-confidence.mjs';
import { selectGovernedAvaSkill } from './ava-governed-skill-router.mjs';
import { ClosingStateMachine, PHASE_ORDER, Phase } from './ava-state-machine.mjs';
import { guardAvaResponse } from './ava-response-guard.mjs';
import { buildAvaWorkingMemory } from './ava-working-memory.mjs';

function normalizePhase(value = '') {
  const phase = String(value || '').trim().toLowerCase();
  return PHASE_ORDER.includes(phase) ? phase : Phase.TRUST;
}

function normalizeLead(input = {}) {
  const lead = input.lead || input.context || {};
  return {
    id: lead.id || lead.leadId || lead.lead_id || input.leadId || input.lead_id || '',
    name: lead.name || lead.leadName || lead.sellerName || '',
    address: lead.address || lead.propertyAddress || lead.property?.address || '',
    phone: lead.phone || '',
    email: lead.email || '',
    mao: lead.mao || input.mao || input.context?.mao,
  };
}

function buildConfidence(input = {}) {
  const provided = input.confidence || input.confidenceCalibration;
  if (provided?.band && provided?.responseMode) return provided;
  return calibrateAvaConfidence(input.confidenceInput || {});
}

function selectSkill(input = {}) {
  const existing = input.governedSkillSelection || input.skillSelection;
  if (existing?.ok) return existing;
  return selectGovernedAvaSkill({
    skills: input.skills || [],
    transcript: input.transcript || input.query || input.text || '',
    lastObjection: input.lastObjection || input.objectionType || input.objection || '',
    emotion: input.emotion || input.sellerEmotion || '',
    stage: input.stage || input.leadStage || input.phase || '',
    path: input.path || input.selectedPath || input.pathKey || '',
    intent: input.intent || input.sellerIntent || '',
    workspaceId: input.workspaceId || input.workspace_id || 'pbk',
    leadId: input.leadId || input.lead_id || input.lead?.id || input.context?.leadId || '',
    callId: input.callId || input.call_id || input.context?.callId || '',
    campaignId: input.campaignId || input.campaign_id || '',
    sessionId: input.sessionId || input.session_id || input.session?.sessionId || '',
    currentSkillId: input.currentGovernedSkillId || input.session?.activeGovernedSkillId || '',
  });
}

export const AVA_INTELLIGENCE_LAYER_IDS = Object.freeze([
  'reasoning',
  'salesDoctrine',
  'stateMachine',
  'sellerPersona',
  'negotiation',
  'emotion',
  'memory',
  'tools',
  'compliance',
  'skills',
  'coaching',
  'voice',
  'operator',
]);

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function buildAvaIntelligenceUnisonStatus(input = {}, result = {}) {
  const layers = {
    reasoning: Boolean(result.confidence?.revision && result.confidence?.responseMode),
    salesDoctrine: Boolean(
      input.path ||
        input.selectedPath ||
        input.pathKey ||
        input.lastObjection ||
        input.objectionType ||
        input.objection ||
        hasObject(input.propertyAnalysis)
    ),
    stateMachine: Boolean(result.state?.phase && result.turnDecision?.phase),
    sellerPersona: Boolean(
      input.sellerPersona ||
        input.sellerType ||
        input.lead?.sellerPersona ||
        input.lead?.sellerType ||
        input.context?.sellerPersona ||
        input.context?.sellerType
    ),
    negotiation: Boolean(
      hasObject(input.negotiation) ||
        hasObject(input.propertyAnalysis) ||
        Number.isFinite(Number(input.mao ?? input.lead?.mao ?? input.context?.mao))
    ),
    emotion: Boolean(input.emotion || input.sellerEmotion || input.sentiment || input.emotionPolicy),
    memory: Boolean(
      result.workingMemory?.brief &&
        ((result.memory?.episodicMatches ?? 0) > 0 ||
          hasItems(input.memories) ||
          hasObject(input.memory))
    ),
    tools: Boolean(
      hasItems(input.availableTools) ||
        hasObject(input.toolResults) ||
        hasObject(input.toolReadiness) ||
        hasItems(result.activeSkill?.toolAllowlist)
    ),
    compliance: Boolean(result.guard?.result && result.confidence?.providerWrites === 'approval_gated'),
    skills: Boolean(
      result.activeSkill?.id &&
        (result.skillSelection?.result === 'governed_skill_selected' ||
          Boolean(result.skillSelection?.selectedSkill))
    ),
    coaching: Boolean(
      hasItems(input.coachingMemories) ||
        hasItems(input.skillOutcomes) ||
        hasObject(input.callQuality) ||
        hasObject(input.coachingMemory)
    ),
    voice: Boolean(input.voice || input.callId || input.call_id || input.channel === 'voice'),
    operator: Boolean(
      hasObject(input.operator) ||
        hasObject(input.approval) ||
        input.handoff === true ||
        result.guard?.result === 'handoff' ||
        result.confidence?.offerApproval === 'always_required'
    ),
  };
  const missingLayers = AVA_INTELLIGENCE_LAYER_IDS.filter((layer) => layers[layer] !== true);

  return {
    revision: 'ava-intelligence-unison-v1',
    ready: missingLayers.length === 0,
    layers,
    activeLayerCount: AVA_INTELLIGENCE_LAYER_IDS.length - missingLayers.length,
    totalLayerCount: AVA_INTELLIGENCE_LAYER_IDS.length,
    missingLayers,
  };
}

export function orchestrateAvaTurn(input = {}) {
  const phase = normalizePhase(input.phase || input.state?.phase || input.stage);
  const lead = normalizeLead(input);
  const evidence = input.evidence && typeof input.evidence === 'object' ? { ...input.evidence } : {};
  const stateMachine = new ClosingStateMachine(lead.id, input.callId || input.call_id || '', {
    phase,
    evidence,
    history: input.phaseHistory || input.state?.history || [],
  });
  const skillSelection = selectSkill(input);
  const selectedSkill = skillSelection.selectedSkill || null;
  const confidence = buildConfidence(input);
  const workingMemory = buildAvaWorkingMemory({
    phase,
    lead,
    transcript: input.transcript || input.query || input.text || '',
    history: input.history || input.session?.history || [],
    memories: input.memories || [],
    activeSkill: selectedSkill,
    path: input.path || input.selectedPath || input.pathKey || '',
    objection: input.lastObjection || input.objectionType || input.objection || '',
    emotion: input.emotion || input.sellerEmotion || '',
  });
  const guard = guardAvaResponse({
    answer: input.candidateAnswer || input.answer || '',
    transcript: input.transcript || input.query || input.text || '',
    phase,
    evidence,
    mao: input.mao ?? lead.mao,
    previousQuestions: input.previousQuestions || input.questionHistory || [],
    shouldStopContact: input.shouldStopContact === true,
    authorityKnown: input.authorityKnown,
    confidence,
  });
  const nextMoveType =
    guard.result === 'blocked'
      ? 'boundary'
      : guard.result === 'handoff'
        ? 'handoff'
        : selectedSkill
          ? 'seller_reply'
          : confidence.responseMode === 'verify'
            ? 'verification_question'
            : 'seller_reply';

  const result = {
    ok: true,
    result: 'ava_turn_orchestrated',
    answer: guard.answer,
    turnDecision: {
      phase,
      nextMoveType,
      reason:
        guard.reasons[0] ||
        skillSelection.reasonCodes?.[0] ||
        confidence.reasons?.[0] ||
        'seller_safe_response',
      answer: guard.answer,
    },
    activeSkill: selectedSkill
      ? {
          id: selectedSkill.id || selectedSkill.versionId || '',
          versionId: selectedSkill.versionId || '',
          name: selectedSkill.name || '',
          action: skillSelection.action || 'cue',
          reasons: skillSelection.reasonCodes || [],
          matchedTriggers: skillSelection.matchedTriggers || [],
          toolAllowlist: Array.isArray(selectedSkill.toolAllowlist)
            ? selectedSkill.toolAllowlist
            : [],
        }
      : {
          id: '',
          versionId: '',
          name: '',
          action: skillSelection.action || 'none',
          reasons: skillSelection.reasonCodes || [],
          matchedTriggers: [],
          toolAllowlist: [],
        },
    confidence,
    guard,
    memory: {
      episodicMatches: workingMemory.memories.length,
      coachingMatches: (input.coachingMemories || []).length,
      repeatedQuestionBlocked: guard.repeatedQuestionBlocked,
    },
    state: stateMachine.getPhaseMetadata(),
    workingMemory,
    skillSelection,
  };
  result.unison = buildAvaIntelligenceUnisonStatus(input, result);
  return result;
}
