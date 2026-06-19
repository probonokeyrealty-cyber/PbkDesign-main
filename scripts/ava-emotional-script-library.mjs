export const AVA_EMOTIONAL_SCRIPT_LIBRARY_REVISION =
  '2026-06-19-emotional-script-library-v1';

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value = '') {
  return clean(value).toLowerCase();
}

function normalize(value = '') {
  return lower(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function builtInSkill({
  id,
  name,
  priority,
  response,
  nextQuestion,
  triggerPolicy,
  risk = 'low',
  agents = ['ava'],
}) {
  return {
    id,
    versionId: `${id}-builtin-v1`,
    activationId: `${id}-builtin-activation`,
    name,
    level: 'production',
    status: 'active',
    source: 'skill-governance',
    confidence: risk === 'medium' ? 88 : 94,
    priority,
    category: 'seller_engagement_scripts',
    emotionalScript: true,
    risk,
    targetAgents: agents,
    evidence: `${response} ${nextQuestion}`,
    instructions: `${response} ${nextQuestion}`,
    response,
    nextQuestion,
    triggerPolicy: {
      category: 'seller_engagement_scripts',
      ...triggerPolicy,
    },
    toolAllowlist: ['retrieveClosingIntelligence', 'selectContextAwareScript'],
    scope: { type: 'global' },
    rolloutMode: 'always_on',
    rolloutPercent: 100,
    builtIn: true,
    revision: AVA_EMOTIONAL_SCRIPT_LIBRARY_REVISION,
  };
}

export const AVA_BUILT_IN_EMOTIONAL_SCRIPT_SKILLS = Object.freeze([
  builtInSkill({
    id: 'ava-emotional-empathetic-open',
    name: 'Empathetic Open',
    priority: 42,
    response:
      'I know this is a big decision, so I want to make this easy and comfortable, not rushed.',
    nextQuestion:
      'Tell me a little about the home and whether you are the owner or helping with it.',
    triggerPolicy: {
      emotionalPhases: ['trust'],
      intents: ['unknown', 'ambiguous_yes'],
      stages: ['trust', 'participant_verification'],
      keywords: ['hello', 'hi', 'calling about my house', 'interested in selling'],
      blockedIntents: ['stop_contact'],
    },
  }),
  builtInSkill({
    id: 'ava-emotional-memory-connection',
    name: 'Memory Connection',
    priority: 34,
    response: 'It sounds like this home holds real memories, and I want to respect that.',
    nextQuestion: 'What do you love most about the house, or what memory matters most there?',
    triggerPolicy: {
      emotionalPhases: ['memory'],
      emotions: ['sadness', 'grief', 'grieving', 'nostalgia'],
      keywords: ['mom', 'dad', 'childhood', 'grew up', 'family home', 'memories', 'inherited'],
      blockedIntents: ['stop_contact'],
    },
  }),
  builtInSkill({
    id: 'ava-emotional-discovery',
    name: 'Emotional Discovery',
    priority: 38,
    risk: 'medium',
    response:
      'That is completely understandable. When it feels like a lot, there is usually one thing underneath everything.',
    nextQuestion: 'What is the biggest thing on your mind about this sale right now?',
    triggerPolicy: {
      emotionalPhases: ['discovery'],
      intents: ['need_to_think'],
      emotions: ['overwhelmed', 'hesitation', 'hesitant', 'ambivalent'],
      keywords: ["it's a lot", 'overwhelmed', 'not sure', 'hesitate', 'need to think'],
      blockedIntents: ['stop_contact'],
    },
  }),
  builtInSkill({
    id: 'ava-emotional-comfort-framing',
    name: 'Comfort Framing',
    priority: 30,
    response: 'That is a fair question. I want you to feel safe and clear before anything moves.',
    nextQuestion: 'What would make you feel confident in the process: proof, title company, or references?',
    triggerPolicy: {
      emotionalPhases: ['comfort'],
      objections: ['trust_scam'],
      emotions: ['fear', 'distrust', 'distrustful'],
      keywords: ['safe', 'trust', 'scam', 'legit', 'proof', 'how do i know'],
      blockedIntents: ['stop_contact'],
    },
  }),
  builtInSkill({
    id: 'ava-emotional-trust-process-offer-close',
    name: 'Trust Process Offer Close',
    priority: 50,
    risk: 'medium',
    response:
      'If the company feels right and the process feels clear, then we should be honest about the last gap instead of circling.',
    nextQuestion: 'Is the only thing keeping you from deciding today the price, the timing, or confidence in the terms?',
    triggerPolicy: {
      emotionalPhases: ['commitment'],
      intents: ['need_to_think', 'seller_wants_max_net', 'make_offer'],
      keywords: ['trust the company', 'process', 'only issue', 'decision today', 'say yes'],
      blockedEmotions: ['grief', 'grieving', 'sadness', 'fear', 'angry', 'anger', 'overwhelmed'],
      blockedIntents: ['stop_contact', 'legal_review', 'probate_legal'],
    },
  }),
  builtInSkill({
    id: 'ava-emotional-consultative-pause',
    name: 'Consultative Commitment Pause',
    priority: 56,
    risk: 'medium',
    response:
      'Let me double-check the numbers against what you told me so I do not give you a sloppy answer.',
    nextQuestion: 'If the numbers and timing still line up, would you be comfortable moving forward today?',
    triggerPolicy: {
      emotionalPhases: ['commitment'],
      intents: ['make_offer', 'seller_wants_max_net'],
      keywords: ['what is next', 'ready', 'move forward', 'can you do better', 'final number'],
      blockedEmotions: ['grief', 'grieving', 'sadness', 'fear', 'angry', 'anger', 'overwhelmed'],
      blockedIntents: ['stop_contact', 'legal_review', 'probate_legal'],
    },
  }),
]);

export function listAvaBuiltInEmotionalScriptSkills() {
  return AVA_BUILT_IN_EMOTIONAL_SCRIPT_SKILLS.map((skill) => ({ ...skill }));
}

export function detectAvaEmotionalPhase(input = {}) {
  const transcript = lower(input.transcript || input.text || input.query || '');
  const emotion = normalize(input.emotion || input.sellerEmotion || input.sentimentLabel || '');
  const intent = normalize(input.intent || input.sellerIntent || '');
  const objection = normalize(input.objection || input.lastObjection || '');
  const phase = normalize(input.phase || input.stage || '');

  if (intent === 'stop_contact') return 'boundary';
  if (
    /\b(mom|dad|mother|father|childhood|grew up|family home|memories|memory|passed away|inherited)\b/.test(
      transcript
    ) ||
    ['grief', 'grieving', 'sadness', 'nostalgia'].includes(emotion)
  ) {
    return 'memory';
  }
  if (
    objection === 'trust_scam' ||
    ['fear', 'distrust', 'distrustful'].includes(emotion) ||
    /\b(scams?|legit|safe|trust|proof|how do i know|real company)\b/.test(transcript)
  ) {
    return 'comfort';
  }
  if (
    intent === 'need_to_think' ||
    ['overwhelmed', 'hesitation', 'hesitant', 'ambivalent'].includes(emotion) ||
    /\b(it'?s a lot|overwhelmed|not sure|need to think|sleep on it|hesitat)\b/.test(transcript)
  ) {
    return 'discovery';
  }
  if (
    ['commitment', 'approval'].includes(phase) ||
    ['make_offer', 'seller_wants_max_net', 'contract_request'].includes(intent) ||
    /\b(what'?s next|what is next|move forward|say yes|decision today|only issue|final number)\b/.test(
      transcript
    )
  ) {
    return 'commitment';
  }
  return 'trust';
}
