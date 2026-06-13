import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AVA_LIVE_TURN_CONTRACT_REVISION,
  buildAvaLiveTurnContract,
  classifyAvaLiveObjectionV2,
  compileAvaLiveSkillAction,
  isAvaLiveReplyAlignedWithContract,
  renderAvaLiveContractReply,
  updateAvaLiveFactLedger,
} from './ava-live-turn-contract.mjs';

assert.match(
  AVA_LIVE_TURN_CONTRACT_REVISION,
  /^2026-06-13/,
  'Turn contract revision should make the A+ live-call layer traceable.'
);

const firstLedger = updateAvaLiveFactLedger(
  {},
  'I am the owner and I want around 300k. The house is in Michigan and the roof needs work.',
  { contextCall: { phone: '+16145550142' } }
);

assert.equal(firstLedger.authority, 'owner');
assert.equal(firstLedger.sellerTargetPrice, '300k');
assert.equal(firstLedger.partialAddress, 'Property in michigan');
assert.match(firstLedger.condition, /roof/i);

const priceContract = buildAvaLiveTurnContract({
  transcript: 'I already told you the price.',
  session: {
    avaLiveFactLedger: firstLedger,
    askedQuestionCategories: ['role', 'target_price'],
    lastAvaReplySpoken: 'Are you the owner or agent?',
  },
  contextCall: { phone: '+16145550142' },
  activeSkill: {
    id: 'skill-price-gap',
    name: 'Price gap discovery',
    instructions: 'Clarify the seller target and compare net certainty before increasing price.',
    toolAllowlist: ['analyzeDeal', 'retrieveSimilarDeals'],
  },
  governedSkillSelection: {
    result: 'governed_skill_selected',
    action: 'jump',
    reasonCodes: ['objection_match', 'keyword_match'],
    matchedTriggers: ['price_too_low'],
  },
});

assert.equal(priceContract.intent, 'already_gave_price');
assert.equal(priceContract.objection, 'already_gave_price');
assert.equal(priceContract.knownFacts.sellerTargetPrice, '300k');
assert.equal(priceContract.activeSkill.id, 'skill-price-gap');
assert.equal(priceContract.nextBestQuestionCategory, 'full_address');
assert(!priceContract.missingFacts.includes('target_price'));
assert(!priceContract.nextBestQuestion.toLowerCase().includes('what number'));
assert(priceContract.forbiddenRepeats.includes('target_price'));

const compiledPrice = compileAvaLiveSkillAction(priceContract);
assert.equal(compiledPrice.ok, true);
assert.equal(compiledPrice.action, 'jump');
assert.match(compiledPrice.acknowledgement, /300k/i);
assert.match(compiledPrice.question, /address|street/i);

const renderedPrice = renderAvaLiveContractReply(priceContract);
assert.match(renderedPrice, /300k/i);
assert.match(renderedPrice, /address|street/i);
assert.doesNotMatch(renderedPrice, /what number would|number are you trying/i);

const offerContract = buildAvaLiveTurnContract({
  transcript: 'How much can you pay?',
  session: {
    avaLiveFactLedger: { sellerTargetPrice: '300k', fullAddress: '123 Main St' },
    askedQuestionCategories: ['target_price'],
  },
  contextCall: { address: '123 Main St' },
});

assert.equal(offerContract.intent, 'make_offer');
assert.equal(offerContract.knownFacts.sellerTargetPrice, '300k');
assert.equal(offerContract.nextBestQuestionCategory, 'condition');
assert(!offerContract.nextBestQuestion.toLowerCase().includes('full street address'));

const trustContract = buildAvaLiveTurnContract({
  transcript: 'How do I know this is not a scam?',
  session: { avaLiveFactLedger: { fullAddress: '123 Main St' } },
  activeSkill: {
    id: 'skill-trust',
    name: 'Trust reset',
    instructions: 'Validate the concern and offer proof before discussing price.',
  },
  governedSkillSelection: {
    result: 'governed_skill_selected',
    action: 'jump',
    reasonCodes: ['objection_match'],
  },
});

assert.equal(classifyAvaLiveObjectionV2('How do I know this is not a scam?').objection, 'trust_scam');
assert.equal(trustContract.intent, 'trust_scam');
assert.equal(trustContract.nextBestQuestionCategory, 'trust_proof');
assert.match(renderAvaLiveContractReply(trustContract), /proof|comfortable|verify/i);

const fastTimelineContract = buildAvaLiveTurnContract({
  transcript: 'I need to sell fast.',
  session: { avaLiveFactLedger: { fullAddress: '123 Main St', condition: 'needs roof work' } },
});

assert.equal(fastTimelineContract.intent, 'seller_wants_speed');
assert.equal(fastTimelineContract.knownFacts.timeline, 'fast');
assert.equal(fastTimelineContract.nextBestQuestionCategory, 'target_price');
assert(!fastTimelineContract.forbiddenRepeats.includes('target_price'));
assert(fastTimelineContract.forbiddenRepeats.includes('timeline'));
assert.doesNotMatch(renderAvaLiveContractReply(fastTimelineContract), /days|weeks|flexible/i);

const fastKnownPriceContract = buildAvaLiveTurnContract({
  transcript: 'I need to sell fast.',
  session: {
    avaLiveFactLedger: {
      fullAddress: '123 Main St',
      condition: 'needs roof work',
      sellerTargetPrice: '300k',
    },
  },
});

assert.equal(fastKnownPriceContract.intent, 'seller_wants_speed');
assert(fastKnownPriceContract.forbiddenRepeats.includes('target_price'));
assert.notEqual(fastKnownPriceContract.nextBestQuestionCategory, 'target_price');
assert.notEqual(fastKnownPriceContract.nextBestQuestionCategory, 'timeline');
assert(
  isAvaLiveReplyAlignedWithContract(renderAvaLiveContractReply(fastKnownPriceContract), fastKnownPriceContract)
);
assert.equal(
  isAvaLiveReplyAlignedWithContract('Are you trying to close in days or a few weeks?', fastKnownPriceContract),
  false
);
assert.equal(
  isAvaLiveReplyAlignedWithContract('Tell me your timeline. What condition should I price in?', fastKnownPriceContract),
  false
);

const literalSpeedContract = buildAvaLiveTurnContract({
  transcript: 'I need speed.',
  session: {
    avaLiveFactLedger: {
      fullAddress: '123 Main St',
      condition: 'needs roof work',
      sellerTargetPrice: '300k',
      timeline: 'fast',
    },
  },
});

assert.equal(literalSpeedContract.intent, 'seller_wants_speed');
assert.notEqual(literalSpeedContract.nextBestQuestionCategory, 'target_price');
assert.notEqual(literalSpeedContract.nextBestQuestionCategory, 'timeline');

const spouseContract = buildAvaLiveTurnContract({
  transcript: 'My wife has to decide with me.',
  session: { avaLiveFactLedger: { fullAddress: '123 Main St', sellerTargetPrice: '300k' } },
});

assert.equal(spouseContract.intent, 'spouse_partner');
assert.equal(spouseContract.nextBestQuestionCategory, 'decision_maker');
assert.match(renderAvaLiveContractReply(spouseContract), /decision maker|need to hear/i);

const stopContactContract = buildAvaLiveTurnContract({
  transcript: 'Stop calling me and remove me from your list.',
  session: { avaLiveFactLedger: { fullAddress: '123 Main St' } },
});

assert.equal(stopContactContract.intent, 'stop_contact');
assert.equal(stopContactContract.handoffNeeded, true);

const probateExecutor = buildAvaLiveTurnContract({
  transcript: 'I am the executor for my father’s probate estate.',
  session: { avaLiveFactLedger: { fullAddress: '123 Main St' } },
});

assert.equal(probateExecutor.intent, 'probate_legal');
assert.equal(probateExecutor.handoffNeeded, true);

const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
assert(
    bridge.includes('buildAvaLiveTurnContract') &&
    bridge.includes('renderAvaLiveContractReply') &&
    bridge.includes('isAvaLiveReplyAlignedWithContract') &&
    bridge.includes('turnContractEnforced') &&
    bridge.includes('session.avaLiveTurnContract'),
  'Live bridge must compute and persist an Ava turn contract before speaking.'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_live_turn_contract_ready',
      revision: AVA_LIVE_TURN_CONTRACT_REVISION,
      priceReply: renderedPrice,
      trustReply: renderAvaLiveContractReply(trustContract),
    },
    null,
    2
  )
);
