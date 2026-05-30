import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildDeclarativeActionIntent,
  curateEpisodicMemories,
  reconcileDeclarativeActionIntent,
  runMissionResilienceEval,
  selectBacktrackingStrategy,
  updateGoalBeliefsBayesian,
} from './mission-resilience.mjs';

const goalUpdate = updateGoalBeliefsBayesian({
  previousBeliefs: {
    sell_fast: 0.34,
    top_dollar: 0.33,
    avoid_repairs: 0.33,
  },
  utterance: "I need this gone fast, but I don't want to put another dime into repairs.",
  outcomeContext: { path: 'cash', stage: 'discovery' },
});

assert.equal(goalUpdate.result, 'goal_beliefs_updated');
assert.equal(goalUpdate.topGoal.id, 'sell_fast');
assert(goalUpdate.beliefs.sell_fast > 0.45, 'sell_fast should increase from urgency evidence.');
assert(goalUpdate.beliefs.avoid_repairs > 0.25, 'avoid_repairs should remain active from repair evidence.');
assert(goalUpdate.uncertainty < 0.95, 'goal uncertainty should move down after strong evidence.');
assert.equal(goalUpdate.uncertaintyHigh, true, 'two strong competing goals should still be treated as worth clarifying.');
assert.equal(goalUpdate.trajectoryEvent.eventType, 'goal_inference_updated');

const backtrack = selectBacktrackingStrategy({
  selectedPath: 'cash',
  pathHistory: [
    { path: 'cash', outcome: 'seller_rejected', scriptId: 'cash-price-anchor' },
  ],
  sellerSignal: 'Your cash number is way too low. I need more than that.',
  goalBeliefs: goalUpdate.beliefs,
  availablePaths: ['cash', 'rbp', 'creative_finance', 'mortgage_takeover'],
});

assert.equal(backtrack.result, 'backtrack_strategy_selected');
assert.equal(backtrack.backtrackedFrom, 'cash');
assert.notEqual(backtrack.nextPath, 'cash');
assert(backtrack.reasonCodes.includes('seller_rejected_current_path'));
assert(backtrack.plan.length >= 3, 'backtracking plan should provide multiple next steps.');

const firstIntent = buildDeclarativeActionIntent({
  toolName: 'sendDocuSign',
  leadId: 'lead-123',
  desiredState: {
    contractStatus: 'sent',
    signerEmail: 'seller@example.com',
    amount: 91000,
    deadline: '2026-06-05',
  },
});
const firstReconcile = reconcileDeclarativeActionIntent(firstIntent, []);
const secondReconcile = reconcileDeclarativeActionIntent(firstIntent, [firstReconcile.intentRecord]);

assert.equal(firstReconcile.result, 'action_required');
assert.equal(secondReconcile.result, 'already_satisfied');
assert.equal(secondReconcile.providerWriteRequired, false);
assert.equal(secondReconcile.existingIntent.id, firstReconcile.intentRecord.id);

const curation = curateEpisodicMemories({
  memories: [
    {
      id: 'mem-win',
      callId: 'call-win',
      outcome: 'closed',
      qualityScore: 0.92,
      confidence: 0.9,
      lastAccessedAt: '2026-05-29T12:00:00.000Z',
    },
    {
      id: 'mem-stale-bad',
      callId: 'call-bad',
      outcome: 'bad_fit',
      qualityScore: 0.16,
      confidence: 0.25,
      lastAccessedAt: '2025-01-01T12:00:00.000Z',
    },
  ],
  now: '2026-05-30T12:00:00.000Z',
});

assert.equal(curation.result, 'memory_curation_planned');
assert(curation.keep.some((item) => item.id === 'mem-win'), 'winning memory should be retained.');
assert(curation.delete.some((item) => item.id === 'mem-stale-bad'), 'stale low-quality memory should be deleted.');
assert(curation.summary.deleteCount >= 1);

const evalReport = runMissionResilienceEval({
  eventBus: { mode: 'redis', connected: true, backlog: 4, pending: 0 },
  registry: { agents: [{ id: 'ava', status: 'active' }, { id: 'rex', status: 'active' }] },
  toolAttempts: [
    { toolName: 'sendDocuSign', idempotencyKey: firstIntent.idempotencyKey, duplicateSuppressed: true },
  ],
  conversations: [
    { callId: 'call-1', turnsBeforePathLock: 4, backtrackingUsed: true, wastedTurns: 1 },
  ],
  memoryCuration: curation,
});

assert.equal(evalReport.result, 'mission_resilience_eval_passed');
assert.equal(evalReport.ok, true);
assert(evalReport.scores.orchestration >= 90);
assert(evalReport.coverage.includes('idempotent_tools'));
assert(evalReport.coverage.includes('selective_memory'));

const bridge = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve('Dockerfile.openclaw'), 'utf8');
const migration = readFileSync(resolve('supabase/migrations/20260530090000_pbk_mission_resilience.sql'), 'utf8');

assert.match(bridge, /async updateGoalBeliefsBayesian/, 'bridge should expose Bayesian GOOD updates as a tool.');
assert.match(bridge, /async selectBacktrackingStrategy/, 'bridge should expose EnCompass-style backtracking as a tool.');
assert.match(bridge, /async reconcileDeclarativeAction/, 'bridge should expose declarative action reconciliation as a tool.');
assert.match(bridge, /persistGoalTrajectoryToPg/, 'bridge should persist goal trajectories to Supabase/Postgres.');
assert.match(bridge, /persistDeclarativeActionIntentToPg/, 'bridge should persist declarative action intents to Supabase/Postgres.');
assert.match(bridge, /persistMemoryCurationEventToPg/, 'bridge should persist memory curation events to Supabase/Postgres.');
assert.match(bridge, /persistMissionResilienceEvalRunToPg/, 'bridge should persist mission-resilience eval runs to Supabase/Postgres.');
assert.match(bridge, /\/api\/evals\/mission-resilience\/run/, 'bridge should expose the mission-resilience eval endpoint.');
assert.match(dockerfile, /COPY scripts\/mission-resilience\.mjs/, 'hosted OpenClaw image should ship the mission resilience module.');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pbk_goal_trajectories/, 'migration should persist goal trajectories.');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pbk_action_intents/, 'migration should persist declarative action intents.');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pbk_memory_curation_events/, 'migration should persist memory curation events.');
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.pbk_mission_resilience_eval_runs/, 'migration should persist MASEval mission-resilience runs.');

console.log('mission-resilience smoke passed', {
  topGoal: goalUpdate.topGoal.id,
  nextPath: backtrack.nextPath,
  memoryDeletes: curation.summary.deleteCount,
  evalScore: evalReport.score,
});
