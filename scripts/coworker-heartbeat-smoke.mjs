import assert from 'node:assert/strict';
import { buildCoworkerHeartbeatPlan, summarizeHeartbeatPlan } from './coworker-heartbeat.mjs';

const plan = buildCoworkerHeartbeatPlan({
  now: '2026-05-29T16:00:00.000Z',
  approvals: [
    { id: 'approval-contract', status: 'pending', type: 'contract', leadName: 'Probate Seller', createdAt: '2026-05-29T08:00:00.000Z' },
  ],
  calls: [
    { id: 'call-slow', status: 'completed', qualityScore: 61, leadName: 'Slow Turn Seller', createdAt: '2026-05-29T15:00:00.000Z' },
    { id: 'call-good', status: 'completed', qualityScore: 91, leadName: 'Clean Call Seller', createdAt: '2026-05-29T15:10:00.000Z' },
  ],
  contracts: [
    { id: 'contract-stale', status: 'sent', leadName: 'Stale Contract Seller', updatedAt: '2026-05-27T15:00:00.000Z' },
  ],
  leads: [
    { id: 'hot-lead', name: 'Hot Probate Lead', motivationScore: 92, dnc: false, phone: '+16145550123' },
    { id: 'dnc-lead', name: 'DNC Lead', motivationScore: 99, dnc: true, phone: '+16145550124' },
  ],
  eventBus: { backlog: 1201 },
  qa: { failureRate: 0.08 },
});

assert.equal(plan.ok, true, 'Heartbeat plan should be generated.');
assert(plan.actions.some((action) => action.type === 'review_pending_approvals'), 'Heartbeat should flag pending approvals.');
assert(plan.actions.some((action) => action.type === 'follow_up_stale_contract'), 'Heartbeat should flag stale contracts.');
assert(plan.actions.some((action) => action.type === 'queue_hot_lead'), 'Heartbeat should queue high-motivation non-DNC leads.');
assert(!plan.actions.some((action) => action.leadId === 'dnc-lead' && action.type === 'queue_hot_lead'), 'Heartbeat must not queue DNC leads.');
assert(plan.actions.some((action) => action.type === 'review_low_quality_call'), 'Heartbeat should flag weak calls.');
assert(plan.actions.some((action) => action.type === 'investigate_event_bus_backlog'), 'Heartbeat should flag event bus backlog.');
assert(plan.actions.some((action) => action.type === 'investigate_qa_failure_rate'), 'Heartbeat should flag QA failure rate.');

const summary = summarizeHeartbeatPlan(plan);
assert.match(summary, /PBK coworker heartbeat/i, 'Heartbeat summary should be Slack-ready.');
assert.match(summary, /pending approvals/i, 'Heartbeat summary should mention approval work.');

console.log('coworker-heartbeat smoke passed', {
  actionCount: plan.actions.length,
  highPriority: plan.actions.filter((action) => action.priority === 'high').length,
});
