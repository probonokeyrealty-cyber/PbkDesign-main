import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildGovernedSkillNextMove,
  isGovernedSkillToolAllowed,
  selectGovernedAvaSkill,
} from './ava-governed-skill-router.mjs';

const skills = [
  {
    id: 'skill-trust',
    versionId: 'version-trust',
    name: 'Trust repair',
    status: 'active',
    source: 'skill-governance',
    priority: 80,
    instructions: 'Slow down, validate the concern, and offer proof before discussing price.',
    triggerPolicy: {
      objections: ['trust_issue'],
      emotions: ['distrust', 'fear'],
      keywords: ['scam', 'legit', 'trust'],
    },
  },
  {
    id: 'skill-price',
    versionId: 'version-price',
    name: 'Price gap discovery',
    status: 'active',
    source: 'skill-governance',
    priority: 70,
    instructions: 'Clarify the seller target and compare their expected net against the as-is offer.',
    triggerPolicy: {
      objections: ['price_too_low'],
      keywords: ['offer is too low', 'need more money', 'price'],
    },
  },
  {
    id: 'skill-inactive',
    versionId: 'version-inactive',
    name: 'Inactive pressure close',
    status: 'rolled_back',
    source: 'skill-governance',
    priority: 1,
    instructions: 'Do not use.',
    triggerPolicy: { keywords: ['price'] },
  },
];

const trust = selectGovernedAvaSkill({
  skills,
  transcript: 'How do I know this is legit? I do not trust investors.',
  lastObjection: 'trust_issue',
  emotion: 'distrust',
});

assert.equal(trust.selectedSkill?.id, 'skill-trust');
assert.equal(trust.action, 'cue');
assert(trust.reasonCodes.includes('objection_match'));
assert(trust.reasonCodes.includes('emotion_match'));
assert(!trust.candidates.some((candidate) => candidate.id === 'skill-inactive'));

const price = selectGovernedAvaSkill({
  skills,
  transcript: 'Your offer is too low. I need more money.',
  lastObjection: 'price_too_low',
  currentSkillId: 'skill-trust',
});

assert.equal(price.selectedSkill?.id, 'skill-price');
assert.equal(price.action, 'jump');
assert(price.reasonCodes.includes('skill_switch'));
assert.equal(price.previousSkillId, 'skill-trust');

const cleared = selectGovernedAvaSkill({
  skills,
  transcript: 'Okay, I understand.',
  currentSkillId: 'skill-price',
});

assert.equal(cleared.selectedSkill, null);
assert.equal(cleared.action, 'clear');
assert(cleared.reasonCodes.includes('trigger_expired'));

const nonGoverned = selectGovernedAvaSkill({
  skills: [
    ...skills,
    {
      id: 'legacy-global-skill',
      name: 'Legacy pressure close',
      status: 'active',
      source: 'agent_fleet',
      priority: 1,
      triggerPolicy: { objections: ['price_too_low'] },
    },
  ],
  transcript: 'Your price is too low.',
  lastObjection: 'price_too_low',
});
assert.equal(nonGoverned.selectedSkill?.id, 'skill-price');
assert(!nonGoverned.candidates.some((candidate) => candidate.id === 'legacy-global-skill'));

const scoped = selectGovernedAvaSkill({
  skills: [
    {
      ...skills[0],
      id: 'lead-scoped-trust',
      versionId: 'lead-scoped-trust-v1',
      scope: { type: 'lead', leadId: 'lead-123' },
    },
  ],
  transcript: 'This sounds like a scam.',
  lastObjection: 'trust_issue',
  leadId: 'lead-other',
});
assert.equal(scoped.selectedSkill, null);

const scopedMatch = selectGovernedAvaSkill({
  skills: [
    {
      ...skills[0],
      id: 'lead-scoped-trust',
      versionId: 'lead-scoped-trust-v1',
      scope: { type: 'lead', leadId: 'lead-123' },
    },
  ],
  transcript: 'This sounds like a scam.',
  lastObjection: 'trust_issue',
  leadId: 'lead-123',
});
assert.equal(scopedMatch.selectedSkill?.id, 'lead-scoped-trust');

const scopedStringListMatch = selectGovernedAvaSkill({
  skills: [
    {
      ...skills[0],
      id: 'string-list-lead-scope',
      versionId: 'string-list-lead-scope-v1',
      scope: { type: 'lead', leadIds: 'lead-other, lead-123' },
    },
  ],
  transcript: 'This sounds like a scam.',
  lastObjection: 'trust_issue',
  leadId: 'lead-123',
});
assert.equal(scopedStringListMatch.selectedSkill?.id, 'string-list-lead-scope');

const canaryBlocked = selectGovernedAvaSkill({
  skills: [
    {
      ...skills[1],
      id: 'price-canary-off',
      versionId: 'price-canary-off-v1',
      status: 'canary',
      rolloutPercent: 0,
    },
  ],
  transcript: 'Your price is too low.',
  lastObjection: 'price_too_low',
  leadId: 'lead-123',
});
assert.equal(canaryBlocked.selectedSkill, null);

const canaryFull = selectGovernedAvaSkill({
  skills: [
    {
      ...skills[1],
      id: 'price-canary-full',
      versionId: 'price-canary-full-v1',
      status: 'canary',
      rolloutPercent: 100,
    },
  ],
  transcript: 'Your price is too low.',
  lastObjection: 'price_too_low',
  leadId: 'lead-123',
});
assert.equal(canaryFull.selectedSkill?.id, 'price-canary-full');

const partialCanaryResults = Array.from({ length: 100 }, (_, index) =>
  selectGovernedAvaSkill({
    skills: [
      {
        ...skills[1],
        id: 'price-canary-quarter',
        versionId: 'price-canary-quarter-v1',
        status: 'canary',
        rolloutPercent: 25,
      },
    ],
    transcript: 'Your price is too low.',
    lastObjection: 'price_too_low',
    leadId: `lead-${index}`,
  })
);
const partialCanarySelected = partialCanaryResults.filter(
  (result) => result.selectedSkill?.id === 'price-canary-quarter'
).length;
assert(partialCanarySelected > 10 && partialCanarySelected < 40);
assert.deepEqual(
  selectGovernedAvaSkill({
    skills: [
      {
        ...skills[1],
        id: 'price-canary-quarter',
        versionId: 'price-canary-quarter-v1',
        status: 'canary',
        rolloutPercent: 25,
      },
    ],
    transcript: 'Your price is too low.',
    lastObjection: 'price_too_low',
    leadId: 'lead-stable',
  }),
  selectGovernedAvaSkill({
    skills: [
      {
        ...skills[1],
        id: 'price-canary-quarter',
        versionId: 'price-canary-quarter-v1',
        status: 'canary',
        rolloutPercent: 25,
      },
    ],
    transcript: 'Your price is too low.',
    lastObjection: 'price_too_low',
    leadId: 'lead-stable',
  })
);

const governedNextMove = buildGovernedSkillNextMove(price);
assert.equal(governedNextMove?.type, 'governed_skill');
assert.equal(governedNextMove?.source, 'skill-governance');
assert.equal(governedNextMove?.text, skills[1].instructions);

assert.equal(
  isGovernedSkillToolAllowed(
    { selectedSkill: { toolAllowlist: ['analyzeDeal', 'getPropertyData'] } },
    'analyzeDeal'
  ),
  true
);
assert.equal(
  isGovernedSkillToolAllowed(
    { selectedSkill: { toolAllowlist: ['analyzeDeal', 'getPropertyData'] } },
    'sendDocuSign'
  ),
  false
);

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');

assert(
  bridge.includes('selectGovernedAvaSkill') &&
    bridge.includes('governedSkillSelection') &&
    bridge.includes('session.activeGovernedSkillId'),
  'Ava call architecture must resolve and persist the governed skill on every turn.'
);
assert(
  bridge.includes('triggerPolicy: skill.triggerPolicy') &&
    /toolAllowlist:\s*Array\.isArray\(skill\.toolAllowlist\)/.test(bridge) &&
    bridge.includes('scope: skill.scope || {}') &&
    bridge.includes('rolloutPercent: skill.rolloutPercent') &&
    bridge.includes("source: skill.source || ''"),
  'Approved runtime reload must retain immutable triggers, scope, rollout, source, and tool contracts.'
);
assert(
  bridge.includes('buildGovernedSkillNextMove') &&
    bridge.includes('governedNextMove.type') &&
    bridge.includes('governedNextMove.source') &&
    bridge.includes('governedSkillSelection.action'),
  'A governed skill cue or jump must control the exact next-move strategy.'
);
assert(
  bridge.includes('isGovernedSkillToolAllowed') &&
    bridge.includes("result: 'governed_skill_tool_blocked'"),
  'A selected governed skill must enforce its declared tool allowlist at execution.'
);
assert(
  dockerfile.includes('COPY scripts/ava-governed-skill-router.mjs'),
  'Render image must include the governed Ava skill router.'
);

console.log('ava-governed-skill-router-smoke: ok');
