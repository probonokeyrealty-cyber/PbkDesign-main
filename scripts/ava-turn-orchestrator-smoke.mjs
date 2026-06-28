import assert from 'node:assert/strict';

import { guardAvaResponse } from './ava-response-guard.mjs';
import { orchestrateAvaTurn } from './ava-turn-orchestrator.mjs';
import { buildAvaWorkingMemory } from './ava-working-memory.mjs';

const history = [
  { role: 'seller', content: 'I inherited the house.' },
  { role: 'ava', content: 'I am sorry for your loss.' },
  { role: 'seller', content: 'I need at least 200k.' },
  { role: 'ava', content: 'What number would feel fair to you?' },
  { role: 'seller', content: 'The other investor said they can close.' },
];

const memory = buildAvaWorkingMemory({
  phase: 'objection_resolution',
  lead: { id: 'lead-1', name: 'Diane', address: '202 Cherry Ln' },
  transcript: 'Your offer is too low.',
  history,
  memories: [{ content: 'Diane cares more about certainty than repairs.' }],
  activeSkill: { id: 'skill-price', name: 'Price gap discovery' },
});

assert.equal(memory.phase, 'objection_resolution');
assert.equal(memory.lead.name, 'Diane');
assert.equal(memory.lastTurns.length, 4, 'Working memory should keep only the latest four turns.');
assert.match(memory.brief, /Current phase: objection_resolution/);
assert.match(memory.brief, /Active governed skill: Price gap discovery/);
assert.doesNotMatch(memory.brief, /I inherited the house/, 'Old turns should not leak into compact brief.');

const stopGuard = guardAvaResponse({
  answer: 'I can call you tomorrow and send an offer.',
  transcript: 'Stop calling me and take me off your list.',
  shouldStopContact: true,
});

assert.equal(stopGuard.result, 'blocked');
assert.equal(stopGuard.blocked, true);
assert(stopGuard.reasons.includes('stop_contact_boundary'));
assert.match(stopGuard.answer, /stop contacting/i);
assert.doesNotMatch(stopGuard.answer, /offer|tomorrow/i);

const repeatGuard = guardAvaResponse({
  answer: 'What number would feel fair to you?',
  previousQuestions: ['What number would feel fair to you?'],
});

assert.equal(repeatGuard.result, 'rewritten');
assert.equal(repeatGuard.repeatedQuestionBlocked, true);
assert(repeatGuard.reasons.includes('repeated_question'));
assert.doesNotMatch(repeatGuard.answer, /what number would feel fair/i);

const signatureGuard = guardAvaResponse({
  answer: 'Great, sign the contract now and we can lock it up.',
  phase: 'discovery',
  evidence: { participantsIdentified: false },
});

assert.equal(signatureGuard.result, 'blocked');
assert(signatureGuard.reasons.includes('signature_before_authority'));
assert.match(signatureGuard.answer, /decision maker|right person/i);

const orchestrated = orchestrateAvaTurn({
  candidateAnswer: 'I hear you. What part of the other offer feels stronger: price, certainty, or speed?',
  transcript: 'Your offer is too low and another investor offered more.',
  phase: 'objection_resolution',
  lead: { id: 'lead-2', name: 'Marcus', address: '55 Oak St' },
  history,
  previousQuestions: ['What number would feel fair to you?'],
  skills: [
    {
      id: 'skill-price',
      versionId: 'skill-price-v1',
      name: 'Price gap discovery',
      source: 'skill_governance',
      status: 'active',
      priority: 50,
      instructions: 'Clarify the seller target and compare net certainty before increasing price.',
      triggerPolicy: {
        objections: ['price_too_low'],
        keywords: ['offer is too low', 'offered more', 'price'],
      },
      toolAllowlist: ['analyzeDeal'],
    },
  ],
  lastObjection: 'price_too_low',
  confidenceInput: {
    pathConfidence: 0.86,
    goalConfidence: 0.8,
    closingConfidence: 0.83,
    transcriptConfidence: 0.9,
    bantComplete: true,
    evidenceCount: 4,
    pathLocked: true,
  },
});

assert.equal(orchestrated.ok, true);
assert.equal(orchestrated.activeSkill?.id, 'skill-price');
assert.equal(orchestrated.activeSkill?.action, 'cue');
assert.equal(orchestrated.turnDecision.nextMoveType, 'seller_reply');
assert.equal(orchestrated.guard.result, 'passed');
assert.equal(orchestrated.confidence.band, 'high');
assert.match(orchestrated.workingMemory.brief, /Price gap discovery/);

const actionConfidenceOrchestrated = orchestrateAvaTurn({
  candidateAnswer: 'I updated the CRM record.',
  proposedActionType: 'crm.update',
  actionConfidence: 0.92,
  evidenceCount: 2,
  confidenceInput: {
    pathConfidence: 0.2,
    goalConfidence: 0.2,
    closingConfidence: 0.2,
    transcriptConfidence: 0.2,
    evidenceCount: 0,
  },
});

assert.equal(
  actionConfidenceOrchestrated.actionDecision.decision,
  'autonomous',
  'explicit actionConfidence drives action decision confidence'
);

const internalGuard = guardAvaResponse({
  answer: 'I will use telnyx_call with JSON { "tool": "sendDocuSign" }.',
});

assert.equal(internalGuard.result, 'rewritten');
assert(internalGuard.reasons.includes('internal_language'));
assert.doesNotMatch(internalGuard.answer, /telnyx_call|JSON|sendDocuSign/);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_turn_orchestrator_ready',
      selectedSkill: orchestrated.activeSkill?.name,
      guardResults: [stopGuard.result, repeatGuard.result, signatureGuard.result],
    },
    null,
    2
  )
);
