import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ClosingStateMachine, Phase } from './ava-state-machine.mjs';
import { getClosingQuestion } from './closing-questions.mjs';
import { getEmotionPolicy, isEmotionActionAllowed } from './emotion-policy.mjs';
import { calculateRBPMetrics, calculateScorecard } from './evaluation-scorecard.mjs';
import { NegotiationPolicy, shouldUseRBP } from './negotiation-policy.mjs';
import { QuestionPolicy } from './question-policy.mjs';

const doctrineDir = resolve('docs/agents/ava');
const requiredDocs = [
  'README.md',
  'charter.md',
  'conversation-state-machine.md',
  'seller-model.md',
  'negotiation-policy.md',
  'emotion-policy.md',
  'confidence-policy.md',
  'deal-path-playbooks.md',
  'memory-policy.md',
  'tool-contracts.md',
  'compliance.md',
  'evaluation-scorecard.md',
  'call-examples.md',
];

for (const name of requiredDocs) {
  const file = resolve(doctrineDir, name);
  assert.equal(existsSync(file), true, `Missing Ava doctrine document: ${name}`);
  assert.ok(readFileSync(file, 'utf8').trim().length > 120, `${name} is unexpectedly thin.`);
}

const stateMachine = new ClosingStateMachine('lead-doctrine', 'call-doctrine');
assert.equal(stateMachine.phase, Phase.TRUST);
assert.equal(
  stateMachine.transition(Phase.PARTICIPANT_VERIFICATION, {}).ok,
  false,
  'Trust evidence must be required.'
);
assert.equal(
  stateMachine.transition(Phase.PARTICIPANT_VERIFICATION, {
    trustEstablished: true,
  }).ok,
  true
);
const restored = ClosingStateMachine.fromJSON(stateMachine.toJSON());
assert.equal(restored.phase, Phase.PARTICIPANT_VERIFICATION);
assert.equal(
  restored.selectPath(
    { arv: 300_000, repairs: 120_000, condition: 'major_rehab' },
    { timeline: '60 days' }
  ),
  'rbp'
);

assert.equal(shouldUseRBP(120_000, { timeline: '60 days' }), true);
const negotiation = new NegotiationPolicy(
  { timeline: '60 days', desiresMaximumProceeds: true, sellerMinimum: 110_000 },
  { arv: 300_000, repairs: 120_000, mao: 125_000 },
  [],
  { approvedMaximum: 125_000, assignmentFee: 15_000 }
);
const recommendation = negotiation.buildRecommendation();
assert.equal(recommendation.path, 'rbp');
assert.ok(recommendation.amount > 0 && recommendation.amount <= 125_000);
assert.equal(recommendation.requiresApproval, true);
assert.equal(recommendation.sellerFacing, false);
assert.equal(recommendation.amountUse, 'approval_advisory_only');

const questions = new QuestionPolicy();
const firstQuestion = questions.selectNextQuestion({
  leadId: 'lead-doctrine',
  turn: 3,
  lastSellerResponse: 'Your offer is too low.',
});
assert.match(firstQuestion, /number|fair/i);
questions.recordAsked(firstQuestion, 3);
assert.equal(questions.wasAsked(firstQuestion), true);
assert.equal(
  getClosingQuestion('diagnostic', { seed: 'fixed-seed' }),
  getClosingQuestion('diagnostic', { seed: 'fixed-seed' }),
  'Closing question selection must be deterministic.'
);

assert.equal(isEmotionActionAllowed('fear', 'hard_close'), false);
assert.equal(getEmotionPolicy('anger').handoffRisk, 'high');
assert.equal(isEmotionActionAllowed('urgency', 'verify_deadline'), true);

const scorecard = calculateScorecard({
  appointmentBooked: true,
  contractSigned: true,
  profit: 15_000,
  contactedLeads: 1,
  minutesToVerbalYes: 8,
  predictedArv: 220_000,
  actualArv: 215_000,
  cancelled: false,
  sellerComplaint: false,
  complianceViolation: false,
});
assert.ok(scorecard.score >= 80, `Expected strong ethical outcome score, received ${scorecard.score}.`);

const rbpMetrics = calculateRBPMetrics([
  {
    path: 'rbp',
    qualified: true,
    accepted: true,
    closed: true,
    rbpSellerNet: 140_000,
    cashSellerNet: 112_000,
  },
  {
    path: 'rbp',
    qualified: true,
    accepted: false,
    rbpSellerNet: 130_000,
    cashSellerNet: 110_000,
  },
]);
assert.equal(rbpMetrics.acceptanceRate, 0.5);
assert.equal(rbpMetrics.closedCount, 1);
assert.equal(rbpMetrics.averageSellerNetImprovement, 24_000);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_doctrine_ready',
      docs: requiredDocs.length,
      stateMachine: restored.phase,
      selectedPath: recommendation.path,
      score: scorecard.score,
      rbpAcceptanceRate: rbpMetrics.acceptanceRate,
    },
    null,
    2
  )
);
