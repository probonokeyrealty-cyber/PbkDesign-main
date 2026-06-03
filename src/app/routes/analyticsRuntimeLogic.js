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
    revenue: numberOr(
      item.revenue ?? item.amount ?? item.estimatedProfit ?? item.estimated_profit,
      0
    ),
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
      revenue: numberOr(stage.revenue, 0),
      leads: arrayOr(stage.leads || stage.items).map(normalizeAnalyticsLead),
    };
  });
}

export function normalizeDailyDeals(days = []) {
  return arrayOr(days).map((day) => ({
    day: String(day.day || day.date || '').trim(),
    count: Math.max(0, Math.round(numberOr(day.count ?? day.total, 0))),
    revenue: numberOr(day.revenue ?? day.amount ?? day.estimatedProfit ?? day.estimated_profit, 0),
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
  contacted = 0,
  qualified = 0,
  closed = 0,
  aiSpend = 0,
  revenue = 0,
} = {}) {
  const spend = numberOr(aiSpend, 0);
  const totalRevenue = numberOr(revenue, 0);
  const contactedCount = Math.max(0, numberOr(contacted, 0));
  const qualifiedCount = Math.max(0, numberOr(qualified, 0));
  const closedCount = Math.max(0, numberOr(closed, 0));
  return {
    aiSpend: spend,
    revenue: totalRevenue,
    costPerContactedLead: spend && contactedCount ? Number((spend / contactedCount).toFixed(2)) : 0,
    costPerQualifiedLead: spend && qualifiedCount ? Number((spend / qualifiedCount).toFixed(2)) : 0,
    roiMultiple: spend ? Number((totalRevenue / spend).toFixed(1)) : 0,
    costPerClosedDeal: spend && closedCount ? Number((spend / closedCount).toFixed(2)) : 0,
  };
}

export function buildAnalyticsViewModel({
  stagesResponse = {},
  timelineResponse = {},
  aiMetricsResponse = {},
} = {}) {
  const funnel = normalizeFunnel(stagesResponse.stages || stagesResponse.funnel || []);
  const dailyDeals = normalizeDailyDeals(timelineResponse.days || timelineResponse.timeline || []);
  const metrics = aiMetricsResponse.metrics || {};
  const contacted = funnel.reduce((sum, stage) => sum + stage.total, 0);
  const qualified = funnel
    .filter((stage) => /qualif|offer|closed|won/i.test(`${stage.stage} ${stage.label}`))
    .reduce((sum, stage) => sum + stage.total, 0);
  const closed = funnel
    .filter((stage) => /closed|won|signed|funded/i.test(`${stage.stage} ${stage.label}`))
    .reduce((sum, stage) => sum + stage.total, 0);
  const revenue = dailyDeals.reduce((sum, day) => sum + day.revenue, 0);
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
    aiMetrics: normalizeAiMetrics(metrics),
    roi: computeAnalyticsRoi({
      contacted,
      qualified,
      closed,
      aiSpend: metrics.aiSpendUsd ?? metrics.ai_spend_usd ?? metrics.aiSpend ?? 0,
      revenue,
    }),
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildAnalyticsCsv(model = {}) {
  const rows = [['section', 'label', 'total', 'revenue', 'lead_id', 'lead_name', 'address']];
  for (const stage of arrayOr(model.funnel)) {
    rows.push(['funnel', stage.label, stage.total, stage.revenue, '', '', '']);
    for (const lead of arrayOr(stage.leads)) {
      rows.push(['funnel_lead', stage.label, '', lead.revenue, lead.id, lead.name, lead.address]);
    }
  }
  for (const day of arrayOr(model.dailyDeals)) {
    rows.push(['daily_deals', day.day, day.count, day.revenue, '', '', '']);
    for (const lead of arrayOr(day.leads)) {
      rows.push(['daily_deal_lead', day.day, '', lead.revenue, lead.id, lead.name, lead.address]);
    }
  }
  for (const metric of arrayOr(model.aiMetrics)) {
    rows.push(['ai_metric', metric.label, metric.value, metric.raw ?? '', '', '', '']);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}
