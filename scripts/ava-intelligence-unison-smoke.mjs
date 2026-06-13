import assert from 'node:assert/strict';

import { orchestrateAvaTurn } from './ava-turn-orchestrator.mjs';
import { validateProviderActionSafety } from './safety-validator.mjs';

const sharedSkillBase = {
  source: 'skill_governance',
  status: 'active',
  toolAllowlist: ['analyzeDeal', 'retrieveSimilarDeals', 'createApproval'],
};

const turn = orchestrateAvaTurn({
  candidateAnswer:
    'I hear the price concern. What part of the other offer feels stronger: final net, certainty, or speed?',
  transcript: 'Your offer is too low. Another investor said they can pay more.',
  phase: 'objection_resolution',
  path: 'rbp',
  sellerPersona: 'high_repair_absentee',
  emotion: 'distrust',
  lastObjection: 'price_too_low',
  currentGovernedSkillId: 'skill-trust',
  callId: 'call-unison-1',
  lead: {
    id: 'lead-unison-1',
    name: 'Marcus Bell',
    address: '55 Oak St',
    mao: 145000,
  },
  propertyAnalysis: {
    arv: 285000,
    repairs: 95000,
    mao: 145000,
  },
  negotiation: {
    path: 'rbp',
    zopaKnown: true,
    concessionLadder: [121000, 128000, 132000],
  },
  compliance: {
    dncChecked: true,
    approvalGated: true,
  },
  safety: {
    providerWritesApprovalGated: true,
  },
  operator: {
    approvalQueueAvailable: true,
    handoffAvailable: true,
  },
  voice: {
    channel: 'telnyx',
    liveTranscript: true,
    sttAvailable: true,
  },
  availableTools: ['analyzeDeal', 'retrieveSimilarDeals', 'createApproval', 'telnyx_call'],
  memories: [
    {
      source: 'seller_fact',
      content: 'Marcus cares more about certainty and repair burden than headline price.',
      confidence: 0.82,
    },
  ],
  coachingMemories: [
    {
      source: 'coaching_memory',
      content: 'For distrust plus price pressure, compare net certainty before any concession.',
      confidence: 0.88,
    },
  ],
  skillOutcomes: [{ skillId: 'skill-price', outcome: 'advanced_to_counter' }],
  history: [
    { role: 'seller', content: 'The roof is bad and I do not want to fix anything.' },
    { role: 'ava', content: 'That repair burden is exactly why I want to keep this simple.' },
  ],
  skills: [
    {
      ...sharedSkillBase,
      id: 'skill-trust',
      versionId: 'skill-trust-v1',
      name: 'Trust reset',
      priority: 80,
      instructions: 'Slow down and verify credibility before discussing price.',
      triggerPolicy: {
        stages: ['objection_resolution'],
      },
    },
    {
      ...sharedSkillBase,
      id: 'skill-price',
      versionId: 'skill-price-v1',
      name: 'Price gap discovery',
      priority: 35,
      instructions: 'Clarify the seller target and compare net certainty before increasing price.',
      triggerPolicy: {
        objections: ['price_too_low'],
        emotions: ['distrust'],
        paths: ['rbp'],
        keywords: ['offer is too low', 'pay more'],
      },
    },
  ],
  confidenceInput: {
    pathConfidence: 0.88,
    goalConfidence: 0.84,
    closingConfidence: 0.82,
    transcriptConfidence: 0.91,
    bantComplete: true,
    evidenceCount: 5,
    pathLocked: true,
  },
});

assert.equal(turn.ok, true);
assert.equal(turn.activeSkill.id, 'skill-price');
assert.equal(turn.activeSkill.action, 'jump', 'Ava should jump to the stronger governed skill when its trigger fires.');
assert.equal(turn.guard.result, 'passed');
assert.equal(turn.confidence.band, 'high');
assert.equal(turn.memory.episodicMatches, 1);
assert.equal(turn.memory.coachingMatches, 1);
assert.match(turn.workingMemory.brief, /Price gap discovery/);

assert.equal(turn.unison?.ready, true, 'Ava turn must expose a ready unison contract.');
assert.deepEqual(turn.unison.missingLayers, []);
for (const layer of [
  'reasoning',
  'salesDoctrine',
  'stateMachine',
  'sellerPersona',
  'negotiation',
  'emotion',
  'memory',
  'tools',
  'compliance',
  'skills',
  'coaching',
  'voice',
  'operator',
]) {
  assert.equal(turn.unison.layers[layer], true, `Expected Ava ${layer} layer to be wired.`);
}

const unsafeCall = validateProviderActionSafety(
  'telnyx_call',
  { dnc: true, tcpaConsent: 'denied' },
  { nowLocalHour: 22, requireTcpaConsent: true }
);

assert.equal(unsafeCall.blocked, true);
assert(unsafeCall.violations.some((violation) => violation.code === 'dnc_block'));
assert(unsafeCall.violations.some((violation) => violation.code === 'tcpa_consent_missing'));
assert(unsafeCall.violations.some((violation) => violation.code === 'outside_calling_hours'));

const missingEvidenceTurn = orchestrateAvaTurn({
  candidateAnswer: 'I can help with that. What is the property address?',
  transcript: 'How much can you pay?',
  phase: 'discovery',
  path: 'cash',
  sellerPersona: 'absentee_owner',
  emotion: 'neutral',
  callId: 'call-unison-no-skill',
  lead: {
    id: 'lead-unison-no-skill',
    name: 'Taylor Reed',
    address: '',
    mao: 0,
  },
  propertyAnalysis: {
    arv: 0,
    repairs: 0,
    mao: 0,
  },
  negotiation: {
    path: 'cash',
  },
  compliance: {
    dncChecked: true,
    approvalGated: true,
  },
  operator: {
    approvalQueueAvailable: true,
  },
  voice: {
    channel: 'telnyx',
    liveTranscript: true,
  },
  availableTools: ['analyzeDeal'],
  skills: [],
  memories: [],
  coachingMemories: [],
  confidenceInput: {
    pathConfidence: 0.7,
    goalConfidence: 0.6,
    closingConfidence: 0.6,
    transcriptConfidence: 0.9,
    evidenceCount: 1,
  },
});

assert.equal(missingEvidenceTurn.skillSelection.result, 'no_governed_skill_triggered');
assert.equal(missingEvidenceTurn.unison.layers.skills, false);
assert.equal(missingEvidenceTurn.unison.layers.memory, false);
assert.equal(missingEvidenceTurn.unison.ready, false);
assert(missingEvidenceTurn.unison.missingLayers.includes('skills'));
assert(missingEvidenceTurn.unison.missingLayers.includes('memory'));

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_intelligence_unison_ready',
      ready: turn.unison.ready,
      activeLayerCount: turn.unison.activeLayerCount,
      activeSkill: turn.activeSkill.name,
      skillAction: turn.activeSkill.action,
    },
    null,
    2
  )
);
