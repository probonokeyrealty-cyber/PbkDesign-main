import assert from 'node:assert/strict';
import {
  buildYouTubeTrainingArtifacts,
  extractCoachMemoryEntriesFromTranscript,
  extractYouTubeVideoId,
  isYouTubeUrl,
  runYouTubeTrainingEvalSuite,
} from './youtube-training.mjs';

const sourceUrl = 'https://www.youtube.com/watch?v=pbkSmoke12345';
const sampleTranscript = `
Expert: Thanks for taking my call. What has you thinking about selling the property?
Seller: I inherited it and honestly I need to talk to my wife before I sign anything.
Expert: That makes sense. Most people want their spouse involved. If the number and terms make sense, what would your wife need to feel comfortable moving forward?
Seller: Mainly the price. I do not want to give it away.
Expert: Totally fair. Let's compare the net, not just the top-line price: repairs, commissions, time, and certainty. If I can solve the repairs and close clean, what number would feel fair?
Seller: I need it sold fast because the taxes are behind.
Expert: Speed matters then. We can close as-is before the tax deadline, and you do not need to clean or make repairs.
`;

assert.equal(isYouTubeUrl(sourceUrl), true, 'youtube.com watch URLs should be detected.');
assert.equal(isYouTubeUrl('https://youtu.be/pbkSmoke12345'), true, 'youtu.be URLs should be detected.');
assert.equal(isYouTubeUrl('https://example.com/watch?v=pbkSmoke12345'), false, 'non-YouTube URLs should not be detected.');
assert.equal(extractYouTubeVideoId(sourceUrl), 'pbkSmoke12345', 'video id should be parsed from watch URL.');
assert.equal(extractYouTubeVideoId('https://youtu.be/pbkSmoke12345?t=20'), 'pbkSmoke12345', 'video id should be parsed from short URL.');

const coachMemoryEntries = extractCoachMemoryEntriesFromTranscript(sampleTranscript, {
  sourceUrl,
  agentId: 'ava',
});

assert(
  coachMemoryEntries.some((entry) => entry.objectionTag === 'spouse_approval'),
  'training should extract spouse approval objection memory.',
);
assert(
  coachMemoryEntries.some((entry) => entry.objectionTag === 'price_too_low'),
  'training should extract price objection memory.',
);
assert(
  coachMemoryEntries.every((entry) => entry.response && entry.prompt),
  'coach memory entries should include prompt and response text.',
);

const artifact = buildYouTubeTrainingArtifacts({
  url: sourceUrl,
  transcript: sampleTranscript,
  agentId: 'ava',
  title: 'PBK Smoke Expert Call',
});

assert.equal(artifact.ok, true, 'artifact build should succeed with a transcript.');
assert.equal(artifact.videoId, 'pbkSmoke12345', 'artifact should carry parsed video id.');
assert.equal(artifact.testCase.agentId, 'ava', 'test case should target Ava by default.');
assert.equal(artifact.testCase.status, 'ready', 'test case should be ready after transcript processing.');
assert(artifact.testCase.assertions.length >= 4, 'training should generate multiple evaluation assertions.');
assert(artifact.coachMemoryEntries.length >= 2, 'training should generate coach memory entries.');
assert(
  artifact.brainDoc.tags.includes('youtube-training') && artifact.brainDoc.tags.includes('ava'),
  'brain doc should be tagged for YouTube training and target agent.',
);

const evalReport = runYouTubeTrainingEvalSuite([artifact.testCase]);
assert.equal(evalReport.ok, true, 'YouTube eval suite should pass generated ready case.');
assert.equal(evalReport.failed, 0, 'YouTube eval suite should have zero failures for generated case.');
assert(evalReport.coverage.requiredCapabilities.includes('objection_handling'), 'eval coverage should include objection handling.');
assert(evalReport.coverage.requiredCapabilities.includes('urgency_detection'), 'eval coverage should include urgency detection.');

console.log('youtube-training smoke passed', {
  assertions: artifact.testCase.assertions.length,
  coachMemoryEntries: artifact.coachMemoryEntries.length,
  evalCases: evalReport.total,
});
