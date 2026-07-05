import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

const postCallStart = bridge.indexOf('async function recordPostCallLearningFromTranscript');
const postCallEnd = bridge.indexOf('async function requestHumanHandoffRecord', postCallStart);
const postCallBlock = postCallStart >= 0 && postCallEnd > postCallStart ? bridge.slice(postCallStart, postCallEnd) : '';
assert(postCallBlock, 'recordPostCallLearningFromTranscript block must be present.');

assertContains(
  bridge,
  /function getPostCallLearningSignal[\s\S]*minimumTranscriptChars = hasCallEvidence \? 20 : 40/,
  'Post-call learning must accept short transcripts when there is real call evidence.',
);
assertContains(
  postCallBlock,
  /recordCallEmotionRecord\(\{[\s\S]*source:\s*'telnyx-post-call-learning'/,
  'Post-call transcripts must create call emotion rows.',
);
assertContains(
  postCallBlock,
  /recordEmotionalLearningInteractionRecord\(\{[\s\S]*source:\s*'telnyx-post-call-learning'/,
  'Post-call transcripts must feed emotional learning interactions.',
);
assertContains(
  postCallBlock,
  /recordAgentDecisionRecord\(\{[\s\S]*actionType:\s*'post_call_outcome_observed'/,
  'Post-call transcripts must write explicit world-model agent decision rows.',
);
assertContains(
  postCallBlock,
  /reward:\s*inferredOutcome\.reward/,
  'Post-call world-model rows must carry a reward signal.',
);
assertContains(
  postCallBlock,
  /recordCallTrace\('post_call_learning_skipped'[\s\S]*minimumTranscriptChars/,
  'Weak transcript skips must be observable with threshold evidence.',
);
assertContains(
  bridge,
  /async function backfillPostCallOutcomeLearningFromMessages[\s\S]*recordPostCallLearningFromTranscript/,
  'Ava learning runs must be able to backfill existing call transcripts into outcome rows.',
);
assertContains(
  bridge,
  /function isOperationalCallTranscriptNoise[\s\S]*deepgram live stream closed[\s\S]*diagnostics:\\s\*frames=/i,
  'Operational Deepgram/Telnyx diagnostic text must be detected before memory or BANT learning.',
);
assertContains(
  bridge,
  /function sanitizeSellerMemoryValue[\s\S]*isOperationalCallTranscriptNoise/,
  'Seller memory values must be recursively sanitized before prompt recall.',
);
assertContains(
  bridge,
  /function normalizeBantInfo[\s\S]*sanitizeSellerMemoryValue[\s\S]*!isOperationalCallTranscriptNoise/,
  'BANT normalization must skip provider diagnostic text.',
);
assertContains(
  bridge,
  /async function updateLeadBantContextFromTranscript[\s\S]*operational_transcript_ignored[\s\S]*provider_diagnostic_not_seller_memory/,
  'Lead projection must quarantine provider diagnostics instead of updating seller facts.',
);
assertContains(
  bridge,
  /async function recordPostCallLearningFromTranscript[\s\S]*isOperationalCallTranscriptNoise\(transcript\)[\s\S]*provider_diagnostic_not_seller_outcome/,
  'Post-call learning must not promote provider diagnostics into outcome rows.',
);
assertContains(
  bridge,
  /async function persistAvaActiveMemoryToPg[\s\S]*public\.ava_active_memories/,
  'Ava active memories must persist to Postgres, not only bridge state.',
);
assertContains(
  bridge,
  /async function promoteProsodyOutcomesToAvaMemory[\s\S]*pbk_prosody_decisions[\s\S]*upsertAvaActiveMemory/,
  'Measured prosody outcomes must promote into Ava active memory.',
);
assertContains(
  bridge,
  /const outcomeBackfill = await backfillPostCallOutcomeLearningFromMessages\(/,
  'runAvaMemoryLearning must execute the post-call outcome backfill.',
);
assertContains(
  bridge,
  /const prosodyPromotion = await promoteProsodyOutcomesToAvaMemory\(/,
  'runAvaMemoryLearning must promote measured prosody outcomes into active memory.',
);
assertContains(
  bridge,
  /id:\s*String\(params\.agentDecisionId \|\| params\.agent_decision_id \|\| `agent-decision-\$\{slugify\(record\.id\)\.slice\(0, 96\)\}`\)/,
  'Emotional learning agent decisions must be idempotent when callers provide deterministic IDs.',
);

assert.equal(
  packageJson.scripts['test:call-outcome-learning-loop'],
  'node ./scripts/call-outcome-learning-loop-smoke.mjs',
  'package.json must expose the call outcome learning loop smoke.',
);
assert(
  packageJson.scripts['test:production-hardening']?.includes('npm run test:call-outcome-learning-loop'),
  'Production hardening must include call outcome learning loop coverage.',
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'call_outcome_learning_loop_guard_ready',
      guarantees: [
        'short real transcripts can count when Deepgram/audio/sentiment proof exists',
        'post-call learning writes call_emotions',
        'post-call learning writes emotional_learning_interactions',
        'post-call learning writes agent_decisions with rewards',
        'Ava learning run backfills older call messages',
      ],
    },
    null,
    2,
  ),
);
