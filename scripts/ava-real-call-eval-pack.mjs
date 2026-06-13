import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAvaLiveTurnContract,
  buildAvaLiveCockpitSnapshot,
  buildAvaLiveSkillOutcomeDraft,
  renderAvaLiveContractReply,
} from './ava-live-turn-contract.mjs';

function contractFor({ transcript, ledger = {}, activeSkill = null, governedSkillSelection = null }) {
  return buildAvaLiveTurnContract({
    transcript,
    session: {
      avaLiveFactLedger: ledger,
      askedQuestionCategories: ['authority'],
      lastAvaReplySpoken: 'Are you the owner or the person helping make the decision on this property?',
    },
    contextCall: { id: 'call-eval-1', leadId: 'lead-eval-1', phone: '+16145550142' },
    activeSkill,
    governedSkillSelection,
  });
}

const fridayClose = contractFor({
  transcript: 'Can you close by Friday if I accept 280k?',
});
assert.equal(fridayClose.intent, 'seller_wants_speed');
assert.equal(fridayClose.knownFacts.sellerTargetPrice, '280k');
assert.equal(fridayClose.knownFacts.timeline, 'by Friday');
assert.notEqual(fridayClose.nextBestQuestionCategory, 'target_price');
assert.notEqual(fridayClose.nextBestQuestionCategory, 'timeline');
assert.match(renderAvaLiveContractReply(fridayClose), /280k|address|condition/i);

const contractRequest = contractFor({
  transcript: 'Send me the contract and I will sign today.',
  ledger: {
    fullAddress: '123 Main St',
    condition: 'roof needs work',
    sellerTargetPrice: '280k',
    authority: 'owner',
    timeline: 'today',
  },
});
assert.equal(contractRequest.intent, 'contract_request');
assert.equal(contractRequest.phase, 'commitment');
assert.equal(contractRequest.handoffNeeded, true);
assert.equal(contractRequest.nextBestQuestionCategory, 'approval_confirmation');
assert.match(renderAvaLiveContractReply(contractRequest), /confirm|contract|approve/i);

const angryRepeat = contractFor({
  transcript: 'You keep asking the same damn question, I told you I need 300k.',
  ledger: {
    fullAddress: '123 Main St',
    condition: 'roof needs work',
  },
});
assert.equal(angryRepeat.intent, 'repeat_complaint');
assert.equal(angryRepeat.knownFacts.sellerTargetPrice, '300k');
assert(!angryRepeat.nextBestQuestion.toLowerCase().includes('timeline'));
assert(!angryRepeat.nextBestQuestion.toLowerCase().includes('what number'));
assert.match(renderAvaLiveContractReply(angryRepeat), /300k/i);

const competingOffer = contractFor({
  transcript: 'Another investor offered me 320k and says they can close with no inspection.',
  ledger: {
    fullAddress: '123 Main St',
    condition: 'needs cleanout',
    authority: 'owner',
  },
});
assert.equal(competingOffer.intent, 'competing_offer');
assert.equal(competingOffer.knownFacts.sellerTargetPrice, '320k');
assert.equal(competingOffer.nextBestQuestionCategory, 'competing_offer_terms');

const skillContract = contractFor({
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
});
const cockpit = buildAvaLiveCockpitSnapshot({
  contract: skillContract,
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
  contract: skillContract,
  callId: 'call-eval-1',
  leadId: 'lead-eval-1',
  transcript: 'How do I know this is not a scam?',
  reply: renderAvaLiveContractReply(skillContract),
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
      scenarios: 6,
      fridayClose: renderAvaLiveContractReply(fridayClose),
      contractRequest: renderAvaLiveContractReply(contractRequest),
      angryRepeat: renderAvaLiveContractReply(angryRepeat),
    },
    null,
    2
  )
);
