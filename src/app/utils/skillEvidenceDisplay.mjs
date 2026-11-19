function readRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstPresent(...values) {
  return values.find(
    (value) =>
      value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())
  );
}

function readFiniteNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readRecordedCount(value) {
  const number = readFiniteNumber(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readPercent(value, signed = false) {
  const number = readFiniteNumber(value);
  if (number === null || number < (signed ? -100 : 0) || number > 100) return null;
  return Math.abs(number) <= 1 ? number * 100 : number;
}

function readTimestamp(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

// Presentation only: preserve route alias/container order without supplying operational defaults.
export function readSkillEvidenceDisplay(item) {
  const raw = readRecord(item);
  const outcomes = readRecord(raw.outcomes || raw.outcomeStats || raw.performance);
  const metrics = readRecord(raw.metrics || raw.analytics || raw.skillMetrics);
  const usageCount = readRecordedCount(
    firstPresent(
      raw.usageCount,
      raw.usage_count,
      raw.uses,
      raw.totalUses,
      outcomes.usageCount,
      outcomes.uses,
      metrics.usageCount,
      metrics.uses
    )
  );
  const wins = readRecordedCount(
    firstPresent(raw.wins, raw.successes, outcomes.wins, outcomes.successes, metrics.wins)
  );
  const losses = readRecordedCount(
    firstPresent(raw.losses, raw.failures, outcomes.losses, outcomes.failures, metrics.losses)
  );
  const explicitSuccess = firstPresent(
    raw.successRate,
    raw.success_rate,
    outcomes.successRate,
    outcomes.success_rate,
    metrics.successRate
  );
  let successPercent = readPercent(explicitSuccess);
  if (
    explicitSuccess === undefined &&
    usageCount !== null &&
    usageCount > 0 &&
    wins !== null &&
    losses !== null &&
    Number.isSafeInteger(wins + losses) &&
    wins + losses > 0
  ) {
    successPercent = (wins / (wins + losses)) * 100;
  }
  return {
    usageCount,
    successPercent,
    confidencePercent: readPercent(
      firstPresent(
        raw.confidence,
        raw.confidenceScore,
        raw.confidence_score,
        outcomes.confidence,
        metrics.confidence
      )
    ),
    changePercent: readPercent(
      firstPresent(
        raw.confidenceDelta,
        raw.confidence_delta,
        raw.weeklyDelta,
        raw.weekly_delta,
        outcomes.confidenceDelta,
        metrics.confidenceDelta
      ),
      true
    ),
    lastTriggeredAt: readTimestamp(
      firstPresent(
        raw.lastTriggeredAt,
        raw.last_triggered_at,
        raw.lastUsedAt,
        raw.last_used_at,
        outcomes.lastTriggeredAt,
        metrics.lastTriggeredAt
      )
    ),
  };
}

export function formatSkillMetric(value, kind) {
  if (value === null) return 'Not recorded';
  if (kind === 'count') return String(value);
  return `${kind === 'change' && value > 0 ? '+' : ''}${value.toFixed(0)}%`;
}

export function getSkillStageDisplay(state, labels, steps) {
  if (typeof state !== 'string' || !Object.hasOwn(labels, state) || !Object.hasOwn(steps, state)) {
    return { label: 'Unknown', index: null };
  }
  const label = labels[state];
  const index = steps[state];
  if (
    typeof label !== 'string' ||
    !label.trim() ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 6
  ) {
    return { label: 'Unknown', index: null };
  }
  return { label, index };
}
