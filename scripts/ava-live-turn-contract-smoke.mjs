import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { guardAvaResponse } from './ava-response-guard.mjs';

import {
  AVA_LIVE_TURN_CONTRACT_REVISION,
  applyAvaLiveTurnContractToSession,
  buildAvaLiveTurnContract,
  callerDisclaimsAvaOwnerRole,
  classifyAvaLiveObjectionV2,
  compileAvaLiveSkillAction,
  isAvaFocusedCoachingIntent,
  isAvaLiveReplyAlignedWithContract,
  renderAvaLiveContractReply,
  updateAvaLiveFactLedger,
  withoutAvaCostClauses,
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
assert.equal(offerContract.nextBestQuestion, "What would you expect an inspection to turn up about the property's condition?");
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
assert.match(renderAvaLiveContractReply(fastTimelineContract), /walk away with after costs/);
assert(isAvaLiveReplyAlignedWithContract(renderAvaLiveContractReply(fastTimelineContract), fastTimelineContract));
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
assert.equal(spouseContract.nextBestQuestion, 'What would the other decision maker want to understand before deciding together?');
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
const genericCoachedAvaPattern = new RegExp(['Coached', 'Ava:'].join(' '));
assert.doesNotMatch(
  bridge,
  genericCoachedAvaPattern,
  'Bridge must not emit the generic Coached Ava fallback; fallback replies must come from the live turn contract.'
);
assert(
  bridge.includes('buildAvaStrategistActivityText') &&
    bridge.includes('renderAvaLiveContractReply'),
  'Strategist activity text must prefer the deterministic turn contract over a canned coaching label.'
);
assert(
  bridge.includes('local_contract_fallback') &&
    bridge.includes('PBK Live Turn Contract') &&
    bridge.includes('buildAvaContractStrategistResponse'),
  'Local strategist fallback must become a deterministic live-turn-contract fallback when a contract exists.'
);
assert(
  bridge.includes('buildAvaStrategistAttemptSummary') &&
    bridge.includes('fallbackChain') &&
    bridge.includes('GEMINI_LIVE_MODEL') &&
    bridge.includes('deepseek-v4-flash'),
  'Ava strategist activity must expose the attempted Gemini/DeepSeek live model results before contract fallback.'
);
assert(
  bridge.includes('runGeminiGenerateContent') &&
    bridge.includes("provider: 'gemini'") &&
    bridge.includes('responseMimeType') &&
    bridge.includes('buildGeminiStrategistResponseSchema'),
  'Ava live strategist must support Gemini Flash structured decisions before fallback.'
);
assert(
  bridge.includes('isRetryableDeepSeekResult') &&
    bridge.includes('retryAttempts') &&
    bridge.includes('attemptTimeoutMs') &&
    bridge.includes('provider_retry'),
  'DeepSeek live strategist calls must have bounded retry/backoff support before contract fallback.'
);
assert(
  /async function buildBrowserVoiceConversationalReply[\s\S]*buildAvaScriptRotationSnapshot\(\{[\s\S]*activeSkill:\s*scripts\.governedSkillSelection\?\.selectedSkill/.test(
    bridge
  ) &&
    /source:\s*'browser-voice'[\s\S]*governedSkillSelection:\s*scripts\.governedSkillSelection/.test(
      bridge
    ) &&
    /emotionalPhase:\s*scripts\.emotionalPhase/.test(bridge),
  'Browser voice replies must consume governed skills and emotional scripts through the same turn contract as Telnyx live calls.'
);
assert(
  bridge.includes('buildAvaLivePathLanguage') &&
    bridge.includes('getAvaLivePathKey'),
  'Live sales fallback must use path-aware deal language instead of hardcoded cash-lane wording.'
);
assert.doesNotMatch(
  bridge,
  /\b(cash lane can work|cash lane can get close|cash lane is real|run the cash lane|real cash number|cash number can meet)\b/i,
  'Live call fallback must not force cash-lane language before the path is explicitly locked.'
);
assert.doesNotMatch(
  bridge,
  /forcedDefault\s*\?\s*'cash'\s*:/,
  'Ava path scoring must not collapse uncertain best-path evidence into cash after max probe turns.'
);

const renderBlueprint = readFileSync('render.yaml', 'utf8');
assert.match(
  renderBlueprint,
  /key:\s*PBK_LIVE_LLM_PROVIDER[\s\S]*?value:\s*gemini/,
  'Render must explicitly select Gemini Flash as Ava live-call strategist provider.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_GEMINI_LIVE_MODEL[\s\S]*?value:\s*gemini-3\.5-flash/,
  'Render must explicitly pin Ava live calls to a currently available Gemini Flash model instead of relying on fallback resolution.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_GEMINI_LIVE_ATTEMPT_TIMEOUT_MS[\s\S]*?value:\s*1200/,
  'Render must keep each live Gemini attempt short enough for phone latency.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_DEEPSEEK_LIVE_MODEL[\s\S]*?value:\s*deepseek-v4-flash/,
  'Render must explicitly keep DeepSeek V4 Flash available as Ava live-call fallback.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_DEEPSEEK_LIVE_RETRY_MODELS[\s\S]*?value:\s*deepseek-v4-flash,deepseek-v4-pro/,
  'Render must explicitly keep V4 Flash first and V4 Pro as the live-call retry model.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_TELNYX_LIVE_REPLY_STRATEGIST_TIMEOUT_MS[\s\S]*?value:\s*2500/,
  'Render must keep V4 Flash inside the live phone budget before deterministic contract fallback.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_DEEPSEEK_LIVE_ATTEMPT_TIMEOUT_MS[\s\S]*?value:\s*1400/,
  'Render must keep each live DeepSeek attempt short enough for phone latency.'
);
assert.match(
  renderBlueprint,
  /key:\s*PBK_DEEPSEEK_LIVE_RETRY_ATTEMPTS[\s\S]*?value:\s*1/,
  'Render must allow one fast V4 Flash retry before falling back to the turn contract.'
);

const coachingExamples = [
  {
    transcript: "I don't want to pay anything out of pocket.",
    category: 'out_of_pocket_cost',
    expected: /out of pocket.*which cost/i,
  },
  {
    transcript: "I'm just helping the homeowner with the sale.",
    category: 'decision_maker',
    expected: /helping.*who will make the final decision/i,
  },
  {
    transcript: 'The property might be in Riverton.',
    category: 'property_clarification',
    expected: /want to make sure.*which property/i,
  },
];
for (const { transcript, category, expected } of coachingExamples) {
  const contract = buildAvaLiveTurnContract({
    transcript,
    activeSkill: {
      id: 'fictional-generic-emotional-skill',
      emotionalScript: true,
      response: 'I understand. Tell me about the roof.',
      nextQuestion: 'Is speed, certainty, or price most important?',
    },
  });
  const reply = renderAvaLiveContractReply(contract);
  assert.equal(contract.nextBestQuestionCategory, category, transcript);
  assert.equal(contract.coachingSource, 'pbk-sales-training-timeline');
  assert.match(reply, expected);
  assert.equal((reply.match(/\?/g) || []).length, 1);
  assert(isAvaLiveReplyAlignedWithContract(reply, contract));
  assert(!isAvaLiveReplyAlignedWithContract(`${reply} What shape is the roof in?`, contract));
  assert(!isAvaLiveReplyAlignedWithContract(`Tell me about the roof. ${reply}`, contract));
  assert(!isAvaLiveReplyAlignedWithContract(contract.nextBestQuestion, contract));
}

const concernedAboutFee = buildAvaLiveTurnContract({
  transcript: "I can't afford the $4,000 in closing costs.",
  ledger: { sellerTargetPrice: '250k' },
});
assert.equal(concernedAboutFee.nextBestQuestionCategory, 'out_of_pocket_cost');
assert.equal(concernedAboutFee.knownFacts.sellerTargetPrice, '250k');
assert.equal(buildAvaLiveTurnContract({
  transcript: "I want 250k and I won't pay $4,000 in closing costs.",
}).knownFacts.sellerTargetPrice, '250k');
assert.notEqual(buildAvaLiveTurnContract({
  transcript: "I can cover closing costs, but I don't live nearby.",
}).intent, 'cost_concern');
assert(!isAvaLiveReplyAlignedWithContract(
  `You won't pay anything out of pocket. ${concernedAboutFee.nextBestQuestion}`,
  concernedAboutFee
));
const decision = buildAvaLiveTurnContract({ transcript: "I'm helping the owner sell it." });
assert.equal(decision.knownFacts.authority, 'helper_or_stakeholder');
for (const transcript of ["I'm not the owner, and I'm helping the seller.", "I'm helping my wife sell the house."]) {
  const contract = buildAvaLiveTurnContract({ transcript });
  assert.equal(contract.intent, 'caller_is_helper', transcript);
  assert.equal(contract.knownFacts.authority, 'helper_or_stakeholder', transcript);
}
const owner = buildAvaLiveTurnContract({ transcript: "I'm the owner and I'm helping my brother move." });
assert.notEqual(owner.nextBestQuestionCategory, 'decision_maker');
const optOutAndCost = buildAvaLiveTurnContract({
  transcript: "Don't call me again. I'm not paying any upfront fees.",
});
assert.equal(optOutAndCost.intent, 'stop_contact');
assert(!renderAvaLiveContractReply(optOutAndCost).includes('?'));
const uncertainAddress = buildAvaLiveTurnContract({ transcript: 'The property might be at 17 Willow Lane.' });
assert.equal(uncertainAddress.knownFacts.fullAddress, '');

assert.notEqual(buildAvaLiveTurnContract({ transcript: 'The house needs work, I think.' }).intent, 'uncertain_property');
assert.equal(
  buildAvaLiveTurnContract({ transcript: 'The address is 17 Willow Lane. I think I need a few weeks.' }).knownFacts.fullAddress,
  '17 Willow Lane'
);

// Exercise the real phone reply entry point without opening a socket, calling a
// provider, or loading production credentials. The default path is unavailable
// in this harness so accidentally falling through to it fails the test.
for (const transcript of [
  "I'm not sure which property you mean.",
  'Maybe the house is at 17 Willow Lane.',
  'It could be 17 Willow Lane.',
]) {
  const contract = buildAvaLiveTurnContract({ transcript });
  assert.equal(contract.nextBestQuestionCategory, 'property_clarification', transcript);
  assert.equal(contract.knownFacts.fullAddress, '', transcript);
}
assert.equal(
  buildAvaLiveTurnContract({ transcript: 'I’m helping the homeowner with the sale because they asked me to.' })
    .nextBestQuestionCategory,
  'decision_maker'
);
assert.equal(
  buildAvaLiveTurnContract({ transcript: "I'm worried this is a scam. Do I have to pay closing costs?" }).intent,
  'trust_scam'
);
const evaluateBridgeFunction = (name, bindings = {}) => {
  const start = bridge.indexOf('function ' + name + '(');
  const end = bridge.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start);
  return vm.runInNewContext('(' + bridge.slice(start, end) + ')', bindings);
};
const isOwner = evaluateBridgeFunction('hasStrongAvaOwnerRoleAssertion', {
  callerDisclaimsAvaOwnerRole,
  normalizeTelnyxRepairTranscript: (text) => text.toLowerCase(),
  isAvaLiveAddressMetaQuestion: () => false,
});
assert(isOwner("I'm the property owner."));
for (const transcript of ["I'm just helping the property owner sell it.", "I'm helping the owner with paperwork.", "I'm not the property owner."]) {
  assert(!isOwner(transcript), transcript);
}
const extractBant = evaluateBridgeFunction('extractBantFromTranscript', {
  callerDisclaimsAvaOwnerRole,
  withoutAvaCostClauses,
  hasStrongAvaOwnerRoleAssertion: isOwner,
  normalizeBantInfo: (value) => ({ ...value }),
  isOperationalCallTranscriptNoise: () => false,
});
assert(!extractBant("I don't have $4,000 I need for closing costs.").budget);
assert(!extractBant("I can't afford closing costs. I need $4,000 to cover them.").budget);
assert.equal(extractBant("I want $250,000 after closing costs.").budget, '250,000');
assert.equal(buildAvaLiveTurnContract({ transcript: 'I want 250k, after closing costs.' }).knownFacts.sellerTargetPrice, '250k');
assert.equal(extractBant("I want $250,000 and I won't pay $4,000 in closing costs.").budget, '250,000');
const hasAuthority = evaluateBridgeFunction('hasAvaLiveAuthorityEvidence', {
  normalizeBantValue: (text) => text,
});
assert(!hasAuthority({ bant: { authority: 'mentioned the owner' } }, null, {
  turnContract: buildAvaLiveTurnContract({ transcript: "I'm just helping the property owner sell it." }),
}));
assert(hasAuthority({ authorityConfirmed: true }));

const entryStart = bridge.indexOf('async function buildTelnyxLiveAvaReply(');
assert(entryStart >= 0);
const boundaryEnd = bridge.indexOf('  const repairReply =', entryStart);
assert(boundaryEnd > entryStart);
const buildPhoneReply = vm.runInNewContext(
  '(' + bridge.slice(entryStart, boundaryEnd) + 'throw new Error("Unexpected phone reply fallback"); })',
  {
    classifyAvaLiveObjectionV2,
    buildAvaLiveTurnContract,
    applyAvaLiveTurnContractToSession,
    isAvaFocusedCoachingIntent,
    renderAvaLiveContractReply,
  }
);
const guardStart = bridge.indexOf('function guardTelnyxLiveSpokenReply(');
const guardEnd = bridge.indexOf('function chooseMissingBantFieldForTurn(', guardStart);
assert(guardStart >= 0 && guardEnd > guardStart);
const guardPhoneReply = vm.runInNewContext(
  '(' + bridge.slice(guardStart, guardEnd) + ')',
  {
    classifyAvaLiveObjectionV2,
    isAvaFocusedCoachingIntent,
    renderAvaLiveContractReply,
    compileAvaLiveSkillAction,
    guardAvaResponse,
    stripUnconfirmedAvaLiveLeadName: (text) => text,
    enforceAvaOwnerSafeReply: () => 'Is speed, certainty, or price most important?',
    hasAvaLiveAuthorityEvidence: () => false,
    resolveAvaLiveMao: () => 0,
    recordCallTrace: () => {},
  }
);
const fictionalSession = {};
for (const { transcript, category, expected } of coachingExamples) {
  const reply = await buildPhoneReply({ transcript, session: fictionalSession });
  assert.equal(reply.replyMode, 'fast_local_turn_contract');
  assert.equal(reply.turnContract.nextBestQuestionCategory, category);
  assert.equal(fictionalSession.avaLiveTurnContract.nextBestQuestionCategory, category);
  assert.match(reply.text, expected);
  assert.equal((reply.text.match(/\?/g) || []).length, 1);
  const spoken = guardPhoneReply(reply, {
    transcript,
    session: fictionalSession,
    pathDecision: { selectedPath: 'creative' },
  });
  assert.equal(spoken.guard.result, 'passed');
  assert.equal(spoken.text, reply.text);
  const repeated = guardPhoneReply(reply, {
    transcript,
    session: { ...fictionalSession, lastAvaReplySpoken: spoken.text },
  });
  assert.equal(repeated.guard.repeatedQuestionBlocked, true);
  assert.equal(repeated.text, compileAvaLiveSkillAction(reply.turnContract).acknowledgement);
  assert.doesNotMatch(repeated.text, /speed,|certainty,|\?/i);
}
const optOutReply = await buildPhoneReply({
  transcript: "Don't call again. I won't pay any upfront fees.",
  session: fictionalSession,
});
assert.equal(optOutReply.replyMode, 'fast_local_stop_contact');
assert(!optOutReply.text.includes('?'));

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
