import { shouldUseRBP } from './negotiation-policy.mjs';

export const Phase = Object.freeze({
  TRUST: 'trust',
  PARTICIPANT_VERIFICATION: 'participant_verification',
  DISCOVERY: 'discovery',
  MOTIVATION: 'motivation',
  ECONOMICS: 'economics',
  PATH_SELECTION: 'path_selection',
  OBJECTION_RESOLUTION: 'objection_resolution',
  COMMITMENT: 'commitment',
  APPROVAL: 'approval',
  FOLLOW_UP: 'follow_up',
});

export const PHASE_ORDER = Object.freeze(Object.values(Phase));
export const ALLOWED_DEAL_PATHS = Object.freeze([
  'cash',
  'rbp',
  'creative',
  'seller_finance',
  'subject_to',
  'mortgage_takeover',
  'land',
]);

const EXIT_RULES = Object.freeze({
  [Phase.TRUST]: (evidence) => evidence.trustEstablished === true,
  [Phase.PARTICIPANT_VERIFICATION]: (evidence) =>
    evidence.participantsIdentified === true,
  [Phase.DISCOVERY]: (evidence) => evidence.discoveryComplete === true,
  [Phase.MOTIVATION]: (evidence) => Boolean(evidence.primaryMotivation),
  [Phase.ECONOMICS]: (evidence) => evidence.maoCalculated === true,
  [Phase.PATH_SELECTION]: (evidence) =>
    ALLOWED_DEAL_PATHS.includes(String(evidence.pathSelected || '')),
  [Phase.OBJECTION_RESOLUTION]: (evidence) =>
    evidence.objectionsCleared === true || evidence.handoffRequired === true,
  [Phase.COMMITMENT]: (evidence) =>
    evidence.verbalCommitment === true ||
    Number.isFinite(Number(evidence.counterOffer)) ||
    Boolean(evidence.specificCallback) ||
    evidence.clearNo === true,
  [Phase.APPROVAL]: (evidence) =>
    ['approved', 'queued', 'not_required', 'rejected'].includes(
      String(evidence.approvalStatus || '')
    ),
  [Phase.FOLLOW_UP]: (evidence) => Boolean(evidence.nextAction) || evidence.clearNo === true,
});

export class ClosingStateMachine {
  constructor(leadId, callId, state = {}) {
    this.leadId = String(leadId || state.leadId || '');
    this.callId = String(callId || state.callId || '');
    this.phase = PHASE_ORDER.includes(state.phase) ? state.phase : Phase.TRUST;
    this.evidence = state.evidence && typeof state.evidence === 'object' ? { ...state.evidence } : {};
    this.enteredAt = Number(state.enteredAt || Date.now());
    this.startedAt = Number(state.startedAt || Date.now());
    this.history = Array.isArray(state.history) ? [...state.history] : [];
  }

  currentIndex() {
    return PHASE_ORDER.indexOf(this.phase);
  }

  canTransition(toPhase, newEvidence = {}, options = {}) {
    if (!PHASE_ORDER.includes(toPhase)) return false;
    const targetIndex = PHASE_ORDER.indexOf(toPhase);
    const currentIndex = this.currentIndex();
    if (!options.operatorOverride && targetIndex !== currentIndex + 1) return false;
    const candidateEvidence = { ...this.evidence, ...newEvidence };
    return Boolean(EXIT_RULES[this.phase]?.(candidateEvidence));
  }

  transition(toPhase, newEvidence = {}, options = {}) {
    if (!this.canTransition(toPhase, newEvidence, options)) {
      return {
        ok: false,
        phase: this.phase,
        reason: options.operatorOverride ? 'missing_exit_evidence' : 'invalid_transition',
      };
    }
    const previousPhase = this.phase;
    this.evidence = { ...this.evidence, ...newEvidence };
    this.phase = toPhase;
    this.enteredAt = Date.now();
    this.history.push({
      from: previousPhase,
      to: toPhase,
      at: new Date(this.enteredAt).toISOString(),
      operatorOverride: Boolean(options.operatorOverride),
    });
    return { ok: true, phase: this.phase };
  }

  recordEvidence(newEvidence = {}) {
    this.evidence = { ...this.evidence, ...newEvidence };
    return this.getPhaseMetadata();
  }

  selectPath(propertyAnalysis = {}, lead = {}) {
    if (shouldUseRBP(propertyAnalysis.repairs, lead, propertyAnalysis)) return 'rbp';
    const propertyType = String(
      propertyAnalysis.propertyType || propertyAnalysis.property_type || lead.propertyType || ''
    ).toLowerCase();
    if (/land|lot|acre/.test(propertyType)) return 'land';
    if (lead.lowRateMortgage || lead.low_rate_mortgage) return 'mortgage_takeover';
    if (lead.desiresMonthlyIncome || lead.desires_monthly_income) return 'seller_finance';
    return 'cash';
  }

  getPhaseMetadata(now = Date.now()) {
    return {
      phase: this.phase,
      phaseIndex: this.currentIndex(),
      elapsedSeconds: Math.max(0, Math.floor((now - this.enteredAt) / 1000)),
      evidence: { ...this.evidence },
      nextPhase: PHASE_ORDER[this.currentIndex() + 1] || null,
    };
  }

  toJSON() {
    return {
      leadId: this.leadId,
      callId: this.callId,
      phase: this.phase,
      evidence: { ...this.evidence },
      enteredAt: this.enteredAt,
      startedAt: this.startedAt,
      history: [...this.history],
    };
  }

  static fromJSON(value = {}) {
    return new ClosingStateMachine(value.leadId, value.callId, value);
  }
}
