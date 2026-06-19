import assert from 'node:assert/strict';
import {
  buildArticleSkillExtractionPrompt,
  buildArticleSkillProvenance,
  buildYouTubeSkillExtractionPrompt,
  buildYouTubeSkillProvenance,
  classifyYouTubeTranscriptFailure,
  normalizeArticleSkillText,
  normalizeManualYouTubeTranscript,
  normalizeSkillAudioTranscriptUrl,
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

const disabled = classifyYouTubeTranscriptFailure(
  '[YoutubeTranscript] 🚨 Transcript is disabled on this video (gJGU3GlU2UQ)'
);
assert.equal(disabled.reason, 'captions_disabled');
assert.equal(disabled.retryable, false);
assert(!disabled.message.includes('[YoutubeTranscript]'), 'Operator message must not expose raw provider noise.');
assert(disabled.message.includes('Paste a transcript'), 'Disabled captions should guide the operator to the fallback path.');
assert(disabled.message.includes('direct audio/video URL'), 'Disabled captions should offer the Deepgram media URL fallback.');

const normalizedManualTranscript = normalizeManualYouTubeTranscript(
  '  Speaker 1: Ask one clear question.\n\nSpeaker 2: Then wait for the seller answer. '.repeat(15)
);
assert(normalizedManualTranscript.ok, 'Long pasted transcript should be accepted.');
assert.equal(normalizedManualTranscript.source, 'operator_pasted_transcript');
assert(normalizedManualTranscript.transcript.includes('Ask one clear question.'));

const shortManualTranscript = normalizeManualYouTubeTranscript('too short');
assert.equal(shortManualTranscript.ok, false);
assert.equal(shortManualTranscript.reason, 'manual_transcript_too_short');

const validAudioUrl = normalizeSkillAudioTranscriptUrl('https://cdn.example.com/training-call.mp3');
assert.equal(validAudioUrl.ok, true, 'Public direct media URLs should be accepted for Deepgram fallback.');
assert.equal(validAudioUrl.source, 'deepgram_audio_url');

const youtubeWatchAsAudio = normalizeSkillAudioTranscriptUrl('https://www.youtube.com/watch?v=gJGU3GlU2UQ');
assert.equal(youtubeWatchAsAudio.ok, false, 'YouTube watch URLs are not direct media files.');
assert.equal(youtubeWatchAsAudio.reason, 'youtube_watch_url_not_direct_media');

const articleText = [
  'A seller who repeats a high target price is not asking for a generic menu.',
  'The closer should acknowledge the number, name the constraint, and ask for the missing fact that decides whether the deal path can work.',
  'For example, if the seller says they want three hundred thousand dollars but only provides a state, the next question should ask for address or condition.',
  'This prevents repetition and keeps the operator from jumping straight to cash offer before knowing the property condition, timeline, authority, and motivation.',
  'The skill should be review-only until the governance board approves the exact version hash.',
].join(' ');
const normalizedArticle = normalizeArticleSkillText(articleText);
assert.equal(normalizedArticle.ok, true, 'Long article or OCR text should be accepted.');
assert.equal(normalizedArticle.source, 'operator_pasted_article');
assert(normalizedArticle.text.includes('high target price'), 'Normalized article should preserve deal cues.');

const shortArticle = normalizeArticleSkillText('short screenshot text');
assert.equal(shortArticle.ok, false, 'Short article snippets must not create weak skill candidates.');
assert.equal(shortArticle.reason, 'article_text_too_short');

const articlePrompt = buildArticleSkillExtractionPrompt({
  title: 'Seller target price doctrine',
  text: articleText.repeat(80),
  sourceUrl: 'https://example.com/seller-target-price',
  agentId: 'ava',
  maxCandidates: 4,
});
assert(articlePrompt.includes('"skills"'), 'Article prompt must demand structured candidates.');
assert(articlePrompt.includes('review-only'), 'Article ingestion must preserve governance posture.');
assert(articlePrompt.includes('screenshot OCR'), 'Article prompt must support screenshot/OCR workflows.');
assert(articlePrompt.length < 36000, 'Article input must be bounded for predictable latency.');

const articleProvenance = buildArticleSkillProvenance({
  sourceUrl: 'https://example.com/seller-target-price',
  title: 'Seller target price doctrine',
  text: articleText,
  textSource: 'operator_pasted_article',
  parser: 'operator-pasted-article',
  model: 'deepseek-v4-pro',
  agentId: 'ava',
  proposal: parsed[0],
});
assert.equal(articleProvenance.sourceType, 'article');
assert.equal(articleProvenance.targetAgent, 'ava');
assert.equal(articleProvenance.textSource, 'operator_pasted_article');
assert.match(articleProvenance.textHash, /^[a-f0-9]{64}$/);
assert(!('createdAt' in articleProvenance), 'Stable article provenance must not include volatile timestamps.');

console.log('skill-youtube-ingest-smoke: ok');
