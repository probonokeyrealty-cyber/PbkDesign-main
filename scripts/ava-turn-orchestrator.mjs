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

  return {
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
}
