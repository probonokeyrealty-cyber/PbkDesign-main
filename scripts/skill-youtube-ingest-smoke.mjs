import assert from 'node:assert/strict';
import {
  buildYouTubeSkillExtractionPrompt,
  buildYouTubeSkillProvenance,
  parseYouTubeSkillProposals,
} from './skill-youtube-ingest.mjs';

const parsed = parseYouTubeSkillProposals(
  '```json\n{"skills":[{"name":"Tactical label","trigger":"Seller sounds distrustful","instructions":"Name the seller concern without arguing, pause for confirmation, then ask one open question. Never invent proof or make a legal claim.","riskClass":"medium","confidence":0.88,"keywords":["scam","legit"],"emotions":["distrust"],"intents":["verify buyer"]},{"name":"Tactical label","trigger":"duplicate","instructions":"This duplicate should be removed even though the model repeated it with different wording and enough content to pass the minimum length.","confidence":0.4}]}\n```',
  { maxCandidates: 5 }
);

assert.equal(parsed.length, 1, 'Duplicate proposal names must be removed.');
assert.equal(parsed[0].name, 'Tactical label');
assert.equal(parsed[0].riskClass, 'medium');
assert.equal(parsed[0].confidence, 0.88);
assert.deepEqual(parsed[0].triggerPolicy.emotions, ['distrust']);
assert.deepEqual(parsed[0].triggerPolicy.keywords, ['scam', 'legit']);
assert.deepEqual(parsed[0].triggerPolicy.intents, ['verify_buyer']);

const prompt = buildYouTubeSkillExtractionPrompt({
  title: 'Negotiation lesson',
  transcript: 'Seller objection and response. '.repeat(2500),
  agentId: 'ava',
  maxCandidates: 4,
});
assert(prompt.includes('"skills"'), 'Prompt must demand a structured skills object.');
assert(prompt.includes('candidate'), 'Prompt must preserve candidate-only governance.');
assert(prompt.length < 36000, 'Transcript input must be bounded for predictable latency.');

const provenance = buildYouTubeSkillProvenance({
  sourceUrl: 'https://www.youtube.com/watch?v=abc123',
  videoId: 'abc123',
  title: 'Negotiation lesson',
  transcript: 'stable transcript',
  model: 'deepseek-v4-pro',
  agentId: 'ava',
  proposal: parsed[0],
});
assert.equal(provenance.sourceType, 'youtube');
assert.equal(provenance.videoId, 'abc123');
assert.equal(provenance.targetAgent, 'ava');
assert.match(provenance.transcriptHash, /^[a-f0-9]{64}$/);
assert.equal(provenance.confidence, 0.88);
assert(!('createdAt' in provenance), 'Stable provenance must not include volatile timestamps.');

console.log('skill-youtube-ingest-smoke: ok');
