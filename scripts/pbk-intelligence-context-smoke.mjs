import assert from 'node:assert/strict';

import {
  PBK_INTELLIGENCE_CONTEXT_REVISION,
  buildPBKIntelligenceContext,
  buildPBKIntelligenceFleetReadiness,
  mergePBKIntelligenceContextOutcome,
} from './pbk-intelligence-context.mjs';

const context = buildPBKIntelligenceContext({
  lead: {
    id: 'lead-300k',
    name: 'Seller With Price',
    phone: '(614) 555-0142',
    email: 'seller@example.com',
    stage: 'warm',
  },
  call: {
    id: 'call-300k',
    leadId: 'lead-300k',
    transcript: [
      { speaker: 'seller', text: 'I already told you I want 300k and the house is in Michigan.' },
    ],
    sentiment: -0.2,
  },
  transcript: 'I already told you I want 300k and the house is in Michigan.',
  memory: {
    episodic: [{ id: 'episode-1', summary: 'Seller disliked repeated price questions.' }],
    coaching: [{ id: 'coach-1', response: 'Acknowledge the price, then ask condition.' }],
    vectorResults: [{ id: 'vector-1', score: 0.88 }],
  },
  skills: {
    active: [
      {
        id: 'skill-price-gap',
        name: 'Price gap discovery',
        source: 'skill-governance',
        status: 'active',
        triggerPolicy: { intents: ['already_gave_price'] },
        instructions: 'Acknowledge the target price and advance to condition.',
      },
    ],
    recentOutcomes: [{ skillId: 'skill-price-gap', success: true }],
  },
  turnContract: {
    ok: true,
    intent: 'already_gave_price',
    objection: 'already_gave_price',
    phase: 'objection_resolution',
    knownFacts: { sellerTargetPrice: '300k', partialAddress: 'Property in michigan' },
    missingFacts: ['full_address', 'condition'],
    nextBestQuestion: 'Walk me through condition: roof, HVAC, foundation, tenants, and anything a buyer would complain about.',
    forbiddenRepeats: ['target_price'],
    allowedTools: ['retrieveClosingIntelligence', 'selectContextAwareScript'],
    activeSkill: { id: 'skill-price-gap', name: 'Price gap discovery', action: 'cue' },
    handoffNeeded: false,
  },
});

assert.equal(context.revision, PBK_INTELLIGENCE_CONTEXT_REVISION);
assert.equal(context.identity.leadId, 'lead-300k');
assert.equal(context.identity.normalizedPhone, '+16145550142');
assert.equal(context.identity.normalizedEmail, 'seller@example.com');
assert.equal(context.memory.ready, true);
assert.equal(context.skills.ready, true);
assert.equal(context.turnContract.intent, 'already_gave_price');
assert.equal(context.turnContract.knownFacts.sellerTargetPrice, '300k');
assert(context.turnContract.forbiddenRepeats.includes('target_price'));
assert.equal(context.dataFreshness.ready, true);
assert.equal(context.fleetReadiness.ready, true);
assert.deepEqual(context.agentHandoffs.map((handoff) => handoff.agentId), ['script-rotator']);

const withOutcome = mergePBKIntelligenceContextOutcome(context, {
  actionTaken: 'script-rotator.select_objection_script',
  sellerReaction: 'advanced_to_condition',
  followUpScheduled: true,
});

assert.equal(withOutcome.outcome.actionTaken, 'script-rotator.select_objection_script');
assert.equal(withOutcome.outcome.followUpScheduled, true);
assert.equal(withOutcome.auditTrail.length, context.auditTrail.length + 1);

const readiness = buildPBKIntelligenceFleetReadiness({
  context,
  agents: [
    { id: 'ava', status: 'active' },
    { id: 'script-rotator', status: 'active' },
  ],
});

assert.equal(readiness.ready, true);
assert.equal(readiness.required.memory, true);
assert.equal(readiness.required.skills, true);
assert.equal(readiness.required.leadIdentity, true);

console.log('pbk-intelligence-context-smoke: ok');
