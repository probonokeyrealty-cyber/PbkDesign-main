export const PBK_INTELLIGENCE_CONTEXT_REVISION = '2026-06-13-intelligence-context-v1';

const REQUIRED_CONTEXT_AGENTS = [
  'ava',
  'rex',
  'qa-agent',
  'script-rotator',
  'prosody-tuner',
  'nurture-agent',
  'call-analyzer',
];

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value = '') {
  return clean(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean))];
}

function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(value || '').trim().startsWith('+')) return `+${digits}`;
  return digits.length >= 7 ? `+${digits}` : '';
}

function normalizeEmail(value = '') {
  const email = lower(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function getLeadId(input = {}) {
  const lead = input.lead || input.leadRecord || {};
  const call = input.call || input.contextCall || {};
  return clean(input.leadId || input.lead_id || lead.id || lead.leadId || call.leadId || call.lead_id);
}

function getCallId(input = {}) {
  const call = input.call || input.contextCall || {};
  return clean(input.callId || input.call_id || call.id || call.callId || call.call_id);
}

function getTranscriptText(input = {}) {
  const transcript = input.transcript || input.query || input.text || input.call?.transcript || '';
  if (Array.isArray(transcript)) {
    return transcript
      .map((turn) => {
        if (typeof turn === 'string') return turn;
        return clean([turn?.speaker || turn?.role || turn?.from, turn?.text || turn?.transcript || turn?.content].filter(Boolean).join(': '));
      })
      .filter(Boolean)
      .join(' ');
  }
  return clean(transcript);
}

function buildIdentity(input = {}) {
  const lead = input.lead || input.leadRecord || {};
  const call = input.call || input.contextCall || {};
  const phone = clean(input.phone || lead.phone || lead.sellerPhone || lead.phoneNumber || call.phone || call.from || call.fromNumber);
  const email = clean(input.email || lead.email || lead.sellerEmail || call.email);
  const duplicateIds = unique([
    ...(Array.isArray(input.duplicateIds) ? input.duplicateIds : []),
    ...(Array.isArray(lead.duplicateIds) ? lead.duplicateIds : []),
    ...(Array.isArray(lead.duplicate_ids) ? lead.duplicate_ids : []),
  ]);
  return {
    leadId: getLeadId(input),
    callId: getCallId(input),
    name: clean(input.name || lead.name || lead.leadName || lead.sellerName || call.leadName || call.sellerName),
    phone,
    email,
    normalizedPhone: normalizePhone(phone),
    normalizedEmail: normalizeEmail(email),
    leadRecord: lead && typeof lead === 'object' ? lead : null,
    duplicateIds,
    ready: Boolean(getLeadId(input) || normalizePhone(phone) || normalizeEmail(email)),
  };
}

function buildCallState(input = {}) {
  const call = input.call || input.contextCall || {};
  const sellerUtterance = getTranscriptText(input);
  return {
    callId: getCallId(input),
    phase: clean(input.phase || call.phase || call.stage || input.turnContract?.phase || 'unknown'),
    sellerUtterance,
    transcriptHistory: asArray(call.transcript || input.transcriptHistory || input.transcript_history),
    sentiment:
      input.sentiment ?? input.sellerSentiment ?? call.sentiment ?? call.sellerSentiment ?? null,
    talkRatio: input.talkRatio ?? input.talk_ratio ?? call.talkRatio ?? call.talk_ratio ?? null,
    live: Boolean(input.live || call.live || call.status === 'active' || call.status === 'in-progress'),
  };
}

function normalizeMemory(input = {}) {
  const memory = input.memory && typeof input.memory === 'object' ? input.memory : {};
  const episodic = asArray(memory.episodic || input.episodicMemory || input.episodic || []);
  const coaching = asArray(memory.coaching || input.coachingMemory || input.coaching || []);
  const vectorResults = asArray(memory.vectorResults || memory.vector_results || input.vectorResults || []);
  const lastRecallAt = memory.lastRecallAt || memory.last_recall_at || input.memoryRecalledAt || null;
  const ready = Boolean(episodic.length || coaching.length || vectorResults.length || lastRecallAt);
  return {
    episodic,
    coaching,
    vectorResults,
    recent: asArray(memory.recent || input.recentMemory || []),
    lastRecallAt: lastRecallAt || (ready ? new Date().toISOString() : null),
    ready,
    stale: Boolean(memory.stale || input.memoryStale),
  };
}

function normalizeSkills(input = {}) {
  const skills = input.skills && typeof input.skills === 'object' ? input.skills : {};
  const active = asArray(skills.active || input.activeSkills || input.skills || [])
    .filter((skill) => skill && typeof skill === 'object')
    .map((skill) => ({
      ...skill,
      id: clean(skill.id || skill.versionId || skill.activationId || skill.name),
      name: clean(skill.name || skill.displayName || skill.slug || skill.id),
      agentId: clean(skill.agentId || skill.agent_id || 'ava') || 'ava',
    }));
  const recentOutcomes = asArray(skills.recentOutcomes || skills.recent_outcomes || input.recentSkillOutcomes || []);
  const confidenceScores = skills.confidenceScores && typeof skills.confidenceScores === 'object'
    ? skills.confidenceScores
    : Object.fromEntries(
        active.map((skill) => [
          skill.id || skill.name,
          Number.isFinite(Number(skill.confidence)) ? Number(skill.confidence) : skill.status === 'active' ? 100 : 0,
        ])
      );
  return {
    active,
    recentOutcomes,
    confidenceScores,
    ready: Boolean(active.length),
    stale: Boolean(skills.stale || input.skillsStale),
  };
}

function normalizeTurnContract(input = {}) {
  const turnContract = input.turnContract && typeof input.turnContract === 'object' ? input.turnContract : {};
  const activeSkill = turnContract.activeSkill || input.activeSkill || {};
  const allowedTools = unique([
    ...(Array.isArray(turnContract.allowedTools) ? turnContract.allowedTools : []),
    ...(Array.isArray(input.allowedTools) ? input.allowedTools : []),
  ]);
  return {
    ok: turnContract.ok !== false,
    revision: clean(turnContract.revision || ''),
    intent: clean(turnContract.intent || input.intent || 'unknown'),
    objection: clean(turnContract.objection || input.objection || ''),
    phase: clean(turnContract.phase || input.phase || ''),
    knownFacts: turnContract.knownFacts && typeof turnContract.knownFacts === 'object' ? turnContract.knownFacts : {},
    missingFacts: asArray(turnContract.missingFacts || input.missingFacts || []),
    nextBestQuestion: clean(turnContract.nextBestQuestion || input.nextBestQuestion || ''),
    nextBestQuestionCategory: clean(turnContract.nextBestQuestionCategory || input.nextBestQuestionCategory || ''),
    forbiddenRepeats: unique(turnContract.forbiddenRepeats || input.forbiddenRepeats || []),
    handoffNeeded: Boolean(turnContract.handoffNeeded || input.handoffNeeded),
    allowedTools,
    activeSkill: {
      id: clean(activeSkill.id || activeSkill.versionId || ''),
      name: clean(activeSkill.name || activeSkill.displayName || ''),
      action: clean(activeSkill.action || 'none'),
      reasonCodes: asArray(activeSkill.reasonCodes || []),
      matchedTriggers: asArray(activeSkill.matchedTriggers || []),
    },
  };
}

function buildDataFreshness({ identity, memory, skills, input = {} } = {}) {
  const now = Date.now();
  const lastSyncAt = input.lastSyncAt || input.last_sync_at || new Date(now).toISOString();
  const leadStale = Boolean(input.leadStale || input.lead_stale || !identity.ready);
  const memoryStale = Boolean(input.memoryStale || memory.stale);
  const skillsStale = Boolean(input.skillsStale || skills.stale);
  return {
    leadStale,
    memoryStale,
    skillsStale,
    lastSyncAt,
    ready: !leadStale && !memoryStale && !skillsStale,
  };
}

function buildAgentHandoffs({ turnContract, memory, skills } = {}) {
  const handoffs = [];
  if (turnContract.objection || turnContract.intent !== 'unknown' || turnContract.activeSkill.id) {
    handoffs.push({
      agentId: 'script-rotator',
      action: 'select_objection_script',
      reason: turnContract.objection || turnContract.intent || 'active_skill',
      required: true,
    });
  }
  if (turnContract.handoffNeeded) {
    handoffs.push({
      agentId: 'qa-agent',
      action: 'inspect_handoff_risk',
      reason: 'turn_contract_handoff_needed',
      required: true,
    });
  }
  if (!memory.ready) {
    handoffs.push({
      agentId: 'rex',
      action: 'recall_memory_context',
      reason: 'memory_not_loaded',
      required: false,
    });
  }
  if (!skills.ready) {
    handoffs.push({
      agentId: 'qa-agent',
      action: 'inspect_skill_authority',
      reason: 'active_skills_not_loaded',
      required: false,
    });
  }
  return handoffs;
}

function buildOutcome(input = {}) {
  const outcome = input.outcome && typeof input.outcome === 'object' ? input.outcome : {};
  return {
    actionTaken: clean(outcome.actionTaken || outcome.action_taken || ''),
    sellerReaction: clean(outcome.sellerReaction || outcome.seller_reaction || ''),
    appointmentSet: Boolean(outcome.appointmentSet || outcome.appointment_set),
    contractSent: Boolean(outcome.contractSent || outcome.contract_sent),
    followUpScheduled: Boolean(outcome.followUpScheduled || outcome.follow_up_scheduled),
    lost: Boolean(outcome.lost),
    dnc: Boolean(outcome.dnc),
    humanTakeover: Boolean(outcome.humanTakeover || outcome.human_takeover),
  };
}

export function buildPBKIntelligenceFleetReadiness({ context = {}, agents = [] } = {}) {
  const agentIds = new Set(
    (Array.isArray(agents) ? agents : [])
      .map((agent) => clean(agent.id || agent.agentId || agent.name).toLowerCase())
      .filter(Boolean)
  );
  const missingAgents = REQUIRED_CONTEXT_AGENTS.filter((agentId) => agentIds.size && !agentIds.has(agentId));
  const required = {
    leadIdentity: Boolean(context.identity?.ready),
    memory: Boolean(context.memory?.ready),
    skills: Boolean(context.skills?.ready),
    turnContract: Boolean(context.turnContract?.ok && context.turnContract?.intent),
    dataFreshness: Boolean(context.dataFreshness?.ready),
    agentCoverage: !agentIds.size || missingAgents.length === 0,
  };
  const ready = Object.values(required).every(Boolean);
  return {
    ready,
    result: ready ? 'pbk_intelligence_context_ready' : 'pbk_intelligence_context_incomplete',
    required,
    missingAgents,
    checkedAt: new Date().toISOString(),
  };
}

export function buildPBKIntelligenceContext(input = {}) {
  const identity = buildIdentity(input);
  const callState = buildCallState(input);
  const memory = normalizeMemory(input);
  const skills = normalizeSkills(input);
  const turnContract = normalizeTurnContract(input);
  const dataFreshness = buildDataFreshness({ identity, memory, skills, input });
  const context = {
    revision: PBK_INTELLIGENCE_CONTEXT_REVISION,
    contextId: clean(input.contextId || [identity.leadId || identity.normalizedPhone || identity.normalizedEmail || 'unknown', identity.callId].filter(Boolean).join(':')),
    generatedAt: new Date().toISOString(),
    workspaceId: clean(input.workspaceId || input.workspace_id || 'pbk') || 'pbk',
    identity,
    callState,
    memory,
    skills,
    turnContract,
    dataFreshness,
    outcome: buildOutcome(input),
    agentHandoffs: [],
    auditTrail: [
      {
        event: 'pbk_intelligence_context_built',
        at: new Date().toISOString(),
        leadId: identity.leadId,
        callId: identity.callId,
        intent: turnContract.intent,
        activeSkillId: turnContract.activeSkill.id,
      },
    ],
  };
  context.agentHandoffs = buildAgentHandoffs({ turnContract, memory, skills });
  context.fleetReadiness = buildPBKIntelligenceFleetReadiness({
    context,
    agents: input.agents || [],
  });
  return context;
}

export function mergePBKIntelligenceContextOutcome(context = {}, outcome = {}) {
  const next = {
    ...(context && typeof context === 'object' ? context : {}),
    outcome: {
      ...(context.outcome && typeof context.outcome === 'object' ? context.outcome : buildOutcome()),
      ...buildOutcome({ outcome }),
    },
    auditTrail: [
      ...(Array.isArray(context.auditTrail) ? context.auditTrail : []),
      {
        event: 'pbk_intelligence_context_outcome_merged',
        at: new Date().toISOString(),
        actionTaken: clean(outcome.actionTaken || outcome.action_taken || ''),
        sellerReaction: clean(outcome.sellerReaction || outcome.seller_reaction || ''),
      },
    ],
  };
  next.fleetReadiness = buildPBKIntelligenceFleetReadiness({
    context: next,
    agents: outcome.agents || [],
  });
  return next;
}
