const PROFILES = Object.freeze({
  boundary: Object.freeze({
    mode: 'boundary',
    label: 'Respectful boundary',
    speed: 0.86,
    stability: 0.74,
    similarityBoost: 0.82,
    pauseMs: 1150,
    instruction: 'Be brief, respectful, and explicit. Do not continue persuasion.',
  }),
  warm: Object.freeze({
    mode: 'warm',
    label: 'Warm guidance',
    speed: 0.9,
    stability: 0.66,
    similarityBoost: 0.82,
    pauseMs: 950,
    instruction: 'Acknowledge first, reduce pressure, and ask one useful follow-up question.',
  }),
  balanced: Object.freeze({
    mode: 'balanced',
    label: 'Calm authority',
    speed: 0.98,
    stability: 0.54,
    similarityBoost: 0.79,
    pauseMs: 650,
    instruction: 'Stay warm and direct. Explain one point, then invite the seller to respond.',
  }),
  decisive: Object.freeze({
    mode: 'decisive',
    label: 'Confident next step',
    speed: 1.03,
    stability: 0.48,
    similarityBoost: 0.78,
    pauseMs: 475,
    instruction: 'Be concise and confident while preserving seller choice and approval gates.',
  }),
});

function clamp(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function normalized(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function selectWarmthDominance(sellerState = {}) {
  const emotion = normalized(sellerState.emotion);
  const sentiment = clamp(sellerState.sentiment, 0.55);
  const hesitation = clamp(
    sellerState.hesitation,
    /hesitant|guarded|unsure|ambivalent|overwhelm|fear|sad|grief|distrust/.test(emotion)
      ? 0.78
      : Math.max(0, 0.62 - sentiment)
  );
  const buyingSignal = clamp(
    sellerState.buyingSignal,
    sellerState.readyToClose === true ? 0.9 : sentiment > 0.72 ? 0.68 : 0.25
  );
  const highRiskEmotion = /anger|angry|frustrated|fear|sad|grief|distrust|overwhelm/.test(
    emotion
  );

  let profile = PROFILES.balanced;
  let rationale = 'Default calm-authority posture.';

  if (sellerState.shouldStopContact === true) {
    profile = PROFILES.boundary;
    rationale = 'The seller requested a contact boundary.';
  } else if (
    sellerState.shouldHandoff === true ||
    sellerState.handoffRisk === 'high' ||
    highRiskEmotion ||
    hesitation >= 0.62 ||
    sentiment < 0.45
  ) {
    profile = PROFILES.warm;
    rationale = 'Seller hesitation or emotional risk requires lower pressure.';
  } else if (
    buyingSignal >= 0.72 &&
    sellerState.pathLocked === true &&
    sellerState.bantComplete === true
  ) {
    profile = PROFILES.decisive;
    rationale = 'Strong buying signal with qualification and path evidence supports a concise next step.';
  }

  return {
    ...profile,
    rationale,
    signals: {
      sentiment,
      hesitation,
      buyingSignal,
      pathLocked: sellerState.pathLocked === true,
      bantComplete: sellerState.bantComplete === true,
      shouldHandoff: sellerState.shouldHandoff === true,
      shouldStopContact: sellerState.shouldStopContact === true,
    },
  };
}

export function applyWarmthDominance(baseProsody = {}, interactionStyle = {}) {
  const mode = interactionStyle.mode || 'balanced';
  const speed =
    mode === 'warm' || mode === 'boundary'
      ? Math.min(Number(baseProsody.speed || 1), Number(interactionStyle.speed || 1))
      : mode === 'decisive'
        ? Math.min(1.06, Math.max(Number(baseProsody.speed || 1), Number(interactionStyle.speed || 1)))
        : Number(baseProsody.speed || interactionStyle.speed || 1);
  const stability =
    mode === 'warm' || mode === 'boundary'
      ? Math.max(
          Number(baseProsody.stability || 0.5),
          Number(interactionStyle.stability || 0.5)
        )
      : Number(baseProsody.stability || interactionStyle.stability || 0.5);

  return {
    ...baseProsody,
    speed,
    stability,
    similarityBoost: Math.max(
      Number(baseProsody.similarityBoost || 0.78),
      Number(interactionStyle.similarityBoost || 0.78)
    ),
    pauseMs:
      mode === 'warm' || mode === 'boundary'
        ? Math.max(
            Number(baseProsody.pauseMs || 650),
            Number(interactionStyle.pauseMs || 650)
          )
        : Number(interactionStyle.pauseMs || baseProsody.pauseMs || 650),
    interactionStyle,
  };
}
