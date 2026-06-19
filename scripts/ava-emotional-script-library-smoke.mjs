import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detectAvaEmotionalPhase,
  listAvaBuiltInEmotionalScriptSkills,
} from './ava-emotional-script-library.mjs';
import { selectGovernedAvaSkill } from './ava-governed-skill-router.mjs';
import {
  buildAvaLiveTurnContract,
  renderAvaLiveContractReply,
} from './ava-live-turn-contract.mjs';

const emotionalSkills = listAvaBuiltInEmotionalScriptSkills();

assert.equal(detectAvaEmotionalPhase({ transcript: 'My mom grew up in this house.' }), 'memory');
assert.equal(detectAvaEmotionalPhase({ transcript: 'How do I know this is legit?' }), 'comfort');
assert.equal(detectAvaEmotionalPhase({ transcript: 'It is a lot. I need to think.' }), 'discovery');
assert.equal(detectAvaEmotionalPhase({ transcript: "What's next if I say yes today?" }), 'commitment');
assert.equal(detectAvaEmotionalPhase({ transcript: 'What is next if the final number works?' }), 'commitment');
assert.equal(detectAvaEmotionalPhase({ intent: 'stop_contact', transcript: 'Remove me.' }), 'boundary');

const memorySelection = selectGovernedAvaSkill({
  skills: emotionalSkills,
  transcript: 'My mom grew up in this house, so this is hard for me.',
  emotion: 'nostalgia',
  emotionalPhase: 'memory',
});
assert.equal(memorySelection.selectedSkill?.id, 'ava-emotional-memory-connection');
assert(memorySelection.reasonCodes.includes('emotional_phase_match'));
assert(memorySelection.reasonCodes.includes('keyword_match'));

const comfortSelection = selectGovernedAvaSkill({
  skills: emotionalSkills,
  transcript: 'How do I know this is not a scam?',
  lastObjection: 'trust_scam',
  emotion: 'distrust',
  emotionalPhase: 'comfort',
});
assert.equal(comfortSelection.selectedSkill?.id, 'ava-emotional-comfort-framing');
assert(comfortSelection.reasonCodes.includes('objection_match'));

const closeSelection = selectGovernedAvaSkill({
  skills: emotionalSkills,
  transcript: 'I trust the company. The only issue is if we can make a decision today.',
  intent: 'need_to_think',
  emotionalPhase: 'commitment',
});
assert.equal(closeSelection.selectedSkill?.id, 'ava-emotional-trust-process-offer-close');
assert(closeSelection.reasonCodes.includes('emotional_phase_match'));

const blockedCloseSelection = selectGovernedAvaSkill({
  skills: emotionalSkills,
  transcript: 'My dad passed away and I am grieving, but what is your final number?',
  emotion: 'grieving',
  intent: 'make_offer',
  emotionalPhase: 'commitment',
});
assert.notEqual(blockedCloseSelection.selectedSkill?.id, 'ava-emotional-trust-process-offer-close');
assert.notEqual(blockedCloseSelection.selectedSkill?.id, 'ava-emotional-consultative-pause');
assert(
  blockedCloseSelection.candidates.some((candidate) =>
    candidate.reasons.includes('guardrail_blocked')
  )
);

const activeMemorySkill = memorySelection.selectedSkill;
const emotionalContract = buildAvaLiveTurnContract({
  transcript: 'My mom grew up in this house, so this is hard for me.',
  emotion: 'nostalgia',
  emotionalPhase: 'memory',
  activeSkill: activeMemorySkill,
  governedSkillSelection: memorySelection,
  session: {
    avaLiveFactLedger: { partialAddress: 'family home' },
    askedQuestionCategories: [],
  },
});

assert.equal(emotionalContract.emotionalPhase, 'memory');
assert.equal(emotionalContract.activeSkill?.emotionalScript, true);
const rendered = renderAvaLiveContractReply(emotionalContract);
assert.match(rendered, /holds real memories/i);
assert.match(rendered, /what do you love most/i);

const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
assert(
  bridge.includes('listAvaBuiltInEmotionalScriptSkills') &&
    bridge.includes('detectAvaEmotionalPhase') &&
    bridge.includes('emotionalPhase') &&
    bridge.includes('builtInEmotionalSkillCount'),
  'OpenClaw bridge must load built-in governed emotional skills into the Ava skill snapshot.'
);
assert(
  bridge.includes('turnContract.activeSkill?.emotionalScript === true'),
  'Live call contract path must be allowed to own turns for governed emotional scripts.'
);

const dockerfile = readFileSync('Dockerfile.openclaw', 'utf8');
assert(
  dockerfile.includes('COPY scripts/ava-emotional-script-library.mjs'),
  'OpenClaw Docker image must package the emotional script library module.'
);

console.log('ava-emotional-script-library-smoke: ok');
