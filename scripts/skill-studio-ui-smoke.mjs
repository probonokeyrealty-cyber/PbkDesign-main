import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const routePath = resolve(root, 'src/app/routes/SkillStudio.tsx');
assert(existsSync(routePath), 'Skill Studio route component must exist.');

const route = readFileSync(routePath, 'utf8');
const router = readFileSync(resolve(root, 'src/app/shell/router.tsx'), 'utf8');
const sidebar = readFileSync(resolve(root, 'src/app/shell/Sidebar.tsx'), 'utf8');
const layout = readFileSync(resolve(root, 'src/app/shell/ParadiseLayout.tsx'), 'utf8');
const memory = readFileSync(resolve(root, 'src/app/routes/MemoryAnalytics.tsx'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const styles = readFileSync(resolve(root, 'src/styles/pbk-components.css'), 'utf8');

assert(router.includes("path: 'skills'"), 'Router must expose /skills.');
assert(sidebar.includes("to: '/skills'"), 'Sidebar must expose Skill Studio.');
assert(layout.includes("'/skills'"), 'Shell route persistence must recognize /skills.');
assert(memory.includes('Open Skill Studio'), 'Memory Analytics must link to Skill Studio.');
assert(memory.includes('Add Skill'), 'Memory Analytics must expose the candidate entry point.');

for (const helper of [
  'fetchSkillGovernanceStatusRequest',
  'fetchSkillGovernanceRepositoryRequest',
  'approveSkillVersionRequest',
  'activateSkillVersionRequest',
  'rollbackSkillActivationRequest',
  'ingestSkillCandidatesRequest',
]) {
  assert(runtimeBridge.includes(helper), `Runtime bridge must expose ${helper}.`);
  assert(route.includes(helper), `Skill Studio must use ${helper}.`);
}

for (const label of ['Manual', 'YouTube', 'Learn from YouTube', 'Analyze video']) {
  assert(route.includes(label), `Skill candidate intake must expose ${label}.`);
}
assert(
  route.includes("sourceType: 'youtube'") && route.includes('maxCandidates'),
  'Skill Studio must submit bounded YouTube ingestion requests.'
);
assert(
  styles.includes('.pbk-skill-intake-mode') &&
    styles.includes('.pbk-skill-youtube-note'),
  'Skill Studio must style the YouTube intake mode.'
);

for (const label of [
  'Review',
  'Scenarios',
  'Chain',
  'Agents',
  'Approval',
  'Activate',
  'Outcomes',
]) {
  assert(route.includes(label), `Skill Studio lifecycle must include ${label}.`);
}

assert(
  styles.includes('.pbk-skill-studio') &&
    styles.includes('@media (max-width: 760px)') &&
    styles.includes('.pbk-skill-studio-inspector'),
  'Skill Studio must include responsive workspace and inspector styles.'
);
assert(
  route.includes('pbk-skill-dialog-body') &&
    /event\.target === event\.currentTarget/.test(route),
  'Skill candidate intake must have a dedicated scroll body and deliberate backdrop dismissal.'
);
assert(
  /\.pbk-skill-dialog\s*\{[\s\S]*?grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/.test(
    styles
  ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-skill-dialog footer[\s\S]*?position:\s*sticky[\s\S]*?bottom:\s*0/.test(
      styles
    ),
  'Skill candidate actions must remain visible above mobile safe areas.'
);

console.log('skill-studio-ui-smoke: ok');
