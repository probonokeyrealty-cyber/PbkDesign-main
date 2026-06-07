const DEFAULT_POLICY = Object.freeze({
  tts: Object.freeze({ stability: 0.55, speed: 1, pitch: 1 }),
  scriptPrefix: '',
  nextAction: 'continue',
  prohibited: Object.freeze([]),
  handoffRisk: 'low',
});

export const emotionPolicies = Object.freeze({
  fear: Object.freeze({
    tts: Object.freeze({ stability: 0.72, speed: 0.86, pitch: 0.92 }),
    scriptPrefix: "I hear that you're worried. Let me slow this down and explain one step at a time.",
    nextAction: 'reassure',
    prohibited: Object.freeze(['hard_close', 'price_pressure']),
    handoffRisk: 'medium',
  }),
  anger: Object.freeze({
    tts: Object.freeze({ stability: 0.82, speed: 0.88, pitch: 0.94 }),
    scriptPrefix: 'I hear the frustration. I want to understand and help, not argue.',
    nextAction: 'de_escalate',
    prohibited: Object.freeze(['present_offer', 'urgency', 'rebuttal_battle']),
    handoffRisk: 'high',
  }),
  sadness: Object.freeze({
    tts: Object.freeze({ stability: 0.7, speed: 0.82, pitch: 0.9 }),
    scriptPrefix: "I'm sorry you're dealing with this. We can take this at your pace.",
    nextAction: 'ask_permission',
    prohibited: Object.freeze(['hard_close', 'pain_amplification']),
    handoffRisk: 'medium',
  }),
  distrust: Object.freeze({
    tts: Object.freeze({ stability: 0.65, speed: 0.96, pitch: 1 }),
    scriptPrefix: 'That is fair. You should verify anyone before signing anything.',
    nextAction: 'offer_proof',
    prohibited: Object.freeze(['pressure', 'unverified_claim']),
    handoffRisk: 'medium',
  }),
  overwhelm: Object.freeze({
    tts: Object.freeze({ stability: 0.7, speed: 0.86, pitch: 0.94 }),
    scriptPrefix: 'I understand. Let me simplify this to one decision at a time.',
    nextAction: 'summarize',
    prohibited: Object.freeze(['question_stack', 'option_overload']),
    handoffRisk: 'medium',
  }),
  urgency: Object.freeze({
    tts: Object.freeze({ stability: 0.62, speed: 1.04, pitch: 1 }),
    scriptPrefix: 'I hear the deadline. Let me confirm what is possible before I promise a date.',
    nextAction: 'verify_deadline',
    prohibited: Object.freeze(['unverified_guarantee', 'false_urgency']),
    handoffRisk: 'medium',
  }),
  ambivalence: Object.freeze({
    tts: Object.freeze({ stability: 0.6, speed: 0.96, pitch: 1 }),
    scriptPrefix: 'Of course. What specifically still feels unresolved?',
    nextAction: 'diagnose',
    prohibited: Object.freeze(['pushy_close']),
    handoffRisk: 'low',
  }),
});

export function getEmotionPolicy(emotion = '') {
  return emotionPolicies[String(emotion || '').trim().toLowerCase()] || DEFAULT_POLICY;
}

export function isEmotionActionAllowed(emotion, action) {
  return !getEmotionPolicy(emotion).prohibited.includes(String(action || '').trim());
}
