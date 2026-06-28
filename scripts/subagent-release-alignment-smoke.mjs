#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (filePath) => readFileSync(resolve(root, filePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));

const toolingWorkflow = read('.github/workflows/tooling-verify.yml');
const automergeWorkflow = read('.github/workflows/agent-automerge.yml');
const agentEvalsWorkflow = read('.github/workflows/pbk-agent-evals.yml');
const awayMode = read('AWAY_MODE_OPERATIONS.md');
const releaseChecklist = read('RELEASE_CHECKLIST.md');
const productionArchitecture = read('docs/operations/production-architecture.md');
const featureInventory = read('docs/PBK_COMMAND_CENTER_COMPLETE_FEATURE_INVENTORY.md');
const migrationReadme = read('MIGRATION_README.md');
const planDir = resolve(root, 'docs/superpowers/plans');
const plans = readdirSync(planDir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => [name, read(`docs/superpowers/plans/${name}`)]);
const planByName = new Map(plans);
const unifiedPlan = planByName.get('2026-06-06-unified-conversation-lead-portal.md');
const mobilePlan = read('docs/superpowers/plans/2026-06-10-mobile-chat-density.md');
const youtubePlan = read('docs/superpowers/plans/2026-06-10-youtube-skill-ingestion.md');
const workerScript = read('scripts/pbk-agent-worker.ps1');
const registerWorkerScript = read('scripts/register-pbk-agent-worker.ps1');

assert(
  toolingWorkflow.includes('npm run test:tooling') && !toolingWorkflow.includes('npm run test:founder'),
  'Tooling Verify must run the focused tooling gate, not duplicate Founder Verify.'
);
assert(
  automergeWorkflow.includes("'agent/automerge'") && automergeWorkflow.includes("'agent/reviewed'"),
  'Agent auto-merge must require both agent/automerge and agent/reviewed.'
);
assert(
  /push:[\s\S]*branches:[\s\S]*-\s+main/.test(agentEvalsWorkflow),
  'PBK Agent Evals must also run after pushes to main.'
);
assert(
  agentEvalsWorkflow.includes('vars.NEON_PROJECT_ID') &&
    agentEvalsWorkflow.includes('vars.PBK_NEON_PROJECT_ID'),
  'PBK Agent Evals must accept GitHub Actions variables for the non-secret Neon project id.'
);
assert(
  packageJson.scripts?.['test:proof-policy-autonomy']?.includes('test:provider-action-dispatch') &&
    packageJson.scripts?.['test:proof-policy-autonomy']?.includes('test:mobile-browser-proof:preview') &&
    !packageJson.scripts?.['test:proof-policy-autonomy']?.includes('test:neon-evaluation-dry-run && npm run test:production-hardening'),
  'Proof policy autonomy must include provider dispatch, use self-contained mobile preview proof, and avoid duplicate Neon gates.'
);
assert(
  packageJson.scripts?.['test:production-hardening']?.includes('test:subagent-release-alignment'),
  'Production hardening must include the subagent release alignment guard.'
);
assert(
  awayMode.includes('one focused implementation pass') &&
    awayMode.includes('agent/reviewed') &&
    awayMode.includes('Release work is never blindly auto-merged'),
  'Away mode docs must encode one focused pass, reviewed auto-merge, and no blind release merge.'
);
assert(
  releaseChecklist.includes('Founder Verify') &&
    releaseChecklist.includes('Tooling Verify') &&
    releaseChecklist.includes('Hosted Founder Smoke') &&
    releaseChecklist.includes('PBK Agent Evals'),
  'Release checklist must name the required current PR gates.'
);
assert(
  productionArchitecture.includes('Render Postgres is the operational authority') &&
    productionArchitecture.includes('Neon is disposable eval/sandbox state only'),
  'Production architecture must keep Render Postgres as authority and Neon as eval-only.'
);
assert(
  featureInventory.includes('Historical inventory snapshot') &&
    featureInventory.includes('Current release authority'),
  'Feature inventory must be marked as historical, not current release truth.'
);
assert(
  migrationReadme.includes('Commit to a task branch') &&
    migrationReadme.includes('required GitHub gates'),
  'Migration README must route work through task branches, PR review, and required gates.'
);

for (const [name, plan] of plans) {
  assert(
    plan.includes('REQUIRED WORKFLOW') &&
      plan.includes('superpowers:subagent-driven-development') &&
      !plan.includes('superpowers:executing-plans to implement this plan'),
    `${name} must require subagent-driven development without the old executing-plans alternative.`
  );
}

assert(
  !unifiedPlan.includes('git push origin main') &&
    unifiedPlan.includes('git push origin HEAD') &&
    unifiedPlan.includes('explicit release approval'),
  'Unified conversation plan must not direct agents to push main or deploy without explicit release approval.'
);
assert(
  mobilePlan.includes('test:mobile-browser-proof:preview') && mobilePlan.includes('release is blocked'),
  'Mobile density plan must require self-contained mobile proof before release.'
);
assert(
  youtubePlan.includes('PBK Agent Evals on a disposable Neon branch'),
  'YouTube skill plan must mention disposable Neon evals for Skill Studio/Ava/CRM/memory impact.'
);
assert(
  workerScript.includes('C:\\Users\\Dell\\pbk-agent-runner') &&
    registerWorkerScript.includes('C:\\Users\\Dell\\pbk-agent-runner'),
  'Agent worker defaults must target the dedicated runner clone.'
);
assert(
  workerScript.includes('Get-BlockingAgentPullRequest') &&
    workerScript.includes('agent/reviewed') &&
    workerScript.includes('not claiming another task'),
  'Agent worker must not claim another task while an agent PR is awaiting review.'
);
assert(
  workerScript.includes('Primary worker failed after modifying files') &&
    workerScript.includes('second implementation pass') &&
    workerScript.includes('Get-MeaningfulRepoStatus'),
  'Agent worker fallback must stop after partial primary edits instead of running a second implementation pass.'
);

console.log('subagent-release-alignment-smoke: ok');
