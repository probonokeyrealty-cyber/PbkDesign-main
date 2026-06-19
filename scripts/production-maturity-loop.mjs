export const PRODUCTION_MATURITY_LOOP_REVISION =
  '2026-06-13-production-maturity-loop-v1';

const WIN_OUTCOMES = new Set([
  'appointment',
  'appointment_set',
  'callback',
  'callback_scheduled',
  'booked',
  'contract',
  'contract_signed',
  'followup',
  'follow_up',
  'signed',
  'closed',
  'won',
  'offer_accepted',
  'positive',
]);

const RISK_OUTCOMES = {
  complaint: 8,
  dnc: 10,
  ghosted: 4,
  cancelled: 6,
  rescinded: 7,
};

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value = '') {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function isoFromNow(now = () => Date.now()) {
  return new Date(now()).toISOString();
}

function isCircuitEligibleProviderFailure(result = {}) {
  const failure = extractProviderFailureCandidate(result);
  if (!failure || typeof failure !== 'object') return false;
  if (failure.ok !== false) return false;
  if (failure.skipped === true) return false;
  const code = normalizeCode(failure.result || failure.code || '');
  if (
    [
      'provider_missing',
      'local_only',
      'disabled',
      'empty_text',
      'missing_recipient',
      'missing_recipient_email',
      'sender_identity_store_unavailable',
      'sender_identity_not_found',
      'sender_identity_channel_mismatch',
      'sender_identity_ineligible',
    ].includes(code)
  ) {
    return false;
  }
  return true;
}

function describeReturnedProviderFailure(result = {}) {
  const failure = extractProviderFailureCandidate(result) || result;
  return (
    clean(failure.error || failure.message || failure.result || failure.code) ||
    (failure.status ? `Provider returned ${failure.status}` : 'Provider returned a failed result.')
  );
}

function extractProviderFailureCandidate(result = {}) {
  if (!result || typeof result !== 'object') return null;
  if (result.ok === false) return result;

  const nestedCandidates = [
    result.result,
    result.response,
    result.providerResult,
    result.delivery,
    result.telnyx,
    result.sms,
    result.email,
    result.call,
  ];

  for (const candidate of nestedCandidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const nested = extractProviderFailureCandidate(candidate);
    if (nested) return nested;
  }

  if (Number(result.statusCode || 0) >= 400) {
    return {
      ...result,
      ok: false,
      status: result.status || result.statusCode,
      result: result.result || 'provider_error',
    };
  }

  if (String(result.outbox?.status || '').toLowerCase() === 'failed') {
    return {
      ...(result.outbox.providerResult && typeof result.outbox.providerResult === 'object'
        ? result.outbox.providerResult
        : {}),
      ok: false,
      result: result.outbox.providerResult?.result || result.outbox.result || 'provider_error',
      error: result.outbox.error || result.error || '',
    };
  }

  return null;
}

export function classifySellerFinalOutcome(input = {}) {
  const explicit = normalizeCode(input.finalOutcome || input.final_outcome || '');
  const explicitKnown = new Set([
    ...WIN_OUTCOMES,
    ...Object.keys(RISK_OUTCOMES),
    'lost',
    'rejected',
    'engagement',
    'unknown',
  ]);
  if (explicit && explicitKnown.has(explicit)) {
    return {
      finalOutcome: explicit === 'follow_up' ? 'followup' : explicit,
      source: 'explicit',
      confidence: 1,
    };
  }

  const text = [
    input.outcomeLabel,
    input.outcome_label,
    input.outcome,
    input.status,
    input.disposition,
    input.result,
    input.transcript,
    input.text,
    input.metadata?.finalOutcome,
    input.metadata?.outcomeLabel,
    input.metadata?.sellerReaction,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\b(do not call|dnc|stop calling|remove me|unsubscribe)\b/i.test(text)) {
    return { finalOutcome: 'dnc', source: 'classified', confidence: 0.98 };
  }
  if (/\b(complaint|complained|reported|lawsuit|attorney general|harassment|pressure tactic)\b/i.test(text)) {
    return { finalOutcome: 'complaint', source: 'classified', confidence: 0.94 };
  }
  if (/\b(ghosted|no[- ]?show|no response|stopped responding|unresponsive|never answered|did not answer)\b/i.test(text)) {
    return { finalOutcome: 'ghosted', source: 'classified', confidence: 0.86 };
  }
  if (/\b(cancelled|canceled|rescinded|backed out|terminated)\b/i.test(text)) {
    return { finalOutcome: 'cancelled', source: 'classified', confidence: 0.88 };
  }
  if (/\b(contract signed|signed contract|docusign completed|seller signed|closed deal|deal closed|won deal)\b/i.test(text)) {
    return { finalOutcome: 'contract', source: 'classified', confidence: 0.96 };
  }
  if (/\b(appointment scheduled|appointment set|booked appointment|qualified appointment|meeting booked)\b/i.test(text)) {
    return { finalOutcome: 'appointment', source: 'classified', confidence: 0.93 };
  }
  if (/\b(callback scheduled|follow[- ]?up scheduled|call back|called back|specific callback|next call)\b/i.test(text)) {
    return { finalOutcome: 'followup', source: 'classified', confidence: 0.86 };
  }
  if (/\b(offer accepted|verbal yes|moving forward|contract sent|send the contract|send paperwork)\b/i.test(text)) {
    return { finalOutcome: 'contract', source: 'classified', confidence: 0.86 };
  }
  if (/\b(not interested|rejected|too low|walked away|hung up|hang up|lost)\b/i.test(text)) {
    return { finalOutcome: 'lost', source: 'classified', confidence: 0.78 };
  }
  if (input.dealClosed === true || input.deal_closed === true || input.success === true) {
    return { finalOutcome: 'positive', source: 'success_flag', confidence: 0.72 };
  }
  if (input.success === false) {
    return { finalOutcome: 'lost', source: 'success_flag', confidence: 0.72 };
  }
  return { finalOutcome: 'engagement', source: 'default', confidence: 0.52 };
}

function normalizeRuntimeEvent(event = {}, now = () => Date.now()) {
  const eventType = normalizeCode(event.eventType || event.event_type || event.type || 'event');
  const source = normalizeCode(event.source || 'pbk');
  const severity = normalizeCode(event.severity || 'info');
  return {
    event_type: eventType,
    source,
    severity,
    lead_id: clean(event.leadId || event.lead_id || ''),
    call_id: clean(event.callId || event.call_id || ''),
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    created_at: event.createdAt || event.created_at || isoFromNow(now),
  };
}

export function createRuntimeEventArchive({
  now = () => Date.now(),
  writer,
  fallbackSink = () => {},
} = {}) {
  if (typeof writer !== 'function') {
    throw new TypeError('createRuntimeEventArchive requires a writer function.');
  }

  return {
    async recordEvent(event = {}) {
      const normalized = normalizeRuntimeEvent(event, now);
      try {
        const result = await writer(normalized);
        return {
          ok: true,
          result: 'runtime_event_archived',
          revision: PRODUCTION_MATURITY_LOOP_REVISION,
          id: result?.id || result?.eventId || '',
          event: normalized,
        };
      } catch (error) {
        const failure = {
          ...normalized,
          metadata: {
            ...normalized.metadata,
            archiveError: error?.message || String(error),
          },
        };
        try {
          fallbackSink(failure);
        } catch {
          // Fallback sinks are best-effort; the returned envelope is the durable evidence.
        }
        return {
          ok: false,
          result: 'runtime_event_archive_failed',
          revision: PRODUCTION_MATURITY_LOOP_REVISION,
          nonBlocking: true,
          operatorVisible: true,
          error: error?.message || String(error),
          event: failure,
        };
      }
    },
  };
}

export function createProviderCircuitBreaker({
  now = () => Date.now(),
  failureThreshold = 3,
  cooldownMs = 60_000,
  onEvent = () => {},
} = {}) {
  const states = new Map();

  function getMutable(provider = '') {
    const key = normalizeCode(provider || 'provider');
    if (!states.has(key)) {
      states.set(key, {
        provider: key,
        state: 'closed',
        failures: 0,
        openedAt: 0,
        lastFailureAt: 0,
        lastError: '',
      });
    }
    return states.get(key);
  }

  function emit(event) {
    try {
      onEvent({
        revision: PRODUCTION_MATURITY_LOOP_REVISION,
        at: isoFromNow(now),
        ...event,
      });
    } catch {
      // Alert hooks must never break the caller path.
    }
  }

  function close(state) {
    state.state = 'closed';
    state.failures = 0;
    state.openedAt = 0;
    state.lastError = '';
    emit({ eventType: 'circuit_breaker_closed', provider: state.provider });
  }

  function fail(state, error) {
    state.failures += 1;
    state.lastFailureAt = now();
    state.lastError = error?.message || String(error || 'provider_failed');
    if (state.failures >= failureThreshold) {
      state.state = 'open';
      state.openedAt = now();
      emit({
        eventType: 'circuit_breaker_open',
        provider: state.provider,
        failures: state.failures,
        error: state.lastError,
      });
    }
  }

  return {
    async execute(provider, fn, fallbackFn = null) {
      if (typeof fn !== 'function') {
        throw new TypeError('Provider circuit breaker requires an execution function.');
      }
      const state = getMutable(provider);
      const elapsedSinceOpen = now() - Number(state.openedAt || 0);
      if (state.state === 'open' && elapsedSinceOpen < cooldownMs) {
        const fallback = typeof fallbackFn === 'function' ? await fallbackFn() : null;
        emit({
          eventType: 'circuit_breaker_short_circuit',
          provider: state.provider,
          failures: state.failures,
        });
        return {
          ok: false,
          result: 'provider_circuit_open',
          revision: PRODUCTION_MATURITY_LOOP_REVISION,
          provider: state.provider,
          providerAttempted: false,
          retryable: true,
          fallback,
          error: state.lastError,
        };
      }
      if (state.state === 'open') state.state = 'half_open';
      try {
        const result = await fn();
        if (isCircuitEligibleProviderFailure(result)) {
          const error = new Error(describeReturnedProviderFailure(result));
          fail(state, error);
          return {
            ok: false,
            result,
            revision: PRODUCTION_MATURITY_LOOP_REVISION,
            provider: state.provider,
            providerAttempted: true,
            retryable: true,
            circuitState: state.state,
            failures: state.failures,
            error: error.message,
          };
        }
        close(state);
        return {
          ok: result?.ok !== false,
          result,
          revision: PRODUCTION_MATURITY_LOOP_REVISION,
          provider: state.provider,
          providerAttempted: true,
        };
      } catch (error) {
        fail(state, error);
        return {
          ok: false,
          result: 'provider_call_failed',
          revision: PRODUCTION_MATURITY_LOOP_REVISION,
          provider: state.provider,
          providerAttempted: true,
          retryable: true,
          circuitState: state.state,
          failures: state.failures,
          error: error?.message || String(error),
        };
      }
    },
    getStatus(provider) {
      return { ...getMutable(provider) };
    },
    getAllStatuses() {
      return [...states.values()].map((state) => ({ ...state }));
    },
    recordFailure(provider, error) {
      const state = getMutable(provider);
      fail(state, error);
      return { ...state };
    },
    recordSuccess(provider) {
      const state = getMutable(provider);
      close(state);
      return { ...state };
    },
  };
}

export function scoreSkillOutcomeConfidence({
  previousConfidence = 50,
  minSamples = 10,
  usages = [],
} = {}) {
  const rows = Array.isArray(usages) ? usages : [];
  const sampleSize = rows.length;
  if (sampleSize < minSamples) {
    return {
      ok: true,
      revision: PRODUCTION_MATURITY_LOOP_REVISION,
      policy: 'insufficient_sample_hold',
      sampleSize,
      previousConfidence: clamp(previousConfidence),
      newConfidence: clamp(previousConfidence),
      wins: 0,
      risks: 0,
    };
  }

  let wins = 0;
  let penalty = 0;
  for (const row of rows) {
    const outcome = classifySellerFinalOutcome(row).finalOutcome;
    if (WIN_OUTCOMES.has(outcome)) wins += 1;
    penalty += RISK_OUTCOMES[outcome] || 0;
  }
  const winRateScore = (wins / sampleSize) * 100;
  const stabilityBlend = clamp(previousConfidence) * 0.25;
  const measuredBlend = winRateScore * 0.75;
  const newConfidence = Number(clamp(measuredBlend + stabilityBlend - penalty).toFixed(1));

  return {
    ok: true,
    revision: PRODUCTION_MATURITY_LOOP_REVISION,
    policy: 'measured_outcome_update',
    sampleSize,
    previousConfidence: clamp(previousConfidence),
    newConfidence,
    wins,
    risks: rows.filter((row) =>
      Object.prototype.hasOwnProperty.call(
        RISK_OUTCOMES,
        classifySellerFinalOutcome(row).finalOutcome
      )
    ).length,
    shouldPromote: newConfidence >= 85 && wins >= Math.ceil(sampleSize * 0.6),
    shouldPause: newConfidence < 35,
  };
}

export function buildFailedCallEvalGate({ scenarios = [] } = {}) {
  const rows = Array.isArray(scenarios) ? scenarios : [];
  const failed = rows.filter((scenario) => scenario?.passed !== true);
  return {
    ok: true,
    ready: failed.length === 0,
    result: failed.length ? 'failed_call_eval_regressions' : 'failed_call_eval_ready',
    revision: PRODUCTION_MATURITY_LOOP_REVISION,
    total: rows.length,
    passed: rows.length - failed.length,
    failed: failed.length,
    failedScenarioIds: failed.map((scenario, index) => clean(scenario.id || `scenario-${index + 1}`)),
    failures: failed.map((scenario, index) => ({
      id: clean(scenario.id || `scenario-${index + 1}`),
      reason: clean(scenario.reason || scenario.error || 'failed'),
    })),
  };
}

export function buildCanaryPromotionGate({
  canaryHealth = {},
  behaviorGate = {},
  failedCallEvalGate = {},
  silentErrorReport = {},
  sloStatus = {},
} = {}) {
  const blockers = [];
  if (canaryHealth.ready !== true) blockers.push('canary_health');
  if (behaviorGate.ready !== true) blockers.push('behavior_gate');
  if (failedCallEvalGate.ready !== true) blockers.push('failed_call_eval');
  if (silentErrorReport.launchReady !== true) blockers.push('silent_error_blockers');
  for (const burned of Array.isArray(sloStatus.burned) ? sloStatus.burned : []) {
    blockers.push(`slo_budget_burned:${normalizeCode(burned)}`);
  }
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'canary_promotion_blocked' : 'canary_promotion_ready',
    revision: PRODUCTION_MATURITY_LOOP_REVISION,
    blockers,
    evidence: {
      canaryHealth,
      behaviorGate,
      failedCallEvalGate,
      silentErrorReport,
      sloStatus,
    },
  };
}

function metricNumber(source = {}, key = '', fallback = null) {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function pctRegression(candidate = 0, baseline = 0) {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return 0;
  if (baseline <= 0) return candidate > 0 ? 100 : 0;
  return ((candidate - baseline) / baseline) * 100;
}

export function buildShadowCanaryComparison({
  baseline = {},
  candidate = {},
  thresholds = {},
} = {}) {
  const minBehaviorPassRate = Number(thresholds.minBehaviorPassRate ?? 0.98);
  const maxLatencyRegressionPct = Number(thresholds.maxLatencyRegressionPct ?? 20);
  const maxErrorRateRegressionPct = Number(thresholds.maxErrorRateRegressionPct ?? 15);
  const maxFallbackRateRegressionPct = Number(thresholds.maxFallbackRateRegressionPct ?? 20);
  const blockers = [];
  const baselineMetrics = {
    behaviorPassRate: metricNumber(baseline, 'behaviorPassRate', null),
    p95LatencyMs: metricNumber(baseline, 'p95LatencyMs', null),
    errorRate: metricNumber(baseline, 'errorRate', null),
    fallbackRate: metricNumber(baseline, 'fallbackRate', null),
  };
  const candidateMetrics = {
    behaviorPassRate: metricNumber(candidate, 'behaviorPassRate', null),
    p95LatencyMs: metricNumber(candidate, 'p95LatencyMs', null),
    errorRate: metricNumber(candidate, 'errorRate', null),
    fallbackRate: metricNumber(candidate, 'fallbackRate', null),
  };
  for (const [key, value] of Object.entries(candidateMetrics)) {
    if (value === null) blockers.push(`candidate_metric_missing:${key}`);
  }
  for (const [key, value] of Object.entries(baselineMetrics)) {
    if (value === null) blockers.push(`baseline_metric_missing:${key}`);
  }
  if (candidateMetrics.behaviorPassRate !== null && candidateMetrics.behaviorPassRate < minBehaviorPassRate) {
    blockers.push('behavior_pass_rate_below_threshold');
  }
  const latencyRegressionPct = pctRegression(candidateMetrics.p95LatencyMs, baselineMetrics.p95LatencyMs);
  if (latencyRegressionPct > maxLatencyRegressionPct) blockers.push('p95_latency_regression');
  const errorRateRegressionPct = pctRegression(candidateMetrics.errorRate, baselineMetrics.errorRate);
  if (errorRateRegressionPct > maxErrorRateRegressionPct) blockers.push('error_rate_regression');
  const fallbackRateRegressionPct = pctRegression(candidateMetrics.fallbackRate, baselineMetrics.fallbackRate);
  if (fallbackRateRegressionPct > maxFallbackRateRegressionPct) blockers.push('fallback_rate_regression');
  return {
    ok: true,
    ready: blockers.length === 0,
    result: blockers.length ? 'shadow_canary_comparison_blocked' : 'shadow_canary_comparison_ready',
    revision: PRODUCTION_MATURITY_LOOP_REVISION,
    baselineVersion: clean(baseline.version || baseline.commit || 'current'),
    candidateVersion: clean(candidate.version || candidate.commit || 'candidate'),
    blockers,
    regressions: {
      latencyRegressionPct: Number(latencyRegressionPct.toFixed(2)),
      errorRateRegressionPct: Number(errorRateRegressionPct.toFixed(2)),
      fallbackRateRegressionPct: Number(fallbackRateRegressionPct.toFixed(2)),
    },
    thresholds: {
      minBehaviorPassRate,
      maxLatencyRegressionPct,
      maxErrorRateRegressionPct,
      maxFallbackRateRegressionPct,
    },
    metrics: {
      baseline: baselineMetrics,
      candidate: candidateMetrics,
    },
  };
}
