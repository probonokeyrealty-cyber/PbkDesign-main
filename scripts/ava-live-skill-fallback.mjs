function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value = '') {
  return clean(value).toLowerCase();
}

function stripInternalLanguage(value = '') {
  return clean(value)
    .replace(/\b(?:governed|skill|trigger|JSON|tool|call[_ -]?id|stream[_ -]?id|debug|metadata)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureQuestion(value = '', fallbackQuestion = '') {
  const text = stripInternalLanguage(value);
  if (!text) return clean(fallbackQuestion);
  if (/\?\s*$/.test(text)) return text;
  const fallback = clean(fallbackQuestion);
  return fallback ? `${text} ${fallback}` : `${text} What would make this feel like the right next step for you?`;
}

function skillHaystack(move = {}, context = {}) {
  return lower([
    move.text,
    move.exactNextMove,
    move.reason,
    move.governedSkill?.name,
    move.governedSkill?.id,
    move.governedSkill?.category,
    move.governedSkill?.response,
    move.governedSkill?.nextQuestion,
    ...(Array.isArray(move.governedSkill?.reasonCodes) ? move.governedSkill.reasonCodes : []),
    context.transcript,
  ].filter(Boolean).join(' '));
}

function isGovernedSkillSource(source = '') {
  return lower(source).replace(/_/g, '-') === 'skill-governance';
}

export function shouldPreferAvaLiveGovernedSkillReply(move = {}) {
  return Boolean(
    move &&
      move.type === 'governed_skill' &&
      isGovernedSkillSource(move.source) &&
      clean(move.text || move.exactNextMove)
  );
}

export function buildAvaLiveGovernedSkillReply(move = {}, context = {}) {
  if (!shouldPreferAvaLiveGovernedSkillReply(move)) return '';
  const haystack = skillHaystack(move, context);
  const transcript = lower(context.transcript || '');
  const fallbackQuestion = clean(context.fallbackQuestion || context.fallback || '');
  const emotionalScript =
    move.governedSkill?.emotionalScript === true ||
    /\b(ava[-_ ]?emotional|seller[_ -]?engagement|empathetic|memory connection|emotional discovery|comfort framing|trust process|consultative commitment)\b/.test(
      haystack
    );

  if (emotionalScript) {
    const response = clean(move.governedSkill?.response || '');
    const nextQuestion = clean(move.governedSkill?.nextQuestion || fallbackQuestion);
    return ensureQuestion(response || move.text || move.exactNextMove, nextQuestion);
  }

  if (/\b(scams?|legit|trust|proof|credible|credibility|distrust|validate|validate_the_concern)\b/.test(haystack)) {
    return ensureQuestion(
      'That is a fair concern. I would be careful too, so I can keep this verifiable before we talk numbers.',
      fallbackQuestion || 'What proof would make you comfortable enough to keep talking?'
    );
  }

  if (/\b(price|too_low|lowball|offer|money|net|expected_net|pay_more|higher_offer|as_is)\b/.test(haystack)) {
    const otherOffer = /\b(other|another|investor|higher|pay more|offered more)\b/.test(transcript);
    return ensureQuestion(
      otherOffer
        ? 'I hear you on price. Before I move any number, I want to compare the real net, not just the headline offer.'
        : 'I hear you on the number. Before I guess or negotiate against myself, I want to understand the real target.',
      otherOffer
        ? 'What number are you trying to walk away with, and does the other offer include repairs, fees, and a guaranteed closing date?'
        : 'What number would feel fair to you, and what condition should I price in?'
    );
  }

  if (/\b(think_about|need_to_think|hesitat|ambivalence|not_sure)\b/.test(haystack)) {
    return ensureQuestion(
      'Of course. Usually when someone says they need to think, there is one specific thing underneath it: the number, the timing, or confidence in the process.',
      fallbackQuestion || 'Which one is it for you?'
    );
  }

  if (/\b(spouse|partner|wife|husband|decision_maker|heir|executor)\b/.test(haystack)) {
    return ensureQuestion(
      'That makes sense. If someone else needs to weigh in, I want to make this easy for both of you.',
      fallbackQuestion || 'What would they need to hear for this to feel like a yes?'
    );
  }

  if (/\b(agent|realtor|commission|listing|broker)\b/.test(haystack)) {
    return ensureQuestion(
      'Absolutely. If you are the agent, I want to protect the relationship and keep your commission conversation clean.',
      fallbackQuestion || 'Is the bigger blocker days on market, condition, seller expectation, or timing?'
    );
  }

  if (/\b(probate|grief|estate|inherited|executor|passed_away)\b/.test(haystack)) {
    return ensureQuestion(
      'I am sorry you are having to handle that. We can slow this down and keep it practical.',
      fallbackQuestion || 'Are you the person authorized to make decisions, or is another heir or executor involved?'
    );
  }

  if (/\b(repair|condition|roof|foundation|cleanout|as_is|distress)\b/.test(haystack)) {
    return ensureQuestion(
      'That repair burden is exactly why an as-is path can make sense. I do not want to underwrite the wrong problem.',
      fallbackQuestion || 'What is the biggest repair headache: roof, mechanicals, foundation, or cleanout?'
    );
  }

  if (/\b(timeline|speed|fast|urgent|close_quickly|certainty)\b/.test(haystack)) {
    return ensureQuestion(
      'Got it. If speed and certainty matter, I can keep the process simple and avoid wasting your time.',
      fallbackQuestion || 'Are you trying to solve this in days, a few weeks, or are you flexible if the number is right?'
    );
  }

  return ensureQuestion(
    'I hear you. Let me handle that directly and keep the next step useful instead of repeating myself.',
    fallbackQuestion || 'What is the one thing I need to solve for you: price, timing, repairs, or certainty?'
  );
}
