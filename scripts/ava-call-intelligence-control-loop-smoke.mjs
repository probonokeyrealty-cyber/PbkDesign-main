import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildAvaLiveCockpitSnapshot,
  buildAvaLiveSkillOutcomeDraft,
  buildAvaLiveTurnContract,
} from './ava-live-turn-contract.mjs';

const transcript =
  'I am the owner. I want around 150k, the roof needs work, and I need to sell fast.';

const contract = buildAvaLiveTurnContract({
  transcript,
  session: {
    avaLiveFactLedger: {
      fullAddress: '9008B Bong Loop, Moses Lake, WA 98837',
    },
  },
  contextCall: {
    id: 'call-live-001',
    leadId: 'lead-live-001',
    address: '9008B Bong Loop, Moses Lake, WA 98837',
  },
  activeSkill: {
    id: 'skill-live-speed-condition',
    name: 'Speed and condition discovery',
    category: 'seller_engagement_scripts',
    instructions: 'Confirm condition and timing before price commitment.',
    toolAllowlist: ['retrieveClosingIntelligence', 'selectContextAwareScript'],
  },
  governedSkillSelection: {
    action: 'cue',
    reasonCodes: ['seller_timeline', 'condition_signal'],
    matchedTriggers: ['sell fast', 'roof needs work'],
  },
});

const skillOutcomeDraft = buildAvaLiveSkillOutcomeDraft({
  contract,
  callId: 'call-live-001',
  leadId: 'lead-live-001',
  transcript,
  reply: 'Timeline matters. Got it. What number would make this worth saying yes today?',
  replyMode: 'live_call',
});

const cockpit = buildAvaLiveCockpitSnapshot({
  contract,
  callId: 'call-live-001',
  leadId: 'lead-live-001',
  transcript,
  replyMode: 'live_call',
  latencyMs: 420,
  transcriptLatencyMs: 180,
  turnContractEnforced: true,
  replyPreview: 'Timeline matters. Got it. What number would make this worth saying yes today?',
  memory: {
    hotRecallCount: 2,
    durableRecallCount: 5,
  },
  skillOutcomeDraft,
});

assert.equal(cockpit.ok, true);
assert.equal(cockpit.callId, 'call-live-001');
assert.equal(cockpit.leadId, 'lead-live-001');
assert(Array.isArray(cockpit.missionTimeline), 'Cockpit must expose a mission timeline.');

const stepIds = cockpit.missionTimeline.map((step) => step.id);
for (const requiredStep of [
  'heard_seller',
  'checked_memory',
  'recommended_next_action',
  'crm_commit_proof',
  'skill_outcome_ready',
  'memory_learning_ready',
  'handoff_guard',
]) {
  assert(
    stepIds.includes(requiredStep),
    `Cockpit mission timeline must include ${requiredStep}.`
  );
}

assert.equal(cockpit.fastMemory.hot, 'redis_or_in_process_live_call_state');
assert.equal(cockpit.fastMemory.durable, 'postgres_vector_after_call');
assert.equal(cockpit.leadCommitProof.envelope, 'LeadCommitEnvelope');
assert.equal(cockpit.leadCommitProof.source, 'ava-call-transcript-projection');
assert(
  cockpit.leadCommitProof.fields.includes('sellerTargetPrice'),
  'Lead commit proof must list call-derived CRM fields.'
);
assert.equal(cockpit.memoryProof.hotMemory, 'redis_or_in_process_live_call_state');
assert.equal(cockpit.memoryProof.durableMemory, 'postgres_vector_after_call');
assert.equal(cockpit.memoryProof.learningReady, true);
assert.equal(cockpit.skillOutcomeProof.ready, true);
assert.equal(cockpit.skillOutcomeProof.skillId, 'skill-live-speed-condition');
assert.equal(cockpit.observability.crmWrite, 'guarded_by_lead_commit_envelope');
assert.equal(cockpit.observability.memoryWrite, 'post_call_learning_or_live_memory');

const liveCallPip = readFileSync('src/app/components/inbox/LiveCallPip.tsx', 'utf8');
assert(
  liveCallPip.includes('readAvaLiveCockpit') &&
    liveCallPip.includes('Ava mission timeline') &&
    liveCallPip.includes('CRM proof') &&
    liveCallPip.includes('Memory proof') &&
    liveCallPip.includes('Skill proof'),
  'Inbox live call UI must render Ava mission timeline and proof cards.'
);

const liveCallWidget = readFileSync('src/app/components/shell/LiveCallWidget.tsx', 'utf8');
assert(
  liveCallWidget.includes('avaLiveCockpit') &&
    liveCallWidget.includes('readAvaLiveCockpit') &&
    liveCallWidget.includes('Ava mission'),
  'Command Center live call widget must receive and render the Ava cockpit.'
);

const commandCenter = readFileSync('src/app/routes/CommandCenter.tsx', 'utf8');
assert(
  commandCenter.includes('avaLiveCockpit') &&
    commandCenter.includes('call.avaLiveCockpit') &&
    commandCenter.includes('call.ava_live_cockpit'),
  'Command Center must map bridge cockpit state into LiveCallWidget.'
);

const styles = readFileSync('src/styles/pbk-components.css', 'utf8');
assert(
  styles.includes('.pbk-live-call-cockpit') &&
    styles.includes('.pbk-live-call-mission-timeline') &&
    styles.includes('.pbk-live-call-proof-grid'),
  'Live call cockpit styles must exist for mobile/desktop readability.'
);

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'ava_call_intelligence_control_loop_ready',
      steps: stepIds,
      crmFields: cockpit.leadCommitProof.fields,
    },
    null,
    2
  )
);
