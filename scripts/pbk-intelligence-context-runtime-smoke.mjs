import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
  clearPBKIntelligenceContextSessions,
  getPBKIntelligenceContextSessionStatus,
  loadPBKIntelligenceContextFromSession,
  savePBKIntelligenceContextToSession,
  withPBKIntelligenceContext,
} from './pbk-intelligence-context-runtime.mjs';

clearPBKIntelligenceContextSessions();

const baseInput = {
  lead: {
    id: 'lead-123',
    leadName: 'Diane Seller',
    phone: '(614) 555-0142',
    email: 'Diane@Example.com',
  },
  call: {
    id: 'call-456',
    leadId: 'lead-123',
    status: 'active',
  },
  transcript: 'I already told you I want 300k and the property is in Michigan.',
  memory: {
    coaching: [{ tag: 'price_gap', phrase: 'Acknowledge known target before asking for address.' }],
  },
  skills: {
    active: [{ id: 'skill-price-gap', name: 'Price gap discovery', confidence: 0.93 }],
  },
  turnContract: {
    ok: true,
    intent: 'already_gave_price',
    objection: 'price_gap',
    phase: 'discovery',
    knownFacts: {
      sellerTargetPrice: '300k',
      partialAddress: 'Michigan',
    },
    missingFacts: ['full_street_address', 'condition'],
    nextBestQuestion: 'What is the full street address so I price the right property?',
    forbiddenRepeats: ['seller_target_price'],
    activeSkill: {
      id: 'skill-price-gap',
      name: 'Price gap discovery',
      action: 'jump',
    },
  },
  agents: [
    { id: 'ava' },
    { id: 'rex' },
    { id: 'qa-agent' },
    { id: 'script-rotator' },
    { id: 'prosody-tuner' },
    { id: 'nurture-agent' },
    { id: 'call-analyzer' },
  ],
};

const firstResult = await withPBKIntelligenceContext(
  {
    leadId: 'lead-123',
    callId: 'call-456',
    input: baseInput,
  },
  async (context) => {
    assert.equal(context.identity.leadId, 'lead-123');
    assert.equal(context.identity.normalizedPhone, '+16145550142');
    assert.equal(context.turnContract.knownFacts.sellerTargetPrice, '300k');
    assert.equal(context.turnContract.activeSkill.name, 'Price gap discovery');
    assert.equal(context.memory.ready, true);
    assert.equal(context.skills.ready, true);
    context.outcome.actionTaken = 'rex_research';
    context.outcome.appointmentSet = true;
    return {
      ok: true,
      observedIntent: context.turnContract.intent,
      activeSkill: context.turnContract.activeSkill.name,
    };
  }
);

assert.equal(firstResult.ok, true);
assert.equal(firstResult.observedIntent, 'already_gave_price');
assert.equal(firstResult.activeSkill, 'Price gap discovery');

const persisted = await loadPBKIntelligenceContextFromSession({
  leadId: 'lead-123',
  callId: 'call-456',
});
assert.equal(persisted.outcome.actionTaken, 'rex_research');
assert.equal(persisted.outcome.appointmentSet, true);
assert.equal(persisted.fleetReadiness.ready, true);

await savePBKIntelligenceContextToSession({
  ...persisted,
  outcome: {
    ...persisted.outcome,
    actionTaken: 'script_rotator',
    followUpScheduled: true,
  },
});

const second = await withPBKIntelligenceContext(
  {
    leadId: 'lead-123',
    callId: 'call-456',
  },
  async (context) => {
    assert.equal(context.outcome.actionTaken, 'script_rotator');
    assert.equal(context.outcome.followUpScheduled, true);
    context.outcome.contractSent = true;
    return { ok: true, actionTaken: context.outcome.actionTaken };
  }
);

assert.deepEqual(second, { ok: true, actionTaken: 'script_rotator' });

const finalContext = await loadPBKIntelligenceContextFromSession({
  leadId: 'lead-123',
  callId: 'call-456',
});
assert.equal(finalContext.outcome.contractSent, true);
assert.equal(getPBKIntelligenceContextSessionStatus().count, 1);

const bridgeSource = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
assert.match(bridgeSource, /withPBKIntelligenceContext/);
assert.match(bridgeSource, /source:\s*'agent-action'/);
assert.match(bridgeSource, /pbkIntelligenceContext:\s*agentContext/);
assert.match(bridgeSource, /routedTo:\s*`invokeRegisteredAgent:\$\{agent\.id\}`/);
assert.match(bridgeSource, /runAgentTeamWorkflow\(\{\s*\.\.\.params,\s*pbkIntelligenceContext:\s*agentContext/s);

console.log('pbk-intelligence-context-runtime-smoke: ok');
