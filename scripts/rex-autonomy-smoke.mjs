import assert from 'node:assert/strict';
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

console.log('rex-autonomy smoke passed', {
  goals: goals.map((goal) => goal.actionId),
  hotLeadAction: hotLeadAction.action,
});
