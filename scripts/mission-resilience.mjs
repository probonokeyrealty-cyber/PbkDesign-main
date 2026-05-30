import { createHash } from 'node:crypto';

const GOAL_LABELS = {
  sell_fast: 'Sell fast / certainty',
  top_dollar: 'Top dollar',
  avoid_repairs: 'Avoid repairs',
  avoid_foreclosure: 'Avoid foreclosure or payment pressure',
  low_hassle: 'Low hassle',
};

const GOAL_EVIDENCE = {
  sell_fast: [
    { pattern: /\b(fast|quick|asap|soon|immediately|today|this week|gone|need.*sell|ready)\b/i, weight: 2.4 },
    { pattern: /\b(tired|done|over it|move on)\b/i, weight: 1.3 },
  ],
  top_dollar: [
    { pattern: /\b(best price|top dollar|highest|more than|too low|zillow|worth|market value|retail)\b/i, weight: 2.2 },
  ],
  avoid_repairs: [
    { pattern: /\b(repair|repairs|as[- ]is|fix|fixing|another dime|work needed|condition)\b/i, weight: 2.1 },
  ],
  avoid_foreclosure: [
    { pattern: /\b(foreclosure|behind|arrears|late payment|auction|notice of default|payment)\b/i, weight: 2.5 },
  ],
  low_hassle: [
    { pattern: /\b(no hassle|simple|easy|stress|headache|tenant|probate|executor)\b/i, weight: 1.8 },
  ],
};

function clamp(value, min = 0, max = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function slug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stableHash(value = '') {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeDistribution(values = {}) {
  const entries = Object.entries(values).map(([key, value]) => [slug(key), Math.max(0.0001, Number(value) || 0.0001)]);
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  return Object.fromEntries(entries.map(([key, value]) => [key, Number((value / total).toFixed(6))]));
}

function entropy01(distribution = {}) {
  const values = Object.values(distribution).filter((value) => value > 0);
  if (values.length <= 1) return 0;
  const entropy = values.reduce((sum, value) => sum - value * Math.log2(value), 0);
  return Number((entropy / Math.log2(values.length)).toFixed(6));
}

function goalEvidenceForUtterance(utterance = '') {
  const evidence = {};
  Object.entries(GOAL_EVIDENCE).forEach(([goalId, matchers]) => {
    const weight = matchers.reduce((sum, matcher) => sum + (matcher.pattern.test(utterance) ? matcher.weight : 0), 0);
    if (weight > 0) evidence[goalId] = weight;
  });
  return evidence;
}

export function updateGoalBeliefsBayesian(params = {}) {
  const utterance = String(params.utterance || params.transcript || params.text || '').trim();
  const previousBeliefs = normalizeDistribution(params.previousBeliefs || params.prior || {
    sell_fast: 0.2,
    top_dollar: 0.2,
    avoid_repairs: 0.2,
    avoid_foreclosure: 0.2,
    low_hassle: 0.2,
  });
  const evidence = goalEvidenceForUtterance(utterance);
  const likelihoods = {};

  Object.keys(previousBeliefs).forEach((goalId) => {
    const evidenceBoost = evidence[goalId] || 0;
    const contextualBoost =
      goalId === 'avoid_foreclosure' && /foreclosure|mortgage_takeover|subject/i.test(String(params.outcomeContext?.path || '')) ? 0.4 : 0;
    likelihoods[goalId] = 1 + evidenceBoost + contextualBoost;
  });

  const posterior = normalizeDistribution(
    Object.fromEntries(Object.entries(previousBeliefs).map(([goalId, prior]) => [goalId, prior * (likelihoods[goalId] || 1)])),
  );
  const ranked = Object.entries(posterior)
    .map(([id, confidence]) => ({ id, label: GOAL_LABELS[id] || id, confidence }))
    .sort((left, right) => right.confidence - left.confidence);
  const uncertainty = entropy01(posterior);

  return {
    ok: true,
    result: 'goal_beliefs_updated',
    schema: 'pbk.good.bayesian.v1',
    beliefs: posterior,
    evidence,
    topGoal: ranked[0] || null,
    secondaryGoals: ranked.slice(1, 4),
    uncertainty,
    uncertaintyHigh: uncertainty >= 0.62,
    goalClarifyingQuestion: uncertainty >= 0.62
      ? 'What matters most right now: speed, certainty, price, or not having to repair anything?'
      : '',
    trajectoryEvent: {
      eventType: 'goal_inference_updated',
      callId: params.callId || params.call_id || '',
      leadId: params.leadId || params.lead_id || '',
      utterance,
      beliefs: posterior,
      evidence,
      createdAt: params.now || new Date().toISOString(),
    },
  };
}

function pathScore(path = '', params = {}) {
  const normalized = slug(path);
  const signal = String(params.sellerSignal || params.transcript || '').toLowerCase();
  const beliefs = params.goalBeliefs || {};
  let score = 0;
  const reasons = [];

  if (normalized === 'cash') {
    score += (beliefs.sell_fast || 0) * 45 + (beliefs.avoid_repairs || 0) * 30;
    reasons.push('cash_speed_certainty');
  }
  if (['rbp', 'novation', 'retail_buyer_program'].includes(normalized)) {
    score += (beliefs.top_dollar || 0) * 55 + (beliefs.low_hassle || 0) * 18;
    reasons.push('rbp_price_recovery');
  }
  if (['creative_finance', 'seller_finance', 'subject_to'].includes(normalized)) {
    score += (beliefs.avoid_foreclosure || 0) * 45 + (beliefs.top_dollar || 0) * 25;
    reasons.push('creative_finance_optional_value');
  }
  if (normalized === 'mortgage_takeover') {
    score += (beliefs.avoid_foreclosure || 0) * 60;
    reasons.push('payment_pressure_fit');
  }
  if (/too low|more than|highest|zillow|market/.test(signal) && ['rbp', 'novation', 'retail_buyer_program'].includes(normalized)) {
    score += 38;
    reasons.push('seller_rejected_low_cash_price');
  }
  if (/payment|behind|foreclosure/.test(signal) && ['creative_finance', 'mortgage_takeover', 'subject_to'].includes(normalized)) {
    score += 34;
    reasons.push('payment_pressure_signal');
  }

  return { path: normalized, score, reasons };
}

export function selectBacktrackingStrategy(params = {}) {
  const selectedPath = slug(params.selectedPath || params.currentPath || '');
  const history = Array.isArray(params.pathHistory) ? params.pathHistory : [];
  const availablePaths = (Array.isArray(params.availablePaths) ? params.availablePaths : ['cash', 'rbp', 'creative_finance', 'mortgage_takeover'])
    .map(slug)
    .filter(Boolean);
  const failedPaths = new Set(
    history
      .filter((item) => /reject|failed|dead_end|no_fit|stalled/i.test(String(item.outcome || item.status || '')))
      .map((item) => slug(item.path)),
  );
  if (selectedPath && /too low|not enough|reject|no|more than|highest/i.test(String(params.sellerSignal || ''))) {
    failedPaths.add(selectedPath);
  }

  const candidates = availablePaths
    .filter((path) => !failedPaths.has(path))
    .map((path) => pathScore(path, params))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const selected = candidates[0] || { path: selectedPath || availablePaths[0] || 'cash', score: 0, reasons: ['no_alternative_available'] };

  return {
    ok: true,
    result: 'backtrack_strategy_selected',
    schema: 'pbk.encompass.backtracking.v1',
    backtrackedFrom: selectedPath || null,
    nextPath: selected.path,
    score: Number(selected.score.toFixed(3)),
    reasonCodes: [
      ...(failedPaths.has(selectedPath) ? ['seller_rejected_current_path'] : []),
      ...selected.reasons,
      'do_not_repeat_failed_script',
    ],
    exploredPaths: [...failedPaths],
    plan: [
      { step: 'acknowledge_rejection', instruction: 'Acknowledge the seller rejected the current angle without arguing.' },
      { step: 'reframe_goal', instruction: 'Restate the likely seller goal before introducing the alternate path.' },
      { step: 'test_alternative', instruction: `Ask permission to compare the ${selected.path} option against the rejected path.` },
      { step: 'lock_or_backtrack_again', instruction: 'If the seller rejects again, log the outcome and choose the next highest-scoring path.' },
    ],
  };
}

export function buildDeclarativeActionIntent(params = {}) {
  const toolName = String(params.toolName || params.tool || '').trim();
  const leadId = String(params.leadId || params.lead_id || '').trim();
  const desiredState = params.desiredState && typeof params.desiredState === 'object' ? params.desiredState : {};
  const canonicalDesiredState = Object.fromEntries(
    Object.entries(desiredState)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const idempotencyKey = stableHash(JSON.stringify({ toolName, leadId, desiredState: canonicalDesiredState }));
  return {
    id: `intent-${idempotencyKey.slice(0, 20)}`,
    idempotencyKey,
    toolName,
    leadId,
    desiredState: canonicalDesiredState,
    mode: 'declarative_reconcile',
    createdAt: params.createdAt || new Date().toISOString(),
  };
}

export function reconcileDeclarativeActionIntent(intent = {}, existingIntents = []) {
  const normalizedIntent = intent.idempotencyKey ? intent : buildDeclarativeActionIntent(intent);
  const existing = existingIntents.find((item) => (
    item?.idempotencyKey && item.idempotencyKey === normalizedIntent.idempotencyKey
  ) || (
    item?.toolName === normalizedIntent.toolName
    && item?.leadId === normalizedIntent.leadId
    && stableHash(JSON.stringify(item?.desiredState || {})) === stableHash(JSON.stringify(normalizedIntent.desiredState || {}))
  ));

  if (existing) {
    return {
      ok: true,
      result: 'already_satisfied',
      providerWriteRequired: false,
      existingIntent: existing,
      idempotencyKey: normalizedIntent.idempotencyKey,
      reason: 'matching_desired_state_already_recorded',
    };
  }

  return {
    ok: true,
    result: 'action_required',
    providerWriteRequired: true,
    intentRecord: {
      ...normalizedIntent,
      status: 'pending_reconcile',
      attempts: 0,
      lastObservedState: {},
    },
    nextStep: `Reconcile ${normalizedIntent.toolName} only if the desired state is not already true.`,
  };
}

function daysBetween(now, dateValue) {
  const then = Date.parse(dateValue || '');
  if (!Number.isFinite(then)) return 9999;
  return Math.max(0, (Date.parse(now) - then) / 86_400_000);
}

export function curateEpisodicMemories(params = {}) {
  const now = params.now || new Date().toISOString();
  const staleDays = Number(params.staleDays || params.stale_days || 120);
  const memories = Array.isArray(params.memories) ? params.memories : [];
  const keep = [];
  const review = [];
  const deleteList = [];

  memories.forEach((memory) => {
    const quality = clamp(memory.qualityScore ?? memory.quality_score ?? memory.score ?? 0.5);
    const confidence = clamp(memory.confidence ?? 0.5);
    const ageDays = daysBetween(now, memory.lastAccessedAt || memory.last_accessed_at || memory.updatedAt || memory.createdAt);
    const outcome = String(memory.outcome || '').toLowerCase();
    const winning = /closed|signed|appointment|accepted|won|success/.test(outcome);
    const harmful = /bad|failed|wrong|complaint|dnc|unsafe|misaligned/.test(outcome);
    const valueScore = Number(((quality * 0.52) + (confidence * 0.28) + (winning ? 0.25 : 0) - (harmful ? 0.24 : 0) - (ageDays > staleDays ? 0.18 : 0)).toFixed(4));
    const item = {
      ...memory,
      curationScore: valueScore,
      ageDays: Math.round(ageDays),
    };

    if (winning || valueScore >= 0.55) keep.push({ ...item, curationAction: 'keep' });
    else if (valueScore <= 0.22 && ageDays >= staleDays) deleteList.push({ ...item, curationAction: 'delete', deleteReason: 'stale_low_quality_or_harmful' });
    else review.push({ ...item, curationAction: 'review' });
  });

  return {
    ok: true,
    result: 'memory_curation_planned',
    schema: 'pbk.memo.selective_curation.v1',
    keep,
    review,
    delete: deleteList,
    summary: {
      total: memories.length,
      keepCount: keep.length,
      reviewCount: review.length,
      deleteCount: deleteList.length,
      staleDays,
    },
  };
}

export function runMissionResilienceEval(params = {}) {
  const eventBus = params.eventBus || {};
  const registry = params.registry || {};
  const conversations = Array.isArray(params.conversations) ? params.conversations : [];
  const toolAttempts = Array.isArray(params.toolAttempts) ? params.toolAttempts : [];
  const memoryCuration = params.memoryCuration || {};
  const coverage = [];

  const orchestration = eventBus.connected !== false && eventBus.mode === 'redis'
    ? Math.max(70, 100 - Math.max(0, Number(eventBus.pending || 0) * 2) - Math.max(0, Number(eventBus.backlog || 0) - 10))
    : 55;
  const healthyAgents = Array.isArray(registry.agents)
    ? registry.agents.filter((agent) => /active|healthy|ready/i.test(String(agent.status || 'active'))).length
    : 0;
  const registryScore = healthyAgents >= 2 ? 95 : healthyAgents === 1 ? 78 : 50;
  const duplicateSuppressed = toolAttempts.filter((attempt) => attempt.duplicateSuppressed || attempt.result === 'already_satisfied').length;
  const idempotencyScore = toolAttempts.length ? Math.min(100, 72 + duplicateSuppressed * 28) : 82;
  const avgWastedTurns = conversations.length
    ? conversations.reduce((sum, call) => sum + Number(call.wastedTurns || 0), 0) / conversations.length
    : 0;
  const backtrackingScore = conversations.some((call) => call.backtrackingUsed)
    ? Math.max(82, 100 - avgWastedTurns * 6)
    : 74;
  const memoryScore = memoryCuration.result === 'memory_curation_planned'
    ? Math.min(100, 82 + Number(memoryCuration.summary?.deleteCount || 0) * 4)
    : 65;

  if (idempotencyScore >= 90) coverage.push('idempotent_tools');
  if (memoryScore >= 80) coverage.push('selective_memory');
  if (backtrackingScore >= 80) coverage.push('backtracking');
  if (orchestration >= 85) coverage.push('orchestration');
  if (registryScore >= 85) coverage.push('agent_registry');

  const scores = {
    orchestration: Math.round(orchestration),
    registry: Math.round(registryScore),
    idempotency: Math.round(idempotencyScore),
    backtracking: Math.round(backtrackingScore),
    memory: Math.round(memoryScore),
  };
  const score = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.values(scores).length);
  const ok = score >= 85 && scores.orchestration >= 80 && scores.idempotency >= 80;

  return {
    ok,
    result: ok ? 'mission_resilience_eval_passed' : 'mission_resilience_eval_failed',
    schema: 'pbk.maseval.mission_resilience.v1',
    score,
    scores,
    coverage,
    assertions: [
      { id: 'event_bus_connected', ok: eventBus.connected !== false && eventBus.mode === 'redis' },
      { id: 'registry_has_healthy_agents', ok: healthyAgents >= 2 },
      { id: 'idempotency_checked', ok: idempotencyScore >= 80 },
      { id: 'memory_curation_checked', ok: memoryScore >= 80 },
      { id: 'backtracking_checked', ok: backtrackingScore >= 75 },
    ],
  };
}
