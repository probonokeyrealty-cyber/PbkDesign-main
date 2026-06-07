function normalize(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stableIndex(seed = '', length = 1) {
  if (length <= 1) return 0;
  let hash = 0;
  for (const char of String(seed || 'pbk')) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % length;
}

export const closingQuestions = Object.freeze({
  amplifyPain: Object.freeze([
    "If you still own the property six months from now, what problem will you still be dealing with?",
    'What would the repairs cost you in money, time, and attention if you handled them yourself?',
    'What is the biggest burden the property is creating right now?',
    'What happens if nothing changes before your current deadline?',
  ]),
  compareAlternatives: Object.freeze([
    'What would listing actually net after repairs, commissions, concessions, and holding costs?',
    'Which matters more here: the highest possible number, the fastest close, or the most certainty?',
    'How are you comparing the terms and certainty of the other options, not only the headline price?',
  ]),
  trialClose: Object.freeze([
    'If the number, timeline, and paperwork all make sense, would you want me to prepare the next step?',
    'If we solve the concern you just raised, is there anything else that would stop you from moving forward?',
    'Would a written summary help you decide whether this path fits?',
  ]),
  diagnostic: Object.freeze([
    'What would need to be true for this to be a yes?',
    'What is the one unresolved issue keeping this from moving forward?',
    'What information would make the decision easier?',
  ]),
  reframeObjections: Object.freeze({
    price_too_low: 'What number feels fair to you, and what are you basing it on?',
    need_to_think: 'Of course. What specifically do you need to think through?',
    spouse_decides: 'What would your spouse need to understand before you both decide?',
    competitor_offer: 'Which part of the other offer is stronger: price, timing, certainty, or terms?',
    timeline_mismatch: 'What closing timeline would actually work for you?',
    trust_issue: 'What proof would help you feel comfortable verifying the process?',
    repairs: 'Which repairs do you believe are most important, and what do you expect they would cost?',
  }),
});

export function getClosingQuestion(category, options = {}) {
  const normalizedCategory = normalize(category);
  const objectionType = normalize(options.objectionType);
  if (normalizedCategory === 'reframe' && objectionType) {
    return (
      closingQuestions.reframeObjections[objectionType] ||
      'What would make this option workable for you?'
    );
  }

  const questions = closingQuestions[normalizedCategory];
  if (!Array.isArray(questions) || questions.length === 0) {
    return 'Can you tell me more about what matters most here?';
  }
  return questions[stableIndex(options.seed || objectionType || normalizedCategory, questions.length)];
}

export function classifyClosingObjection(value = '') {
  const text = String(value || '').toLowerCase();
  if (/\b(too low|low offer|more money|worth more|price)\b/.test(text)) return 'price_too_low';
  if (/\b(think about|not sure|maybe|sleep on)\b/.test(text)) return 'need_to_think';
  if (/\b(spouse|husband|wife|partner|co-owner)\b/.test(text)) return 'spouse_decides';
  if (/\b(other offer|competitor|another buyer|investor offered)\b/.test(text)) {
    return 'competitor_offer';
  }
  if (/\b(timeline|closing date|too fast|too slow|need more time)\b/.test(text)) {
    return 'timeline_mismatch';
  }
  if (/\b(scam|trust|legit|real company|prove)\b/.test(text)) return 'trust_issue';
  if (/\b(repair|roof|foundation|mold|mould|condition)\b/.test(text)) return 'repairs';
  return '';
}
