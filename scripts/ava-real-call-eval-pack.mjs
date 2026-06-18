import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAvaLiveTurnContract,
  buildAvaLiveCockpitSnapshot,
  buildAvaLiveSkillOutcomeDraft,
  isAvaLiveReplyAlignedWithContract,
  renderAvaLiveContractReply,
} from './ava-live-turn-contract.mjs';

function contractFor({
  transcript,
  ledger = {},
  activeSkill = null,
  governedSkillSelection = null,
  contextCall = {},
  askedQuestionCategories = [],
  lastAvaReplySpoken = '',
}) {
  return buildAvaLiveTurnContract({
    transcript,
    session: {
      avaLiveFactLedger: ledger,
      askedQuestionCategories,
      lastAvaReplySpoken,
    },
    contextCall: {
      id: 'call-eval-1',
      leadId: 'lead-eval-1',
      phone: '+16145550142',
      ...contextCall,
    },
    activeSkill,
    governedSkillSelection,
  });
}

function assertKnownFacts(contract, expected = {}) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(contract.knownFacts?.[key], value, `knownFacts.${key} should be ${value}`);
  }
}

function assertScenario(scenario = {}) {
  const contract = contractFor(scenario);
  const reply = renderAvaLiveContractReply(contract);
  const expected = scenario.expected || {};

  if (expected.intent) assert.equal(contract.intent, expected.intent, `${scenario.id}: intent`);
  if (expected.objection !== undefined) assert.equal(contract.objection, expected.objection, `${scenario.id}: objection`);
  if (expected.phase) assert.equal(contract.phase, expected.phase, `${scenario.id}: phase`);
  if (expected.nextBestQuestionCategory) {
    assert.equal(
      contract.nextBestQuestionCategory,
      expected.nextBestQuestionCategory,
      `${scenario.id}: next question category`
    );
  }
  if (expected.handoffNeeded !== undefined) {
    assert.equal(contract.handoffNeeded, expected.handoffNeeded, `${scenario.id}: handoff`);
  }
  if (expected.knownFacts) assertKnownFacts(contract, expected.knownFacts);
  for (const fact of expected.missingFactsExcluded || []) {
    assert(!contract.missingFacts.includes(fact), `${scenario.id}: ${fact} should not be missing`);
  }
  for (const category of expected.forbiddenIncludes || []) {
    assert(contract.forbiddenRepeats.includes(category), `${scenario.id}: ${category} should be forbidden`);
  }
  for (const category of expected.forbiddenExcludes || []) {
    assert(!contract.forbiddenRepeats.includes(category), `${scenario.id}: ${category} should not be forbidden`);
  }
  for (const pattern of expected.replyMatches || []) {
    assert.match(reply, pattern, `${scenario.id}: reply should match ${pattern}`);
  }
  for (const pattern of expected.replyDoesNotMatch || []) {
    assert.doesNotMatch(reply, pattern, `${scenario.id}: reply should not match ${pattern}`);
  }
  if (expected.preferredPath) {
    assert.equal(contract.knownFacts.preferredPath, expected.preferredPath, `${scenario.id}: preferred path`);
  }
  assert.equal(
    isAvaLiveReplyAlignedWithContract(reply, contract),
    true,
    `${scenario.id}: rendered reply should satisfy the turn contract`
  );

  return { scenario, contract, reply };
}

const reportedFailedCallScenarios = [
  {
    id: 'already-gave-price-no-repeat',
    transcript: 'I already told you I want 300k.',
    ledger: { partialAddress: 'Property in michigan' },
    askedQuestionCategories: ['target_price'],
    lastAvaReplySpoken: 'What number would make this worth saying yes today?',
    expected: {
      intent: 'already_gave_price',
      objection: 'already_gave_price',
      nextBestQuestionCategory: 'full_address',
      knownFacts: { sellerTargetPrice: '300k' },
      forbiddenIncludes: ['target_price'],
      replyMatches: [/300k/i, /full street address|address/i],
      replyDoesNotMatch: [/what number would|worth saying yes/i],
    },
  },
  {
    id: 'repeat-complaint-advance',
    transcript: 'You keep asking the same damn question, I told you I need 300k.',
    ledger: { fullAddress: '123 Main St', condition: 'roof needs work' },
    askedQuestionCategories: ['target_price', 'timeline'],
    expected: {
      intent: 'repeat_complaint',
      objection: 'repeat_complaint',
      nextBestQuestionCategory: 'pain',
      knownFacts: { sellerTargetPrice: '300k' },
      replyMatches: [/repeated myself|300k/i],
      replyDoesNotMatch: [/what number|timeline|days|weeks/i],
    },
  },
  {
    id: 'make-offer-before-facts',
    transcript: 'What can you pay me?',
    expected: {
      intent: 'make_offer',
      objection: 'offer_request',
      nextBestQuestionCategory: 'full_address',
      replyMatches: [/real number|facts|full street address/i],
      replyDoesNotMatch: [/cash lane|cash number|we can pay/i],
    },
  },
  {
    id: 'make-offer-after-price-address',
    transcript: 'How much can you pay?',
    ledger: { sellerTargetPrice: '300k', fullAddress: '123 Main St' },
    askedQuestionCategories: ['target_price', 'full_address'],
    expected: {
      intent: 'make_offer',
      nextBestQuestionCategory: 'condition',
      knownFacts: { sellerTargetPrice: '300k', fullAddress: '123 Main St' },
      replyMatches: [/300k|condition|roof|hvac/i],
      replyDoesNotMatch: [/full street address|what number/i],
    },
  },
  {
    id: 'friday-close-with-price',
    transcript: 'Can you close by Friday if I accept 280k?',
    expected: {
      intent: 'seller_wants_speed',
      nextBestQuestionCategory: 'condition',
      knownFacts: { sellerTargetPrice: '280k', timeline: 'by Friday' },
      forbiddenIncludes: ['target_price', 'timeline'],
      replyMatches: [/timeline|condition|roof|hvac/i],
      replyDoesNotMatch: [/what number|days, a few weeks/i],
    },
  },
  {
    id: 'fast-sale-needs-price',
    transcript: 'I need to sell fast.',
    ledger: { fullAddress: '123 Main St', condition: 'needs roof work' },
    expected: {
      intent: 'seller_wants_speed',
      nextBestQuestionCategory: 'target_price',
      knownFacts: { timeline: 'fast' },
      forbiddenIncludes: ['timeline'],
      replyMatches: [/number|yes today/i],
      replyDoesNotMatch: [/days|few weeks|flexible/i],
    },
  },
  {
    id: 'fast-sale-known-price-and-timeline',
    transcript: 'I need speed.',
    ledger: {
      fullAddress: '123 Main St',
      condition: 'needs roof work',
      sellerTargetPrice: '300k',
      timeline: 'fast',
    },
    expected: {
      intent: 'seller_wants_speed',
      nextBestQuestionCategory: 'authority',
      forbiddenIncludes: ['target_price', 'timeline', 'condition', 'full_address'],
      replyDoesNotMatch: [/what number|days|weeks|condition|roof/i],
    },
  },
  {
    id: 'competing-offer-terms',
    transcript: 'Another investor offered me 320k and says they can close with no inspection.',
    ledger: { fullAddress: '123 Main St', condition: 'needs cleanout', authority: 'owner' },
    expected: {
      intent: 'competing_offer',
      objection: 'competing_offer',
      nextBestQuestionCategory: 'competing_offer_terms',
      knownFacts: { sellerTargetPrice: '320k' },
      replyMatches: [/other offer|repairs|fees|closing date|headline/i],
    },
  },
  {
    id: 'price-too-low-net-question',
    transcript: 'That offer is way too low. Zillow says it is worth more.',
    ledger: { fullAddress: '123 Main St', condition: 'vacant but rough', authority: 'owner' },
    expected: {
      intent: 'price_too_low',
      objection: 'price_too_low',
      nextBestQuestionCategory: 'target_price',
      replyMatches: [/hear you|number|yes today/i],
    },
  },
  {
    id: 'need-to-think-specific-hesitation',
    transcript: 'I need to think about it.',
    ledger: { fullAddress: '123 Main St', sellerTargetPrice: '280k' },
    expected: {
      intent: 'need_to_think',
      objection: 'need_to_think',
      nextBestQuestionCategory: 'specific_hesitation',
      replyMatches: [/what specifically|number|timing|confidence/i],
    },
  },
  {
    id: 'spouse-decision-maker',
    transcript: 'My wife has to decide with me.',
    ledger: { fullAddress: '123 Main St', sellerTargetPrice: '300k' },
    expected: {
      intent: 'spouse_partner',
      objection: 'decision_maker',
      nextBestQuestionCategory: 'decision_maker',
      replyMatches: [/decision maker|need to hear/i],
    },
  },
  {
    id: 'trust-scam-proof',
    transcript: 'How do I know this is not a scam?',
    ledger: { fullAddress: '123 Main St', authority: 'owner' },
    expected: {
      intent: 'trust_scam',
      objection: 'trust_scam',
      nextBestQuestionCategory: 'trust_proof',
      replyMatches: [/fair concern|proof|comfortable/i],
      replyDoesNotMatch: [/what number|contract/i],
    },
  },
  {
    id: 'probate-handoff',
    transcript: 'The house is in probate after my father passed away.',
    ledger: { fullAddress: '123 Main St' },
    expected: {
      intent: 'probate_legal',
      objection: 'probate_legal',
      handoffNeeded: true,
      phase: 'objection_resolution',
      replyMatches: [/sorry|sort through/i],
    },
  },
  {
    id: 'attorney-review-handoff',
    transcript: 'My attorney needs to review the contract before I sign anything.',
    ledger: { fullAddress: '123 Main St', sellerTargetPrice: '300k' },
    expected: {
      intent: 'legal_review',
      objection: 'legal_review',
      nextBestQuestionCategory: 'legal_review_contact',
      handoffNeeded: true,
      replyMatches: [/slow down|who should review|what do they need/i],
      replyDoesNotMatch: [/send contract now|what number/i],
    },
  },
  {
    id: 'trustee-bankruptcy-handoff',
    transcript: 'I am in chapter 13 bankruptcy and my trustee has to approve paperwork.',
    ledger: { fullAddress: '123 Main St' },
    expected: {
      intent: 'legal_review',
      objection: 'legal_review',
      nextBestQuestionCategory: 'legal_review_contact',
      handoffNeeded: true,
      replyMatches: [/slow down|review|paperwork/i],
    },
  },
  {
    id: 'stop-contact-no-question',
    transcript: 'Stop calling me and remove me from your list.',
    ledger: { fullAddress: '123 Main St' },
    expected: {
      intent: 'stop_contact',
      objection: 'stop_contact',
      nextBestQuestionCategory: 'contact_stop_confirmation',
      handoffNeeded: true,
      replyMatches: [/understood|do-not-contact|contact now/i],
      replyDoesNotMatch: [/address|price|condition|timeline|offer/i],
    },
  },
  {
    id: 'seller-max-net-rbp',
    transcript: 'I want the highest net and I am not in a rush.',
    ledger: { fullAddress: '123 Main St', authority: 'owner' },
    expected: {
      intent: 'seller_wants_max_net',
      nextBestQuestionCategory: 'net_comparison',
      preferredPath: 'rbp',
      replyMatches: [/highest net|speed|both/i],
      replyDoesNotMatch: [/cash lane|quick close/i],
    },
  },
  {
    id: 'subject-to-path-signal',
    transcript: 'I have a low rate loan and you can take over payments if that helps.',
    expected: {
      intent: 'unknown',
      nextBestQuestionCategory: 'full_address',
      preferredPath: 'subject_to',
      replyMatches: [/full street address|address/i],
    },
  },
  {
    id: 'seller-finance-path-signal',
    transcript: 'I would carry a note if the monthly payment made sense.',
    expected: {
      intent: 'unknown',
      preferredPath: 'creative',
      nextBestQuestionCategory: 'full_address',
      replyMatches: [/full street address|address/i],
    },
  },
  {
    id: 'land-path-signal',
    transcript: 'It is a vacant lot with utilities at the street.',
    expected: {
      intent: 'unknown',
      preferredPath: 'land',
      nextBestQuestionCategory: 'full_address',
      replyMatches: [/full street address|address/i],
    },
  },
  {
    id: 'caller-is-agent',
    transcript: 'I am the listing agent calling for my client.',
    expected: {
      intent: 'caller_is_agent',
      knownFacts: { authority: 'agent' },
      missingFactsExcluded: ['authority'],
      nextBestQuestionCategory: 'full_address',
      replyMatches: [/full street address|address/i],
    },
  },
  {
    id: 'agent-top-dollar-not-cash-default',
    transcript: 'I am the realtor and my client wants top dollar, not a fast cash offer.',
    expected: {
      intent: 'caller_is_agent',
      knownFacts: { authority: 'agent' },
      preferredPath: 'rbp',
      nextBestQuestionCategory: 'full_address',
      replyDoesNotMatch: [/cash lane|cash offer is best/i],
    },
  },
  {
    id: 'partial-address-needs-canonical-address',
    transcript: 'The property is in Michigan and I want 300k.',
    expected: {
      intent: 'unknown',
      nextBestQuestionCategory: 'full_address',
      knownFacts: { sellerTargetPrice: '300k', partialAddress: 'Property in michigan' },
      replyMatches: [/Property in michigan|full street address/i],
      replyDoesNotMatch: [/what number/i],
    },
  },
  {
    id: 'full-facts-advance-to-timeline',
    transcript: 'I own 123 Main St. The roof is bad and I want 300k.',
    expected: {
      intent: 'unknown',
      nextBestQuestionCategory: 'timeline',
      knownFacts: {
        authority: 'owner',
        fullAddress: '123 Main St',
        condition: 'roof is bad and I want 300k',
        sellerTargetPrice: '300k',
      },
      missingFactsExcluded: ['authority', 'full_address', 'condition', 'target_price'],
      replyMatches: [/close in days|few weeks|flexible/i],
      replyDoesNotMatch: [/full street address|what number/i],
    },
  },
  {
    id: 'tenant-pain-do-not-jump-offer',
    transcript: 'Tenants stopped paying and I am tired of being a landlord.',
    expected: {
      intent: 'unknown',
      nextBestQuestionCategory: 'full_address',
      replyMatches: [/full street address|address/i],
      replyDoesNotMatch: [/cash lane|offer/i],
    },
  },
  {
    id: 'emotional-loss-handoff',
    transcript: 'My mother passed away and I am overwhelmed.',
    expected: {
      intent: 'probate_legal',
      objection: 'probate_legal',
      handoffNeeded: true,
      replyMatches: [/sorry|sort through/i],
      replyDoesNotMatch: [/what number|contract/i],
    },
  },
  {
    id: 'ambiguous-yes-clarifies',
    transcript: 'yes',
    lastAvaReplySpoken: 'What matters most: speed, certainty, or price?',
    expected: {
      intent: 'ambiguous_yes',
      nextBestQuestionCategory: 'yes_clarification',
      replyMatches: [/right yes|which part|price|timing|repairs|decision authority/i],
      replyDoesNotMatch: [/full street address|what number/i],
    },
  },
  {
    id: 'send-contract-confirm-before-action',
    transcript: 'Send me the contract and I will sign today.',
    ledger: {
      fullAddress: '123 Main St',
      condition: 'roof needs work',
      sellerTargetPrice: '280k',
      authority: 'owner',
      timeline: 'today',
    },
    expected: {
      intent: 'contract_request',
      objection: '',
      phase: 'commitment',
      nextBestQuestionCategory: 'approval_confirmation',
      handoffNeeded: true,
      replyMatches: [/ready to move|confirm|contract|paperwork/i],
    },
  },
  {
    id: 'agent-cash-does-not-work',
    transcript: 'I am the listing agent. The seller wants too much and cash does not work at that number.',
    expected: {
      intent: 'caller_is_agent',
      knownFacts: { authority: 'agent' },
      nextBestQuestionCategory: 'full_address',
      replyDoesNotMatch: [/cash lane|real cash number/i],
    },
  },
];

const results = reportedFailedCallScenarios.map(assertScenario);

const skillScenario = assertScenario({
  id: 'governed-trust-skill-cockpit',
  transcript: 'How do I know this is not a scam?',
  ledger: { fullAddress: '123 Main St', authority: 'owner' },
  activeSkill: {
    id: 'skill-trust-reset',
    name: 'Trust reset',
    instructions: 'Validate distrust, offer proof, then ask what proof would help.',
  },
  governedSkillSelection: {
    result: 'governed_skill_selected',
    action: 'jump',
    reasonCodes: ['objection_match'],
    matchedTriggers: ['trust_scam'],
  },
  expected: {
    intent: 'trust_scam',
    nextBestQuestionCategory: 'trust_proof',
    replyMatches: [/fair concern|proof/i],
  },
});

const cockpit = buildAvaLiveCockpitSnapshot({
  contract: skillScenario.contract,
  replyMode: 'fast_local_turn_contract_skill',
  latencyMs: 142,
  turnContractEnforced: true,
});
assert.equal(cockpit.intent, 'trust_scam');
assert.equal(cockpit.activeSkill.name, 'Trust reset');
assert.equal(cockpit.replyMode, 'fast_local_turn_contract_skill');
assert.equal(cockpit.latencyMs, 142);
assert.equal(cockpit.turnContractEnforced, true);
assert(cockpit.knownFacts.fullAddress);
assert(cockpit.missingFacts.includes('target_price'));

const outcomeDraft = buildAvaLiveSkillOutcomeDraft({
  contract: skillScenario.contract,
  callId: 'call-eval-1',
  leadId: 'lead-eval-1',
  transcript: 'How do I know this is not a scam?',
  reply: skillScenario.reply,
  replyMode: 'fast_local_turn_contract_skill',
});
assert.equal(outcomeDraft.skillName, 'Trust reset');
assert.equal(outcomeDraft.skillId, 'skill-trust-reset');
assert.equal(outcomeDraft.agentName, 'Ava');
assert.equal(outcomeDraft.outcomeLabel, 'turn_contract_observed');
assert.equal(outcomeDraft.metadata.intent, 'trust_scam');
assert.equal(outcomeDraft.metadata.nextQuestionCategory, 'trust_proof');

const bridgeSource = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
assert(
  bridgeSource.includes('avaLiveCockpit') &&
    bridgeSource.includes('avaLiveTurnHistory') &&
    bridgeSource.includes('post_call_turn_contract_learning'),
  'Live bridge must expose cockpit metadata and summarize governed turn-contract skills into post-call learning.'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_real_call_eval_pack_passed',
      scenarios: results.length + 1,
      coverage: {
        intents: [...new Set(results.map(({ contract }) => contract.intent))].sort(),
        handoffCases: results.filter(({ contract }) => contract.handoffNeeded).length,
      },
      sampleReplies: {
        alreadyGavePrice: results.find((item) => item.scenario.id === 'already-gave-price-no-repeat')?.reply,
        stopContact: results.find((item) => item.scenario.id === 'stop-contact-no-question')?.reply,
        ambiguousYes: results.find((item) => item.scenario.id === 'ambiguous-yes-clarifies')?.reply,
      },
    },
    null,
    2
  )
);
