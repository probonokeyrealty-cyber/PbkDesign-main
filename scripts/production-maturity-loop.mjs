export const PRODUCTION_MATURITY_LOOP_REVISION =
  '2026-06-13-production-maturity-loop-v1';

const WIN_OUTCOMES = new Set([
  'appointment',
  'appointment_set',
  'booked',
  'contract',
  'contract_signed',
  'signed',
  'closed',
  'won',
  'offer_accepted',
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
    const outcome = normalizeCode(row.finalOutcome || row.final_outcome || row.outcome || row.outcomeLabel);
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
        normalizeCode(row.finalOutcome || row.final_outcome || row.outcome || row.outcomeLabel)
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
