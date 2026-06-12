const INTERNAL_LANGUAGE_PATTERN =
  /\b(?:telnyx_call|telnyx_sms|sendDocuSign|sendContract|analyzeDeal|createApproval|toolName|tool\s*call|JSON|call[_ -]?id|stream[_ -]?id|debug|metadata|function\s*call)\b/i;
const SIGNATURE_PATTERN =
  /\b(?:sign(?:ature|ing)?|docusign|send\s+(?:the\s+)?(?:contract|documents?)|contract\s+now|lock\s+it\s+up|paperwork\s+now)\b/i;
const FALSE_URGENCY_PATTERN =
  /\b(?:expires today|only today|last chance|now or never|must sign today|offer goes away)\b/i;
const LEGAL_TAX_RISK_PATTERN =
  /\b(?:you do not need (?:a )?(?:lawyer|attorney|cpa)|don't need (?:a )?(?:lawyer|attorney|cpa)|ignore (?:your )?(?:lawyer|attorney|cpa)|tax advice|legal advice)\b/i;
const MONEY_PATTERN = /\$?\b(\d{2,3}(?:,\d{3})+|\d{5,7})(?:\.\d{1,2})?\b/g;

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function fingerprintQuestion(value = '') {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9? ]/g, '')
    .replace(/\b(?:please|just|really|again)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestion(value = '') {
  return /\?\s*$/.test(clean(value));
}

function containsRepeatedQuestion(answer = '', previousQuestions = []) {
  if (!isQuestion(answer)) return false;
  const current = fingerprintQuestion(answer);
  return previousQuestions.map(fingerprintQuestion).filter(Boolean).includes(current);
}

function highestMoneyMention(answer = '') {
  const values = [];
  for (const match of clean(answer).matchAll(MONEY_PATTERN)) {
    const parsed = Number(String(match[1] || '').replace(/,/g, ''));
    if (Number.isFinite(parsed)) values.push(parsed);
  }
  return values.length ? Math.max(...values) : 0;
}

function phaseBeforeAuthority(phase = '') {
  return ['trust', 'participant_verification', 'discovery', 'motivation', 'economics', 'path_selection'].includes(
    String(phase || '').trim().toLowerCase()
  );
}

function guardResult({ answer, result, blocked = false, reasons = [], repeatedQuestionBlocked = false }) {
  return {
    ok: !blocked,
    result,
    blocked,
    answer: clean(answer),
    reasons: [...new Set(reasons)],
    repeatedQuestionBlocked,
  };
}

export function guardAvaResponse(input = {}) {
  const originalAnswer = clean(input.answer || input.candidateAnswer || '');
  const transcript = clean(input.transcript || input.query || input.text || '');
  const reasons = [];
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const phase = String(input.phase || input.state?.phase || '').trim().toLowerCase();

  if (input.shouldStopContact === true || /\b(?:stop calling|do not call|don't call|remove me|unsubscribe|take me off)\b/i.test(transcript)) {
    return guardResult({
      result: 'blocked',
      blocked: true,
      reasons: ['stop_contact_boundary'],
      answer: "I understand. We'll stop contacting you. Thank you for letting me know.",
    });
  }

  if (LEGAL_TAX_RISK_PATTERN.test(originalAnswer)) {
    return guardResult({
      result: 'handoff',
      blocked: true,
      reasons: ['legal_tax_boundary'],
      answer:
        'That is important enough to handle carefully. I want you to review it with your attorney or tax professional, and I can bring in a human on our side before we go further.',
    });
  }

  if (
    SIGNATURE_PATTERN.test(originalAnswer) &&
    (evidence.participantsIdentified === false || input.authorityKnown === false || phaseBeforeAuthority(phase))
  ) {
    return guardResult({
      result: 'blocked',
      blocked: true,
      reasons: ['signature_before_authority'],
      answer:
        "Before paperwork, I need to make sure I'm speaking with the right person. Are you the owner, the agent, or helping the decision maker?",
    });
  }

  const mao = Number(input.mao ?? input.evidence?.mao ?? input.context?.mao ?? 0);
  const mentionedOffer = highestMoneyMention(originalAnswer);
  if (Number.isFinite(mao) && mao > 0 && mentionedOffer > mao) {
    return guardResult({
      result: 'blocked',
      blocked: true,
      reasons: ['offer_above_mao'],
      answer:
        'I need to verify the numbers before I put a seller-facing offer in front of you. Let me check the comps and repair assumptions first.',
    });
  }

  if (FALSE_URGENCY_PATTERN.test(originalAnswer)) {
    return guardResult({
      result: 'rewritten',
      reasons: ['false_urgency'],
      answer:
        'You do not need to rush. The cleanest next step is for me to verify the numbers and make sure the option I present is real and useful for your situation.',
    });
  }

  if (INTERNAL_LANGUAGE_PATTERN.test(originalAnswer)) {
    return guardResult({
      result: 'rewritten',
      reasons: ['internal_language'],
      answer:
        'I can help with that, and I will keep the next step approval-gated so nothing is sent or started until it is confirmed.',
    });
  }

  if (containsRepeatedQuestion(originalAnswer, input.previousQuestions || [])) {
    return guardResult({
      result: 'rewritten',
      reasons: ['repeated_question'],
      repeatedQuestionBlocked: true,
      answer:
        'I hear you. Let me use what you already shared and keep this simple: is certainty, speed, or the final net number most important right now?',
    });
  }

  return guardResult({
    result: 'passed',
    reasons: ['seller_safe_response'],
    answer: originalAnswer,
  });
}
