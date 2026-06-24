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
const legacyShell = readFileSync(resolve(root, 'index.html'), 'utf8');
const viteConfig = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');

assert(router.includes("path: 'skills'"), 'Router must expose /skills.');
assert(sidebar.includes("to: '/skills'"), 'Sidebar must expose Skill Studio.');
assert(layout.includes("'/skills'"), 'Shell route persistence must recognize /skills.');
assert(
  memory.includes('Teach Ava'),
  'Memory Analytics must link to Skill Studio in plain language.'
);
assert(memory.includes('Add Skill'), 'Memory Analytics must expose the candidate entry point.');
assert(
  viteConfig.includes('const shellHistoryPaths = new Set') &&
    viteConfig.includes("'/skills'") &&
    viteConfig.includes("'/skill-studio'") &&
    viteConfig.includes("'/skills/'") &&
    viteConfig.includes("'/skill-studio/'") &&
    viteConfig.includes('shouldServeShellHistory(req.url)'),
  'Vite dev server must route direct /skills and /skill-studio links to the React shell.'
);

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

for (const label of [
  'Type it',
  'Video',
  'Article',
  'Teach Ava a new skill',
  'Review stays mandatory',
  'Analyze video',
  'Analyze article',
]) {
  assert(route.includes(label), `Skill candidate intake must expose ${label}.`);
}
for (const label of [
  'SKILL_WIZARD_STEPS',
  'Situation',
  'Ava reply',
  'Price objection',
  'Response',
  'Next question',
  'Preview skill',
  'triggerPolicy',
]) {
  assert(route.includes(label), `Guided Skill Studio wizard must expose ${label}.`);
}
assert(
  styles.includes('.pbk-skill-wizard-steps') &&
    styles.includes('.pbk-skill-wizard-preview') &&
    styles.includes('.pbk-skill-dialog-footer-left'),
  'Skill Studio guided creation wizard must include step, preview, and mobile footer styles.'
);
assert(
  route.includes("sourceType: 'youtube'") &&
    route.includes('maxCandidates') &&
    route.includes('manualTranscript') &&
    route.includes('audioTranscriptUrl'),
  'Skill Studio must submit bounded YouTube ingestion requests with transcript and direct media fallbacks.'
);
assert(
  route.includes("sourceType: 'article'") &&
    route.includes('articleText') &&
    route.includes('articleTitle') &&
    route.includes('Article text, screenshot text, or detailed notes'),
  'Skill Studio must submit review-only article ingestion requests.'
);
assert(
  route.includes('getSkillPerformance') &&
    route.includes('performanceFilter') &&
    route.includes('agentFilter') &&
    route.includes('riskFilter') &&
    route.includes('pbk-skill-performance-dashboard') &&
    route.includes('pbk-skill-card-metrics'),
  'Skill Studio repository must expose performance-aware governance filters and metrics.'
);
assert(
  route.includes('Paste transcript or detailed notes') &&
    route.includes('Advanced: direct media link') &&
    route.includes('pbk-skill-youtube-fallback') &&
    route.includes('pbk-skill-audio-fallback'),
  'Skill Studio must expose clear fallback inputs for disabled YouTube captions.'
);
assert(
  route.includes('Human-approved learning') &&
    route.includes('Learning sync') &&
    route.includes('System of record') &&
    !/Fail-closed governance|Render authority|Supabase analytics mirror|Deepgram|Article text, screenshot OCR/.test(
      route
    ),
  'Skill Studio must keep operator-facing copy plain while preserving expandable details.'
);
assert(
  styles.includes('.pbk-skill-intake-mode') &&
    styles.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') &&
    styles.includes('.pbk-skill-youtube-note') &&
    styles.includes('.pbk-skill-youtube-fallback') &&
    styles.includes('.pbk-skill-audio-fallback') &&
    styles.includes('.pbk-skill-source-input') &&
    styles.includes('.pbk-skill-article-text'),
  'Skill Studio must style the YouTube and article intake modes and fallback transcript blocks.'
);
assert(
  styles.includes('.pbk-skill-filter-grid') &&
    styles.includes('.pbk-skill-card-metrics') &&
    styles.includes('.pbk-skill-card-badges') &&
    styles.includes('.pbk-skill-performance-dashboard'),
  'Skill Studio must style compact repository filters, skill metrics, and the performance dashboard.'
);
assert(
  legacyShell.includes('name="audioTranscriptUrl"') &&
    legacyShell.includes('name="manualTranscript"') &&
    legacyShell.includes('Direct audio/video transcript URL') &&
    legacyShell.includes('A normal YouTube watch link is not a direct media file') &&
    legacyShell.includes('manualTranscript || audioTranscriptUrl || youtubeUrl') &&
    legacyShell.includes('audioTranscriptUrl: payload.audioTranscriptUrl'),
  'Legacy SkillRepo fallback shell must preserve direct media and manual transcript evidence for disabled-caption videos.'
);

for (const label of ['Review', 'Practice', 'Fit', 'Agent', 'Approve', 'Start small', 'Outcomes']) {
  assert(route.includes(label), `Skill Studio lifecycle must include ${label}.`);
}

assert(
  styles.includes('.pbk-skill-studio') &&
    styles.includes('@media (max-width: 760px)') &&
    styles.includes('.pbk-skill-studio-inspector'),
  'Skill Studio must include responsive workspace and inspector styles.'
);
assert(
  route.includes('pbk-skill-dialog-body') && /event\.target === event\.currentTarget/.test(route),
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
assert(
  /\.pbk-skill-dialog-backdrop\s*\{[\s\S]*?z-index:\s*130/.test(styles) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-skill-dialog-body[\s\S]*?padding:\s*0\s+14px\s+88px/.test(
      styles
    ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-skill-dialog footer[\s\S]*?calc\(16px \+ env\(safe-area-inset-bottom\)\)/.test(
      styles
    ),
  'Skill candidate mobile sheet must sit above shell nav and keep the governed-skill button tappable.'
);
assert(
  route.includes("selected.lifecycleState === 'ready_for_approval'") &&
    route.includes('confirmingPrimaryAction') &&
    route.includes('Confirm') &&
    !route.includes("if (compactViewport) setSelectedId('')"),
  'Skill Studio must only approve ready-for-approval versions, confirm high-impact actions, and preserve selected skills across mobile viewport changes.'
);

console.log('skill-studio-ui-smoke: ok');
