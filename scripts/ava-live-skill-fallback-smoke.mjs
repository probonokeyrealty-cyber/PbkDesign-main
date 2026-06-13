import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAvaLiveGovernedSkillReply,
  shouldPreferAvaLiveGovernedSkillReply,
} from './ava-live-skill-fallback.mjs';

const priceMove = {
  type: 'governed_skill',
  source: 'skill-governance',
  reason: 'cue:skill-price',
  text: 'Clarify the seller target and compare their expected net against the as-is offer before increasing price.',
  governedSkill: {
    id: 'skill-price',
    name: 'Price gap discovery',
    action: 'cue',
    reasonCodes: ['objection_match', 'keyword_match'],
  },
};

const priceReply = buildAvaLiveGovernedSkillReply(priceMove, {
  transcript: 'Your offer is too low. Another investor said they can pay more.',
});

assert.equal(shouldPreferAvaLiveGovernedSkillReply(priceMove), true);
assert.match(priceReply, /price|number|net/i);
assert.match(priceReply, /other offer|compare|closing|fees|repairs/i);
assert.match(priceReply, /\?$/);
assert.doesNotMatch(priceReply, /Clarify the seller target|governed|skill|JSON|tool/i);

const trustReply = buildAvaLiveGovernedSkillReply(
  {
    ...priceMove,
    reason: 'jump:skill-trust',
    text: 'Slow down, validate the concern, and offer proof before discussing price.',
    governedSkill: {
      id: 'skill-trust',
      name: 'Trust repair',
      action: 'jump',
      reasonCodes: ['emotion_match', 'objection_match'],
    },
  },
  {
    transcript: 'How do I know this is legit? This sounds like a scam.',
  }
);

assert.match(trustReply, /fair|careful|comfortable|proof/i);
assert.match(trustReply, /\?$/);
assert.doesNotMatch(trustReply, /Slow down|validate the concern|governed|skill/i);

const bridge = readFileSync('scripts/openclaw-local-server.mjs', 'utf8');
const dockerfile = readFileSync('Dockerfile.openclaw', 'utf8');

assert(
  bridge.includes('buildAvaLiveGovernedSkillReply') &&
    bridge.includes('shouldPreferAvaLiveGovernedSkillReply'),
  'Live Telnyx fast path must load the governed skill fallback helpers.'
);
assert(
  bridge.includes("session.lastFastLocalReplyMode = 'fast_local_governed_skill'") &&
    bridge.includes("replyMode: 'fast_local'") &&
    bridge.includes('fastLocalReply.replyMode = session.lastFastLocalReplyMode'),
  'Fast local live-call path must expose a governed-skill reply mode for traceability.'
);
assert(
  dockerfile.includes('COPY scripts/ava-live-skill-fallback.mjs'),
  'Render image must include the live governed skill fallback helper.'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_live_skill_fallback_ready',
      priceReply,
      trustReply,
    },
    null,
    2
  )
);
