import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(
  new URL('./openclaw-local-server.mjs', import.meta.url),
  'utf8'
);
const liveCallPip = await readFile(
  new URL('../src/app/components/inbox/LiveCallPip.tsx', import.meta.url),
  'utf8'
);
const styles = await readFile(
  new URL('../src/styles/pbk-components.css', import.meta.url),
  'utf8'
);
const migration = await readFile(
  new URL(
    '../supabase/migrations/20260607010000_pbk_script_outcome_learning.sql',
    import.meta.url
  ),
  'utf8'
);
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);

assert(
  /CREATE TABLE IF NOT EXISTS public\.pbk_script_outcome_events/.test(
    migration
  ) &&
    /PRIMARY KEY \(workspace_id, id\)/.test(migration) &&
    /FOREIGN KEY \(workspace_id, script_id\)/.test(migration),
  'The migration must create the idempotent script outcome event table.'
);
assert(
  /function calculateContextAwareLearnedWeight/.test(bridge) &&
    /async function refreshContextAwareScriptCatalog/.test(bridge) &&
    /contextAwareScriptCatalogByWorkspace/.test(bridge) &&
    /WHERE scripts\.workspace_id = \$1/.test(bridge) &&
    /reward_average/.test(bridge) &&
    /reward_count/.test(bridge),
  'The live script catalog must hydrate measured performance into workspace-isolated selection.'
);
assert(
  /recordPostCallLearningFromTranscript[\s\S]*createPostCallCoachingReport[\s\S]*recordContextAwareScriptOutcomeRecord/.test(
    bridge
  ),
  'Call finalization must create coaching and close selected-script outcomes.'
);
assert(
  /contextAwareScriptHistory/.test(bridge) &&
    /pbk_script_outcome_events/.test(bridge),
  'Live selections must be retained and outcomes must be idempotent.'
);
assert(
  /if \(workspaceId !== ['"]pbk['"]\) return \[\];/.test(bridge),
  'Non-PBK workspaces must never fall back to PBK seed scripts.'
);
assert(
  /if \(speakResult\.ok\) \{[\s\S]{0,260}rememberContextAwareScriptSelection/.test(
    bridge
  ) &&
    /normalizeContextAwareSpokenText/.test(bridge) &&
    /scriptWasSpoken/.test(bridge),
  'Only scripts that reached successful phone playback may receive call-outcome credit.'
);
assert(
  /if \(returned\.id && canonicalEventId && inserted\) \{[\s\S]*recordAgentDecisionRecord/.test(
    bridge
  ) &&
    /if \(inserted\) \{[\s\S]*SCRIPT_OUTCOME_RECORDED/.test(bridge),
  'Idempotent outcome replays must not overwrite decisions or emit contradictory learning events.'
);
assert(
  /ON CONFLICT \(workspace_id, id\) DO NOTHING/.test(bridge) &&
    /update\(`\$\{workspaceId\}\|\$\{callId\}\|\$\{scriptId\}`\)/.test(bridge) &&
    /events\.script_id = \$1/.test(bridge),
  'Outcome replay identity must be workspace-scoped, collision-resistant, and script-specific.'
);
assert(
  /WHERE id = \$1[\s\S]{0,80}workspace_id = \$10/.test(bridge),
  'Script outcome writes must stay inside the selected workspace.'
);
assert(
  /WHERE id = \$1 AND workspace_id = \$3[\s\S]{0,500}workspaceId,\s*\]/.test(bridge),
  'Spoken script exposure writes must pass and enforce the workspace parameter.'
);
assert(
  /const exposurePersisted = await persistContextAwareScriptExposureToPg[\s\S]{0,500}if \(!exposurePersisted\) return false;[\s\S]{0,500}contextAwareScriptHistory/.test(bridge),
  'A spoken script must persist its exposure before it becomes rewardable history.'
);
assert(
  /recordContextAwareScriptOutcomeRecord\(\{[\s\S]{0,320}workspaceId:[\s\S]{0,500}scriptId: selection\.scriptId/.test(bridge) &&
    /id: `agent-decision-\$\{slugify\(workspaceId\)\}-\$\{outcomeEventId\}`/.test(bridge),
  'Post-call rewards and downstream decisions must retain workspace identity.'
);
const outcomeUpdate = bridge.slice(
  bridge.indexOf('updated AS (', bridge.indexOf('recordContextAwareScriptOutcomeRecord')),
  bridge.indexOf('canonical AS (', bridge.indexOf('recordContextAwareScriptOutcomeRecord'))
);
assert(
  !/SET usage_count\s*=/.test(outcomeUpdate),
  'Outcome recording must not double-count script exposure usage.'
);
assert(
  /operatorWhisper/.test(bridge) &&
    /buildOperatorWhisperRecord/.test(bridge),
  'The bridge must expose a private operator whisper separately from spoken text.'
);
assert(
  /Private Ava operator coaching/.test(liveCallPip) &&
    /calls\[\]\.operatorWhisper/.test(liveCallPip),
  'The React live-call companion must render the bridge-backed operator whisper.'
);
assert(
  /\.pbk-live-call-whisper/.test(styles),
  'The operator whisper needs a dedicated responsive visual treatment.'
);
assert.equal(
  packageJson.scripts?.['test:ava-negotiation-learning-loop'],
  'node ./scripts/ava-negotiation-learning-loop-smoke.mjs'
);
assert(
  packageJson.scripts?.['test:founder']?.includes(
    'test:ava-negotiation-learning-loop'
  ),
  'The founder release gate must include the negotiation learning loop.'
);

console.log('ava-negotiation-learning-loop-smoke: ok');
