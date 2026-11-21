import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnalyticsCsv, buildAnalyticsViewModel, normalizeAnalyticsLead, normalizeDailyDeals,
} from '../src/app/routes/analyticsRuntimeLogic.js';
import { hasCompleteCostCoverage, isClosedDealStage, readAnalyticsMoney, recordedDealRevenue,
  summarizeRecordedRevenue } from '../src/app/utils/analyticsEvidence.mjs';
import * as analytics from '../src/app/routes/analyticsRuntimeLogic.js';

const coverage = count => ({ version: 1, totalRecords: count, recordedRecords: count, missingRecords: 0 });
function supportedModel({ revenue = 25000, cost = 100, period = 'rolling:30', costPeriod = period,
  estimatedRecords = 0, missingRecords = 0, fallback = false } = {}) {
  return buildAnalyticsViewModel({
    stagesResponse: { stages: [{ stage: 'assigned', total: 99 }, { stage: 'closed', total: 1 }] },
    timelineResponse: { result: fallback ? 'local_view_only' : 'live', reportingPeriod: period, dateBasis: 'closed_at',
      financialEvidence: { version: 1, revenueCoverage: coverage(1) },
      days: [{ day: '2026-11-21', count: 1, revenue, revenueBasis: 'recorded', revenueCoverage: coverage(1) }] },
    aiMetricsResponse: { result: 'live', reportingPeriod: costPeriod, metrics: {
      aiSpendUsd: cost, estimatedAiSpendUsd: estimatedRecords ? 5 : 0,
      costEvidence: { version: 1, totalRecords: 1 + estimatedRecords + missingRecords,
        recordedRecords: 1, estimatedRecords, missingRecords } } },
  });
}

test('assigned and signed stages do not produce a cost per closed deal', () => {
  for (const stage of ['assigned', 'unsigned', 'signed', 'incomplete', 'not_closed']) {
    const model = buildAnalyticsViewModel({
      stagesResponse: { stages: [{ stage, total: 5 }] },
      aiMetricsResponse: { metrics: { aiSpendUsd: 100 } },
    });
    assert.equal(model.roi.costPerClosedDeal, null, stage);
  }
});

test('projected profit and purchase amounts cannot become timeline revenue', () => {
  for (const financial of [{ estimatedProfit: 25000 }, { estimated_profit: 25000 }, { amount: 900000 }]) {
    const [day] = normalizeDailyDeals([{ day: '2026-11-21', count: 1, ...financial }]);
    assert.equal(day.revenue, null);
  }
});

test('lead revenue requires a terminal deal stage and an explicit revenue field', () => {
  for (const record of [
    { stage: 'signed', revenue: 25000 },
    { stage: 'assigned', revenue: 25000 },
    { stage: 'closed', estimatedProfit: 25000 },
    { stage: 'closed', amount: 900000 },
    { stage: 'closed', assignmentFee: 25000 },
  ]) assert.equal(normalizeAnalyticsLead({ id: 'SYN-ONLY', ...record }).revenue, null);
});

test('explicit recorded zero is distinct from missing, malformed, and negative revenue', () => {
  assert.equal(normalizeAnalyticsLead({ stage: 'closed', revenue: 0, revenueBasis: 'recorded' }).revenue, 0);
  assert.equal(normalizeAnalyticsLead({ stage: 'closed', revenue: 0 }).revenue, null, 'legacy zero lacks evidence');
  for (const revenue of [undefined, null, '', 'no data', -1, true, Infinity]) {
    assert.equal(normalizeAnalyticsLead({ stage: 'closed', revenue, revenueBasis: 'recorded' }).revenue, null);
  }
});

test('legacy monetary totals without reporting evidence do not produce a ratio', () => {
  const model = buildAnalyticsViewModel({
    timelineResponse: { days: [{ day: '2026-11-21', count: 1, revenue: 25000 }] },
    aiMetricsResponse: { metrics: { aiSpendUsd: 100 } },
  });
  assert.equal(model.roi.roiMultiple, null);
});

test('CSV excludes forecasts and does not turn missing revenue into zero', () => {
  const model = buildAnalyticsViewModel({
    timelineResponse: { days: [{ day: '2026-11-21', count: 1, estimatedProfit: 25000 }] },
  });
  const csv = buildAnalyticsCsv(model);
  assert.doesNotMatch(csv, /25000/);
  assert.match(csv, /daily_deals,2026-11-21,1,,/);
});

test('normalizing analytics does not mutate the sample records', () => {
  const input = { stagesResponse: { stages: [{ stage: 'assigned', total: 5 }] },
    timelineResponse: { days: [{ day: '2026-11-21', count: 1, estimatedProfit: 25000 }] } };
  const before = structuredClone(input);
  buildAnalyticsViewModel(input);
  assert.deepEqual(input, before);
});

test('stage aliases use exact canonical terminal values, never substrings', () => {
  for (const stage of ['closed', 'won', 'funded', ' CLOSED WON ', 'closed-funded', 'deal_closed']) {
    assert.equal(isClosedDealStage(stage), true, stage);
  }
  for (const stage of ['assigned', 'signed', 'unsigned', 'not_closed', 'incomplete', 'completed', 'unfunded']) {
    assert.equal(isClosedDealStage(stage), false, stage);
  }
});

test('money parsing preserves zero and rejects malformed, negative, boolean, and infinite values', () => {
  assert.equal(readAnalyticsMoney('$1,234.50'), 1234.5);
  assert.equal(readAnalyticsMoney('0'), 0);
  for (const value of [undefined, null, '', ' ', '1,2,3', '$-3', -1, true, NaN, Infinity, '1e999']) {
    assert.equal(readAnalyticsMoney(value), null, String(value));
  }
});

test('recorded revenue does not fall back through an explicitly missing field or an estimate basis', () => {
  assert.equal(recordedDealRevenue({ status: 'closed', payload: { revenue: 1200 } }), 1200);
  assert.equal(recordedDealRevenue({ status: 'closed', revenue: null, payload: { revenue: 1200 } }), null);
  assert.equal(recordedDealRevenue({ status: 'closed', revenue: 1200, revenueBasis: 'estimated' }), null);
  const records = [{ stage: 'closed', revenue: 10 }, { stage: 'funded', amount: 900000 }];
  assert.equal(summarizeRecordedRevenue(records).revenue, null);
  assert.equal(summarizeRecordedRevenue(records).revenueCoverage.missingRecords, 1);
});

test('a supported ratio uses period closings, not the global assigned roster', () => {
  const model = supportedModel();
  assert.equal(model.financial.rosterLeads, 100);
  assert.equal(model.financial.closedDeals, 1);
  assert.equal(model.roi.roiMultiple, 250);
  assert.equal(model.roi.costPerClosedDeal, 100);
  assert.equal(model.roi.costPerContactedLead, null, 'no invented period cohort');
  assert.equal(supportedModel({ revenue: 0 }).roi.roiMultiple, 0);
});

test('mixed/unknown/invalid cost, legacy periods, and fallback data withhold ratios', () => {
  for (const options of [{ estimatedRecords: 1 }, { missingRecords: 1 }, { cost: -1 },
    { cost: null }, { cost: 0 }, { costPeriod: 'rolling:7' }, { period: '' }, { fallback: true }]) {
    assert.equal(supportedModel(options).roi.roiMultiple, null, JSON.stringify(options));
  }
  assert.equal(hasCompleteCostCoverage({ version: 1, totalRecords: 1, recordedRecords: 1,
    estimatedRecords: -1, missingRecords: 0 }), false);
});

test('CSV financial summaries carry the same basis, period, and ratio as the screen', () => {
  assert.match(buildAnalyticsCsv(supportedModel()), /financial_summary,Selected period,1,25000,,,,recorded,100,0,recorded,rolling:30,250/);
  assert.doesNotMatch(buildAnalyticsCsv(supportedModel({ missingRecords: 1 })), /rolling:30,250/);
});

test('CSV preserves fallback provenance and selected periods must match the request', () => {
  const model = supportedModel({ fallback: true });
  assert.match(buildAnalyticsCsv(model), /Fallback data/);
  assert.match(buildAnalyticsCsv(model), /evidence_status/);
  assert.equal(analytics.confirmAnalyticsPeriod?.({ reportingPeriod: 'rolling:30' },
    { reportingPeriod: 'rolling:30' }, { days: 7 }), false);
  assert.equal(analytics.confirmAnalyticsPeriod?.({ reportingPeriod: 'rolling:7' },
    { reportingPeriod: 'rolling:7' }, { days: 7 }), true);
});

test('contract creation cohorts cannot become closing-period financial ratios', () => {
  const model = buildAnalyticsViewModel({ timelineResponse: {
    result: 'live', reportingPeriod: 'rolling:30', dateBasis: 'record_created',
    financialEvidence: { version: 1, revenueCoverage: coverage(1) },
    days: [{ count: 1, revenue: 1200, revenueBasis: 'recorded', revenueCoverage: coverage(1) }],
  }, aiMetricsResponse: { result: 'live', reportingPeriod: 'rolling:30', metrics: {
    aiSpendUsd: 100, costEvidence: { version: 1, totalRecords: 1, recordedRecords: 1, estimatedRecords: 0, missingRecords: 0 },
  } } });
  assert.equal(model.roi.roiMultiple, null);
  assert.equal(model.financial.status, 'Creation cohort');
});

test('campaign costs require an explicit supplied basis and do not invent per-row prices', () => {
  assert.deepEqual(analytics.readCampaignAttributionCost?.({ channel: 'sms', sent: true }),
    { basis: 'unavailable', amount: null });
  assert.deepEqual(analytics.readCampaignAttributionCost?.({ costUsd: 0.025, costBasis: 'recorded' }),
    { basis: 'recorded', amount: 0.025 });
  assert.deepEqual(analytics.readCampaignAttributionCost?.({ estimatedCostUsd: 0, costBasis: 'estimated' }),
    { basis: 'estimated', amount: 0 });
  assert.deepEqual(analytics.readCampaignAttributionCost?.({ costUsd: -2, costBasis: 'recorded' }),
    { basis: 'unavailable', amount: null });
});

test('zero cost has its own evidence state rather than pretending evidence is missing', () => {
  assert.equal(supportedModel({ cost: 0 }).financial.status, 'Zero recorded cost');
});

test('derived financial ratios never publish infinity', () => {
  assert.equal(supportedModel({ revenue: Number.MAX_VALUE, cost: Number.MIN_VALUE }).roi.roiMultiple, null);
});

test('CSV keeps performance values outside the revenue column and neutralizes formulas', () => {
  const csv = buildAnalyticsCsv({ aiMetrics: [{ label: 'P95 answer latency', value: '1.2s', raw: 1200 }],
    funnel: [{ label: 'Closed', leads: [{ id: 'SYN-ID', name: '=HYPERLINK("bad")', address: '\r=1+1' }] }] });
  assert.match(csv, /ai_metric,P95 answer latency,1\.2s,,/);
  assert.match(csv, /'\=HYPERLINK/);
  assert.match(csv, /'\r=1\+1/);
});
