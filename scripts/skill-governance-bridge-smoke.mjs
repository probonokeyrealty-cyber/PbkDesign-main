import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bridge = readFileSync(
  resolve(process.cwd(), 'scripts/openclaw-local-server.mjs'),
  'utf8'
);

for (const contract of [
  '/api/skills/governance/status',
  '/api/skills/governance/repository',
  '/api/skills/candidates',
  '/api/skills/ingest',
  '/api/skills/versions/:versionId/approve',
  '/api/skills/versions/:versionId/activate',
  '/api/skills/activations/:activationId/rollback',
]) {
  assert(bridge.includes(contract), `Bridge must expose ${contract}.`);
}

assert(
  /approveSkillVersion[\s\S]*expectedHash/.test(bridge),
  'Approval must bind the operator-provided expected hash.'
);
assert(
  /activateSkillVersion[\s\S]*rolloutMode/.test(bridge),
  'Activation must remain separate and default to canary.'
);
assert(
  /rollbackSkillActivation[\s\S]*reason/.test(bridge),
  'Rollback must record an operator reason.'
);
assert(
  /skill_authority_unavailable[\s\S]*failClosed:\s*true/.test(bridge),
  'Missing Render authority and approved snapshot must fail closed.'
);
assert(
  /fetchYouTubeTranscript[\s\S]*runDeepSeekChatCompletion[\s\S]*createSkillCandidate/.test(bridge),
  'YouTube ingestion must use the existing transcript, DeepSeek, and governance authority.'
);
assert(
  !/YoutubeTranscript\?\.fetchTranscript\s*\|\|\s*mod\.fetchTranscript/.test(bridge),
  'YouTube ingestion must not detach YoutubeTranscript.fetchTranscript; it requires class binding for retrieveVideoId.'
);
assert(
  /mod\.fetchTranscript[\s\S]*YoutubeTranscript\.fetchTranscript\.bind\(mod\.YoutubeTranscript\)/.test(
    bridge
  ),
  'YouTube ingestion must prefer the package wrapper and bind the class fallback.'
);
assert(
  /sourceType:\s*'youtube'[\s\S]*transcriptHash/.test(bridge),
  'YouTube candidates must retain stable source provenance.'
);
assert(
  /manualTranscript[\s\S]*normalizeManualYouTubeTranscript[\s\S]*operator_pasted_transcript/.test(
    bridge
  ),
  'YouTube ingestion must allow an operator-pasted transcript fallback for videos with disabled captions.'
);
assert(
  /audioTranscriptUrl[\s\S]*normalizeSkillAudioTranscriptUrl[\s\S]*transcribeDeepgramUrl/.test(
    bridge
  ),
  'YouTube ingestion must allow a direct audio/video URL fallback through Deepgram when captions are disabled.'
);
assert(
  /classifyYouTubeTranscriptFailure[\s\S]*youtubeTranscriptFailure/.test(bridge),
  'YouTube ingestion must classify transcript provider failures before returning them to Skill Studio.'
);

console.log('skill-governance-bridge-smoke: ok');
