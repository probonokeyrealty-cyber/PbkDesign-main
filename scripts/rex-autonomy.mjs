const DEFAULT_MONTHLY_TARGET = 1000000;
const DEFAULT_MIN_CALLS_FOR_MODEL = 500;

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOutcome(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isAcceptedOffer(call = {}) {
  const outcome = normalizeOutcome(call.outcome || call.status || call.result || call.outcomeLabel || call.outcome_label);
  return /offer_accepted|contract_signed|signed|closed|won/.test(outcome);
}

function getProfit(call = {}) {
  return Math.max(0, numberOr(call.profit ?? call.assignmentFee ?? call.assignment_fee ?? call.netProfit ?? call.net_profit ?? call.revenue, 0));
}

function countTags(items = []) {
  const counts = new Map();
  for (const item of items) {
    const tags = Array.isArray(item.failureTags)
      ? item.failureTags
      : Array.isArray(item.failure_tags)
        ? item.failure_tags
        : [];
    for (const tag of tags) {
      const normalized = String(tag || '').trim().toLowerCase();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag, count]) => ({ tag, count }));
}

export function buildRexKpiSnapshot(params = {}) {
  const calls = Array.isArray(params.calls) ? params.calls : [];
  const callAnalyses = Array.isArray(params.callAnalyses || params.call_analyses) ? (params.callAnalyses || params.call_analyses) : [];
  const prosodyDecisions = Array.isArray(params.prosodyDecisions || params.prosody_decisions) ? (params.prosodyDecisions || params.prosody_decisions) : [];
  const acceptedOffers = calls.filter(isAcceptedOffer).length;
  const totalProfit = calls.reduce((sum, call) => sum + getProfit(call), 0);
  const measuredProsody = prosodyDecisions.filter((item) => typeof item.outcomeSuccess === 'boolean' || typeof item.outcome_success === 'boolean').length;
  const targetMonthlyRevenue = Math.max(1, numberOr(params.targetMonthlyRevenue ?? params.target_monthly_revenue, DEFAULT_MONTHLY_TARGET));
  return {
    generatedAt: params.generatedAt || params.generated_at || new Date().toISOString(),
    totalCalls: calls.length,
    acceptedOffers,
    conversionRate: calls.length ? acceptedOffers / calls.length : 0,
    totalProfit,
    averageProfit: calls.length ? totalProfit / calls.length : 0,
    targetMonthlyRevenue,
    monthlyRunRate: Math.max(0, numberOr(params.monthlyRunRate ?? params.monthly_run_rate, 0)),
    targetGap: Math.max(0, targetMonthlyRevenue - Math.max(0, numberOr(params.monthlyRunRate ?? params.monthly_run_rate, 0))),
    analyzedCalls: callAnalyses.length,
    averageCallScore: callAnalyses.length
      ? callAnalyses.reduce((sum, item) => sum + numberOr(item.score, 0), 0) / callAnalyses.length
      : 0,
    topFailureTags: countTags(callAnalyses).slice(0, 8),
    measuredProsody,
    onnxDataReady: calls.length >= numberOr(params.minCallsForModel, DEFAULT_MIN_CALLS_FOR_MODEL),
  };
}

function makeGoal(fields = {}, index = 0, now = new Date().toISOString()) {
  const priority = fields.priority || (index === 0 ? 'high' : index === 1 ? 'medium' : 'low');
  const actionType = fields.actionType || 'rex_autonomous_goal';
  const title = String(fields.title || `Rex autonomous goal ${index + 1}`).trim();
  return {
    id: fields.id || `rex-goal-${actionType}-${index + 1}-${now.slice(0, 10)}`,
    actionId: fields.actionId || `${actionType}_${index + 1}`,
    actionType,
    title,
    label: fields.label || title,
    description: String(fields.description || fields.reason || '').trim(),
    reason: String(fields.reason || fields.description || '').trim(),
    successMetric: String(fields.successMetric || fields.success_metric || 'Measured improvement recorded in PBK outcomes.').trim(),
    target: String(fields.target || 'pbk').trim(),
    priority,
    riskLevel: fields.riskLevel || 'low',
    providerWritesBlocked: true,
    approvalRequired: fields.approvalRequired !== false,
    metadata: {
      schemaVersion: 'pbk-rex-autonomous-goal-v1',
      source: 'rex-autonomy',
      ...(fields.metadata || {}),
    },
    createdAt: now,
  };
}

export function proposeAutonomousRexGoals(kpis = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const goals = [];
  const totalCalls = numberOr(kpis.totalCalls, 0);
  const topFailure = Array.isArray(kpis.topFailureTags) ? kpis.topFailureTags[0] : null;

  if (totalCalls < numberOr(options.minCallsForModel, DEFAULT_MIN_CALLS_FOR_MODEL)) {
    goals.push(makeGoal({
      actionId: 'collect_500_live_calls',
      actionType: 'learning_data_collection',
      title: 'Collect 500 clean Ava call outcomes',
      description: `Current sample is ${totalCalls}; ONNX emotion/prosody models need 500+ labeled calls.`,
      reason: 'Ava, Call Analyzer, and Prosody Tuner cannot reach ML accuracy until real outcomes are captured.',
      successMetric: '500 calls with transcript, outcome, emotion/prosody rows, and call embedding.',
      target: 'ava_calls',
      priority: 'high',
      approvalRequired: true,
      metadata: { currentCalls: totalCalls, targetCalls: 500 },
    }, goals.length, now));
  }

  if (topFailure?.tag) {
    goals.push(makeGoal({
      actionId: `reduce_${topFailure.tag}`,
      actionType: 'call_quality_improvement',
      title: `Reduce Ava failure pattern: ${topFailure.tag}`,
      description: `${topFailure.count} recent analyzed calls showed ${topFailure.tag}.`,
      reason: 'Rex should proactively turn repeated call failures into focused script/prosody experiments.',
      successMetric: `Reduce ${topFailure.tag} by 30% over the next 30 measured calls.`,
      target: 'ava_call_intelligence',
      priority: 'high',
      approvalRequired: false,
      metadata: { topFailure },
    }, goals.length, now));
  }

  if (numberOr(kpis.conversionRate, 0) < numberOr(options.targetConversionRate, 0.18)) {
    goals.push(makeGoal({
      actionId: 'raise_ava_conversion_rate',
      actionType: 'conversion_optimization',
      title: 'Raise Ava conversion rate with focused script tests',
      description: `Current conversion is ${(numberOr(kpis.conversionRate, 0) * 100).toFixed(1)}%.`,
      reason: 'Script Rotator should test challenger lines where seller intent and objection history are strongest.',
      successMetric: 'Improve accepted-offer or appointment-set rate by 5 percentage points.',
      target: 'script_rotator',
      priority: 'medium',
      approvalRequired: false,
      metadata: { conversionRate: kpis.conversionRate || 0 },
    }, goals.length, now));
  }

  if (numberOr(kpis.measuredProsody, 0) < 100) {
    goals.push(makeGoal({
      actionId: 'increase_measured_prosody_rows',
      actionType: 'prosody_data_collection',
      title: 'Increase measured prosody rows for voice tuning',
      description: `Current measured prosody rows: ${numberOr(kpis.measuredProsody, 0)}.`,
      reason: 'Prosody Tuner needs measured outcomes before it can graduate from rules to ONNX-backed choices.',
      successMetric: '100 measured prosody rows with success labels.',
      target: 'prosody_tuner',
      priority: 'medium',
      approvalRequired: false,
      metadata: { measuredProsody: kpis.measuredProsody || 0 },
    }, goals.length, now));
  }

  if (!goals.length || numberOr(kpis.targetGap, 0) > 0) {
    goals.push(makeGoal({
      actionId: 'close_revenue_gap',
      actionType: 'revenue_alignment',
      title: 'Close monthly revenue gap with hot-lead follow-up',
      description: `Revenue gap is $${Math.round(numberOr(kpis.targetGap, 0)).toLocaleString()}.`,
      reason: 'Rex should prioritize high-motivation leads and follow-up loops while provider writes remain approval-safe.',
      successMetric: 'Create at least 10 high-motivation follow-up tasks and measure booked calls.',
      target: 'rex_outreach',
      priority: 'medium',
      approvalRequired: true,
      metadata: { targetGap: kpis.targetGap || 0 },
    }, goals.length, now));
  }

  return goals.slice(0, 3);
}

function extractMotivationScore(payload = {}) {
  return Math.max(0, Math.min(100, numberOr(
    payload.motivationScore ?? payload.motivation_score ?? payload.leadScore ?? payload.lead_score ?? payload.score,
    0,
  )));
}

export function selectRexProactiveLeadAction(payload = {}, options = {}) {
  const motivationScore = extractMotivationScore(payload);
  const leadId = String(payload.leadId || payload.lead_id || payload.id || '').trim();
  const phone = String(payload.phone || payload.phoneNumber || payload.phone_number || '').trim();
  const dnc = Boolean(payload.dnc || payload.doNotCall || payload.do_not_call || payload.isDnc || payload.is_dnc);
  const nowLocalHour = Number.isFinite(Number(options.nowLocalHour)) ? Number(options.nowLocalHour) : new Date().getHours();
  const insideCallingWindow = nowLocalHour >= numberOr(options.callStartHour, 8) && nowLocalHour < numberOr(options.callEndHour, 20);
  const base = {
    leadId,
    phone,
    motivationScore,
    providerWritesBlocked: true,
    approvalRequired: true,
    reason: '',
    metadata: {
      source: 'rex-autonomy',
      insideCallingWindow,
      dnc,
    },
  };

  if (dnc) {
    return { ...base, action: 'do_not_call', reason: 'Lead is marked DNC.' };
  }
  if (!phone) {
    return { ...base, action: 'needs_phone', reason: 'Lead has no callable phone number.' };
  }
  if (!insideCallingWindow) {
    return { ...base, action: 'schedule_for_calling_window', reason: 'Lead is hot but outside permissible calling hours.' };
  }
  if (motivationScore >= numberOr(options.hotLeadThreshold, 80)) {
    return { ...base, action: 'queue_call', reason: `Motivation score ${motivationScore} exceeds hot-lead threshold.` };
  }
  if (motivationScore >= numberOr(options.reviewThreshold, 65)) {
    return { ...base, action: 'create_rex_decision', reason: `Motivation score ${motivationScore} should be reviewed for follow-up.` };
  }
  return { ...base, action: 'observe', approvalRequired: false, reason: `Motivation score ${motivationScore} is below proactive threshold.` };
}
