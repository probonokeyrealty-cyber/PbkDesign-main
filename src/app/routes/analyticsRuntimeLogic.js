import { hasCompleteCostCoverage, hasCompleteRevenueCoverage, isClosedDealStage,
  normalizeDealStage, readAnalyticsMoney, recordedDealRevenue } from '../utils/analyticsEvidence.mjs';

export function numberOr(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function percentValue(value, digits = 1) {
  const numeric = numberOr(value, 0);
  const scaled = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return Number(scaled.toFixed(digits));
}

function arrayOr(value) {
  return Array.isArray(value) ? value : [];
}

function stageLabel(stage = '') {
  const key = String(stage || 'contacted').replace(/[_-]+/g, ' ');
  return key
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function normalizeAnalyticsLead(item = {}) {
  const stage = String(item.stage || item.stageKey || item.status || '').trim() || 'contacted';
  return {
    id: String(item.id || item.leadId || item.lead_id || '').trim(),
    name: String(item.name || item.leadName || item.lead_name || 'Unknown seller').trim(),
    address: String(item.address || '').trim(),
    stage,
    stageLabel: String(item.stageLabel || item.label || stageLabel(stage)).trim(),
    revenue: item.revenueBasis === 'recorded' ? recordedDealRevenue({ ...item, stage }) : null,
    revenueBasis: item.revenueBasis === 'recorded' && recordedDealRevenue({ ...item, stage }) !== null
      ? 'recorded' : 'unavailable',
    updatedAt: String(
      item.updatedAt || item.updated_at || item.createdAt || item.created_at || ''
    ).trim(),
  };
}

export function normalizeFunnel(stages = []) {
  return arrayOr(stages).map((stage) => {
    const stageKey = String(stage.stage || stage.key || stage.label || '').trim() || 'contacted';
    return {
      stage: stageKey,
      label: String(stage.label || stageLabel(stageKey)).trim(),
      total: Math.max(0, Math.round(numberOr(stage.total ?? stage.count, 0))),
      revenue: stage.revenueBasis === 'recorded'
        && hasCompleteRevenueCoverage(stage.revenueCoverage, Math.max(0, Math.round(numberOr(stage.total ?? stage.count, 0))))
        ? readAnalyticsMoney(stage.revenue) : null,
      revenueBasis: stage.revenueBasis || 'unavailable',
      leads: arrayOr(stage.leads || stage.items).map(normalizeAnalyticsLead),
    };
  });
}

export function normalizeDailyDeals(days = []) {
  return arrayOr(days).map((day) => ({
    day: String(day.day || day.date || '').trim(),
    count: Math.max(0, Math.round(numberOr(day.count ?? day.total, 0))),
    revenue: day.revenueBasis === 'recorded'
      && hasCompleteRevenueCoverage(day.revenueCoverage, Math.max(0, Math.round(numberOr(day.count ?? day.total, 0))))
      ? readAnalyticsMoney(day.revenue) : null,
    revenueBasis: day.revenueBasis || 'unavailable',
    leads: arrayOr(day.leads || day.items).map(normalizeAnalyticsLead),
  }));
}

export function normalizeAiMetrics(metrics = {}) {
  const p95Ms = numberOr(
    metrics.p95LatencyMs ?? metrics.p95_latency_ms ?? metrics.p95AnswerLatencyMs,
    0
  );
  const qaRetryRate = numberOr(
    metrics.qaRetryRate ?? metrics.qa_retry_rate ?? metrics.retryRate,
    0
  );
  const safetyBlocks = numberOr(metrics.safetyBlocks ?? metrics.safety_blocks, 0);
  return [
    {
      label: 'P95 answer latency',
      value: p95Ms ? `${(p95Ms / 1000).toFixed(p95Ms >= 1000 ? 1 : 2)}s` : '-',
      raw: p95Ms,
    },
    {
      label: 'QA retries',
      value: `${percentValue(qaRetryRate, 1)}%`,
      raw: qaRetryRate,
    },
    {
      label: 'Safety blocks',
      value: String(Math.max(0, Math.round(safetyBlocks))),
      raw: safetyBlocks,
    },
  ];
}

export function computeAnalyticsRoi({
  closed = 0,
  aiSpend = null,
  revenue = null,
  eligible = false,
} = {}) {
  const spend = readAnalyticsMoney(aiSpend);
  const totalRevenue = readAnalyticsMoney(revenue);
  const closedCount = Math.max(0, numberOr(closed, 0));
  const supported = eligible && spend !== null && spend > 0 && totalRevenue !== null;
  const ratio = supported ? totalRevenue / spend : NaN;
  return {
    aiSpend: spend,
    revenue: totalRevenue,
    costPerContactedLead: null,
    costPerQualifiedLead: null,
    roiMultiple: Number.isFinite(ratio) ? Number(ratio.toFixed(1)) : null,
    costPerClosedDeal: supported && closedCount > 0 ? Number((spend / closedCount).toFixed(2)) : null,
  };
}

export function confirmAnalyticsPeriod(timeline = {}, costs = {}, { days = 30, range = '' } = {}) {
  const expected = range === 'ytd' ? `ytd:${new Date().getUTCFullYear()}` : `rolling:${days}`;
  return timeline.reportingPeriod === expected && costs.reportingPeriod === expected
    && (range !== 'ytd' || timeline.range === 'ytd' && costs.range === 'ytd');
}

export function readCampaignAttributionCost(row = {}) {
  const basis = row.costBasis;
  const amount = basis === 'recorded' ? readAnalyticsMoney(row.costUsd ?? row.cost_usd)
    : basis === 'estimated' ? readAnalyticsMoney(row.estimatedCostUsd ?? row.estimated_cost_usd ?? row.costUsd) : null;
  return amount === null ? { basis: 'unavailable', amount: null } : { basis, amount };
}

export function buildAnalyticsViewModel({
  stagesResponse = {},
  timelineResponse = {},
  aiMetricsResponse = {},
} = {}) {
  const funnel = normalizeFunnel(stagesResponse.stages || stagesResponse.funnel || []);
  const dailyDeals = normalizeDailyDeals(timelineResponse.days || timelineResponse.timeline || []);
  const metrics = aiMetricsResponse.metrics || {};
  const closed = dailyDeals.reduce((sum, day) => sum + day.count, 0);
  const evidence = timelineResponse.financialEvidence;
  const revenueComplete = evidence?.version === 1
    && hasCompleteRevenueCoverage(evidence.revenueCoverage, closed)
    && dailyDeals.every(day => day.revenue !== null);
  const sum = dailyDeals.reduce((total, day) => total + (day.revenue ?? 0), 0);
  const revenue = revenueComplete && Number.isFinite(sum) ? sum : null;
  const costComplete = hasCompleteCostCoverage(metrics.costEvidence);
  const recordedCost = readAnalyticsMoney(metrics.aiSpendUsd);
  const aiSpend = costComplete && (metrics.costEvidence.recordedRecords > 0 || recordedCost === 0)
    ? recordedCost : null;
  const reportingPeriod = timelineResponse.reportingPeriod;
  const samePeriod = typeof reportingPeriod === 'string'
    && /^(rolling:[1-9]\d{0,2}|ytd:\d{4})$/.test(reportingPeriod)
    && reportingPeriod === aiMetricsResponse.reportingPeriod;
  const authoritative = [timelineResponse, aiMetricsResponse].every(response =>
    response.result === 'live' && !response.warning);
  const closingPeriod = timelineResponse.dateBasis === 'closed_at';
  const eligible = revenueComplete && costComplete && aiSpend !== null && aiSpend > 0 && samePeriod && authoritative && closingPeriod;
  return {
    source:
      [stagesResponse.source, timelineResponse.source, aiMetricsResponse.source]
        .filter(Boolean)
        .join(' + ') || 'runtime',
    generatedAt:
      stagesResponse.generatedAt ||
      timelineResponse.generatedAt ||
      aiMetricsResponse.generatedAt ||
      '',
    warnings: [stagesResponse.warning, timelineResponse.warning, aiMetricsResponse.warning].filter(
      Boolean
    ),
    funnel,
    dailyDeals,
    financial: {
      closedDeals: closed,
      rosterLeads: funnel.reduce((total, stage) => total + stage.total, 0),
      rosterClosed: funnel.filter(stage => isClosedDealStage(normalizeDealStage(stage.stage)))
        .reduce((total, stage) => total + stage.total, 0),
      revenue, aiSpend,
      dateBasis: timelineResponse.dateBasis || 'unconfirmed',
      estimatedAiSpend: readAnalyticsMoney(metrics.estimatedAiSpendUsd),
      revenueComplete, costComplete, eligible, reportingPeriod: reportingPeriod || '',
      revenueCoverage: evidence?.revenueCoverage || null,
      costEvidence: metrics.costEvidence || null,
      status: eligible ? 'Recorded' : !revenueComplete ? 'Revenue incomplete'
        : !costComplete || aiSpend === null ? 'Cost incomplete' : !samePeriod ? 'Period unconfirmed'
          : !authoritative ? 'Fallback data' : !closingPeriod ? 'Creation cohort' : 'Zero recorded cost',
    },
    aiMetrics: normalizeAiMetrics(metrics),
    roi: computeAnalyticsRoi({
      closed,
      aiSpend, revenue, eligible,
    }),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildAnalyticsCsv(model = {}) {
  const rows = [['section', 'label', 'total', 'revenue', 'lead_id', 'lead_name', 'address', 'revenue_basis',
    'recorded_tool_cost', 'estimated_tool_cost', 'cost_basis', 'reporting_period', 'revenue_cost_ratio',
    'evidence_status', 'source', 'warnings', 'date_basis']];
  if (model.financial) {
    const facts = model.financial;
    rows.push(['financial_summary', 'Selected period', facts.closedDeals, facts.revenue, '', '', '',
      facts.revenueComplete ? 'recorded' : 'unavailable', facts.aiSpend, facts.estimatedAiSpend,
      facts.costComplete ? 'recorded' : 'incomplete', facts.reportingPeriod, model.roi?.roiMultiple,
      facts.status, model.source, arrayOr(model.warnings).join(' | '), facts.dateBasis]);
  }
  for (const stage of arrayOr(model.funnel)) {
    rows.push(['funnel', stage.label, stage.total, stage.revenue, '', '', '', stage.revenueBasis]);
    for (const lead of arrayOr(stage.leads)) {
      rows.push(['funnel_lead', stage.label, '', lead.revenue, lead.id, lead.name, lead.address, lead.revenueBasis]);
    }
  }
  for (const day of arrayOr(model.dailyDeals)) {
    rows.push(['daily_deals', day.day, day.count, day.revenue, '', '', '', day.revenueBasis]);
    for (const lead of arrayOr(day.leads)) {
      rows.push(['daily_deal_lead', day.day, '', lead.revenue, lead.id, lead.name, lead.address, lead.revenueBasis]);
    }
  }
  for (const metric of arrayOr(model.aiMetrics)) {
    rows.push(['ai_metric', metric.label, metric.value, '', '', '', '']);
  }
  return `${rows.map((row) => rows[0].map((_, index) => csvCell(row[index])).join(',')).join('\n')}\n`;
}
