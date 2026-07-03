#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const planner = readFileSync(resolve(root, 'scripts/pbk-agent-planner.mjs'), 'utf8');
const worker = readFileSync(resolve(root, 'scripts/pbk-agent-worker.ps1'), 'utf8');
const server = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const issueTemplate = readFileSync(resolve(root, '.github/ISSUE_TEMPLATE/agent-work-packet.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

for (const section of ['## Goal', '## Success Criteria', '## Allowed Files', '## Forbidden Files', '## Required Tests', '## Proof', '## Deploy Impact']) {
  assert(
    planner.includes(section),
    `Agent planner prompt must require ${section} in child work orders.`
  );
}

assert.match(
  planner,
  /Proof[\s\S]*commands[\s\S]*logs[\s\S]*artifacts/i,
  'Planner prompt must explain that proof means expected commands, logs, or artifacts.'
);
assert.match(
  planner,
  /function validatePlannerReadyWorkOrder/,
  'Planner must validate existing issue work-order sections before applying agent/ready.'
);
assert.match(
  planner,
  /decision === 'ready'[\s\S]*validatePlannerReadyWorkOrder/,
  'Planner ready branch must call work-order validation before labeling an issue ready.'
);

for (const label of ['Goal', 'Success Criteria', 'Allowed Files', 'Forbidden Files', 'Required Tests', 'Proof', 'Deploy Impact']) {
  assert.match(issueTemplate, new RegExp(`label:\\s*${label}`, 'i'), `Agent issue template must collect ${label}.`);
}

assert.match(
  issueTemplate,
  /id:\s*proof[\s\S]*label:\s*Proof/i,
  'Agent issue template must include an explicit Proof textarea.'
);

assert.match(
  worker,
  /function Test-AgentWorkOrderReady/,
  'Agent worker must validate work-order readiness before invoking OpenClaw.'
);
assert.match(
  worker,
  /\$requiredSections\s*=\s*@\([\s\S]*"## Goal"[\s\S]*"## Success Criteria"[\s\S]*"## Allowed Files"[\s\S]*"## Forbidden Files"[\s\S]*"## Required Tests"[\s\S]*"## Proof"[\s\S]*"## Deploy Impact"/,
  'Agent worker readiness validation must require the full planner work-order contract.'
);
assert.match(
  worker,
  /agent\/human-required/,
  'Agent worker must move incomplete work orders to human-required instead of running them.'
);
assert.match(
  worker,
  /Test-AgentWorkOrderReady[\s\S]*New-AgentPrompt/,
  'Agent worker must validate a ready issue before constructing the OpenClaw prompt.'
);

assert.match(
  worker,
  /function Get-AgentWorkOrderSection/,
  'Agent worker must parse individual work-order sections, not only headings.'
);
assert.match(
  worker,
  /#\{2,3\}/,
  'Agent worker must accept both planner ## sections and GitHub issue-form ### sections.'
);
assert.match(
  worker,
  /IgnoreCase/,
  'Agent worker must match issue-form section labels case-insensitively.'
);
assert.match(
  planner,
  /new RegExp\([^)]*'mi'\)/,
  'Planner ready validation must match issue-form section labels case-insensitively.'
);
assert.match(
  worker,
  /placeholderPatterns[\s\S]*TBD[\s\S]*todo[\s\S]*n\/a/i,
  'Agent worker must reject placeholder work-order content.'
);
assert.match(
  worker,
  /minimumRequiredTests[\s\S]*npm run test:founder/i,
  'Agent worker must enforce baseline required tests for unattended work.'
);

assert.match(
  server,
  /function buildAgentWorkOrderEnvelope\(/,
  'Runtime must build a durable work-order envelope before firing an agent.'
);
assert.match(
  server,
  /schema:\s*'pbk\.agent\.work_order\.v1'/,
  'Agent work-order envelope must carry an explicit schema version.'
);
assert.match(
  server,
  /autonomyMode:\s*providerWriteIntent\s*\?\s*'approval_gated'\s*:\s*'supervised_autonomous'/,
  'Agent work-order envelope must distinguish approval-gated provider writes from supervised autonomous work.'
);
assert.match(
  server,
  /const AGENT_PROVIDER_WRITE_TOOL_NAMES = new Set\([\s\S]*telnyx_sms[\s\S]*telnyx_call[\s\S]*sendDocuSign[\s\S]*sendContract[\s\S]*sendColdEmail[\s\S]*updateCRM[\s\S]*startNurtureSequence/,
  'Provider-write detection must include common PBK provider action tool names.'
);
assert.match(
  server,
  /function normalizeAgentProviderIntentText/,
  'Provider-write detection must normalize camelCase, underscores, and hyphens before matching.'
);
assert.match(
  server,
  /payload\.providerWriteIntent === true[\s\S]*payload\.approvalIntent/,
  'Agent provider-write detection must honor Ava-delegated providerWriteIntent and approvalIntent markers.'
);
assert.match(
  server,
  /const providerWriteRequiresApproval = Boolean\([\s\S]*safetyValidation\?\.providerWrite === true[\s\S]*safetyValidation\?\.approvalRequired !== false/,
  'Autopilot must still treat provider writes as approval-required when safety validation says so.'
);
assert.doesNotMatch(
  server,
  /if \(mode === 'autopilot' && !forceApproval && !safetyReviewRequired\) return null;/,
  'Autopilot must not bypass provider-write approval solely because there are no safety warnings.'
);

const invokeStart = server.indexOf('async function invokeAgentFromRegistry');
const invokeEnd = server.indexOf('\nfunction normalizeRexTool', invokeStart);
assert(invokeStart > 0 && invokeEnd > invokeStart, 'Could not isolate invokeAgentFromRegistry source.');
const invokeSource = server.slice(invokeStart, invokeEnd);

assert.match(
  invokeSource,
  /const workOrder = buildAgentWorkOrderEnvelope\(/,
  'Generic agent invocation must create a work order before execution.'
);
assert.match(
  invokeSource,
  /agentTask = await recordAgentHandoffTask\(/,
  'Generic agent invocation must persist an agent task ledger record.'
);
assert.match(
  invokeSource,
  /status:\s*'running'/,
  'Generic agent invocation must create a running ledger task before execution.'
);
assert.match(
  invokeSource,
  /taskType:\s*'agent_invocation'/,
  'Agent invocation ledger task must use taskType agent_invocation.'
);
assert.match(
  invokeSource,
  /catch \(error\)[\s\S]*recordAgentHandoffTask\([\s\S]*status:\s*'failed'/,
  'Failed agent invocations must update the work-order ledger to failed.'
);
assert.match(
  invokeSource,
  /workOrder,\s*\n\s*agentTask,/,
  'Agent invocation response must return workOrder and agentTask for UI proof.'
);

assert.equal(
  pkg.scripts?.['test:agent-work-order'],
  'node ./scripts/pbk-agent-work-order-smoke.mjs',
  'package.json must expose test:agent-work-order.'
);

console.log('[pbk-agent-work-order-smoke] ok');
