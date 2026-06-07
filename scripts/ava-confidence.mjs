function clamp(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function knownFactor(name, value, weight, factors) {
  if (value === null || value === undefined || value === '') return;
  factors.push({ name, value: clamp(value), weight });
}

export function calibrateAvaConfidence(input = {}) {
  const factors = [];
  knownFactor('path', input.pathConfidence, 0.22, factors);
  knownFactor('goal', input.goalConfidence, 0.16, factors);
  knownFactor('closing', input.closingConfidence, 0.18, factors);
  knownFactor('transcript', input.transcriptConfidence, 0.12, factors);

  const bantKnown = Math.max(0, Number(input.bantKnown || 0));
  const bantMissing = Math.max(0, Number(input.bantMissing || 0));
  if (bantKnown || bantMissing || input.bantComplete === true) {
    const bantConfidence =
      input.bantComplete === true
        ? 0.94
        : Math.max(0.28, Math.min(0.78, bantKnown / Math.max(1, bantKnown + bantMissing)));
    knownFactor('qualification', bantConfidence, 0.18, factors);
  }

  const evidenceCount = Math.max(0, Number(input.evidenceCount || 0));
  knownFactor('evidence', Math.min(0.94, 0.42 + evidenceCount * 0.08), 0.14, factors);

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  let score = totalWeight
    ? factors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / totalWeight
    : 0.5;
  const reasons = [];

  if (input.goalUncertaintyHigh === true) {
    score -= 0.14;
    reasons.push('seller_goal_uncertain');
  }
  if (input.novelObjection === true) {
    score -= 0.16;
    reasons.push('novel_objection');
  }
  if (input.pathLocked !== true) {
    score -= 0.05;
    reasons.push('deal_path_not_locked');
  }
  if (input.shouldHandoff === true) {
    score = Math.min(score, 0.42);
    reasons.push('human_handoff_recommended');
  }
  if (input.shouldStopContact === true) {
    score = Math.min(Math.max(score, 0.62), 0.79);
    reasons.push('contact_boundary_is_clear');
  }

  const hasQualification = factors.some((factor) => factor.name === 'qualification');
  const hasCoreConversationEvidence = factors.some((factor) =>
    ['closing', 'transcript', 'evidence'].includes(factor.name)
  );
  const minimumEvidenceMet =
    factors.length >= 4 &&
    hasQualification &&
    hasCoreConversationEvidence &&
    (evidenceCount >= 2 || input.bantComplete === true);
  if (!minimumEvidenceMet && input.shouldStopContact !== true && input.shouldHandoff !== true) {
    score = Math.min(score, 0.59);
    reasons.push('insufficient_independent_evidence');
  }

  score = Number(clamp(score, 0.5).toFixed(2));
  const band = score >= 0.8 ? 'high' : score >= 0.6 ? 'medium' : 'low';
  const responseMode =
    input.shouldStopContact === true
      ? 'boundary'
      : input.shouldHandoff === true
        ? 'handoff'
        : band === 'low'
          ? 'verify'
          : band === 'medium'
            ? 'confirm'
            : 'proceed';

  return {
    revision: 'ava-evidence-confidence-v1',
    score,
    band,
    responseMode,
    shouldVerify: responseMode === 'verify' || responseMode === 'confirm',
    shouldHandoff: responseMode === 'handoff',
    providerWrites: 'approval_gated',
    offerApproval: 'always_required',
    reasons: reasons.length ? reasons : ['evidence_supports_current_move'],
    factors: factors.map((factor) => ({
      name: factor.name,
      value: Number(factor.value.toFixed(2)),
      weight: factor.weight,
    })),
  };
}
