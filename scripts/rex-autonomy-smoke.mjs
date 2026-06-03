import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRexKpiSnapshot,
  proposeAutonomousRexGoals,
  selectRexProactiveLeadAction,
} from './rex-autonomy.mjs';

const calls = [
  { id: 'call-1', outcome: 'offer_accepted', profit: 22000, createdAt: new Date().toISOString() },
  { id: 'call-2', outcome: 'not_interested', profit: 0, createdAt: new Date().toISOString() },
  { id: 'call-3', outcome: 'appointment_set', profit: 0, createdAt: new Date().toISOString() },
];

const kpis = buildRexKpiSnapshot({
  calls,
  callAnalyses: [
    { failureTags: ['repeated_question', 'slow_response'], score: 58 },
    { failureTags: ['repeated_question'], score: 64 },
  ],
  prosodyDecisions: [{ outcomeSuccess: true }, { outcomeSuccess: false }],
  targetMonthlyRevenue: 1000000,
});

assert.equal(kpis.totalCalls, 3, 'KPI snapshot should count recent calls.');
assert.equal(kpis.acceptedOffers, 1, 'KPI snapshot should count accepted offers.');
assert(kpis.topFailureTags[0].tag === 'repeated_question', 'KPI snapshot should rank failure tags.');

const inferredKpis = buildRexKpiSnapshot({
  generatedAt: '2026-06-01T12:00:00.000Z',
  calls: [
    {
      id: 'call-live-1',
      outcome: 'not_interested',
      transcript: [
        { speaker: 'Seller', text: 'This sounds like a scam and I do not trust this.' },
        { speaker: 'Ava', text: 'Can I send paperwork now?' },
      ],
      createdAt: '2026-05-31T12:00:00.000Z',
    },
    {
      id: 'call-live-2',
      outcome: 'closed',
      profit: 12000,
      createdAt: '2026-05-29T12:00:00.000Z',
    },
  ],
  callAnalyses: [{ score: 52 }],
  targetMonthlyRevenue: 1000000,
});
assert(
  inferredKpis.topFailureTags.some((item) => item.tag === 'seller_negative_unhandled'),
  'Rex KPI snapshot should infer failure tags from live calls when call analyses lack structured tags.'
);
assert(inferredKpis.monthlyRunRate > 0, 'Rex KPI snapshot should infer a monthly run rate from real closed/funded call profit.');
assert(
  inferredKpis.targetGap < inferredKpis.targetMonthlyRevenue,
  'Rex target gap should use the inferred run rate instead of defaulting to the full target.'
);

const modelReadyKpis = buildRexKpiSnapshot({
  calls: Array.from({ length: 500 }, (_, index) => ({
    id: `model-call-${index}`,
    outcome: index % 20 === 0 ? 'closed' : 'not_interested',
    transcript: 'Seller: maybe. Ava: I will follow up.',
  })),
});
assert.equal(modelReadyKpis.onnxDataReady, true, 'Rex should flag ONNX readiness at 500 calls.');
assert.equal(
  modelReadyKpis.onnxTraining.action,
  'trainEmotionWorldModel',
  'Rex should expose an executable training action when ONNX data is ready.'
);

const goals = proposeAutonomousRexGoals(kpis, { now: '2026-05-29T12:00:00.000Z' });
assert.equal(goals.length, 3, 'Rex should propose exactly three autonomous goals.');
assert(goals.every((goal) => goal.title && goal.successMetric && goal.priority), 'Every Rex goal must be measurable.');
assert(goals.some((goal) => goal.actionType === 'learning_data_collection'), 'Rex should prioritize call-data collection when sample size is thin.');

const hotLeadAction = selectRexProactiveLeadAction({
  leadId: 'lead-hot',
  phone: '+15555550123',
  motivationScore: 91,
  dnc: false,
}, { nowLocalHour: 11 });

assert.equal(hotLeadAction.action, 'queue_call', 'High-motivation leads should be queued for calling.');
assert.equal(hotLeadAction.providerWritesBlocked, true, 'Rex proactive actions must remain provider-write safe.');

const dncAction = selectRexProactiveLeadAction({
  leadId: 'lead-dnc',
  phone: '+15555550124',
  motivationScore: 95,
  dnc: true,
}, { nowLocalHour: 11 });

assert.equal(dncAction.action, 'do_not_call', 'DNC leads must never be queued.');

const bridgeSource = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
assert.match(
  bridgeSource,
  /\/api\/calls\/summary/,
  'Bridge should expose a live calls summary endpoint for Rex KPI snapshots.'
);

console.log('rex-autonomy smoke passed', {
  goals: goals.map((goal) => goal.actionId),
  hotLeadAction: hotLeadAction.action,
});
