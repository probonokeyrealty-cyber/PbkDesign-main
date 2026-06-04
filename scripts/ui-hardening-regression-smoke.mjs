import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

function read(file) {
  return readFileSync(resolve(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const landAnalysis = read('src/app/components/LandAnalysis.tsx');
const router = read('src/app/shell/router.tsx');
const viteConfig = read('vite.config.ts');
const netlifyConfig = read('netlify.toml');
const inboxRoute = read('src/app/routes/Inbox.tsx');
const inboxLogic = read('src/app/routes/inboxRuntimeLogic.js');
const avaAssistant = read('scripts/ava-assistant-chat.mjs');
const openclaw = read('scripts/openclaw-local-server.mjs');
const pkg = JSON.parse(read('package.json'));

assert(
  !/value:\s*any/.test(landAnalysis),
  'LandAnalysis input changes should use DealData[keyof DealData], not any.'
);
assert(
  /DealData\[keyof DealData\]/.test(landAnalysis),
  'LandAnalysis should type field values from DealData.'
);

assert(
  /lazy\(\(\)\s*=>\s*import\(/.test(router),
  'Shell routes should be loaded with React.lazy dynamic imports.'
);
assert(
  !/import\s+\{\s*(CommandCenter|Leads|DealView|Inbox|Settings|AgentFleet|MemoryAnalytics|Analytics)\s*\}\s+from\s+['"]\.\.\/routes\//.test(
    router
  ),
  'Shell route modules should not all be eagerly imported by the router.'
);

assert(/manualChunks/.test(viteConfig), 'Vite should define manualChunks for large vendors.');
assert(/vendor-react/.test(viteConfig), 'Vite chunks should split React/router vendor code.');
assert(/vendor-ui/.test(viteConfig), 'Vite chunks should split UI vendor code.');

assert(
  /from\s*=\s*["']\/["'][\s\S]*?to\s*=\s*["']\/index\.shell\.html["'][\s\S]*?status\s*=\s*200/.test(
    netlifyConfig
  ),
  'Netlify should rewrite / to the split shell entry point.'
);
assert(
  /setTimeout\(\(\) => setActionStatus\(''\), 5000\)/.test(inboxRoute),
  'Inbox actionStatus should auto-clear after 5 seconds.'
);

assert(
  /getSmsSegmentInfo/.test(inboxLogic) && /gsmSeptetLength/.test(inboxLogic),
  'Inbox SMS counting should use a GSM/UCS-2 helper.'
);
assert(
  /perSegment\s*=\s*units\s*<=\s*70\s*\?\s*70\s*:\s*67/.test(inboxLogic),
  'Inbox SMS counting should use UCS-2 70/67 character segment limits.'
);

assert(
  /Long text truncated/i.test(avaAssistant) &&
    /if\s*\(sanitizedInput\.truncated\)\s*\{\s*answer\s*=\s*`\$\{sanitizedInput\.warning\}/s.test(
      openclaw
    ),
  'Ava chat should warn callers when long input was truncated.'
);
assert(
  /send_nurture/.test(openclaw) &&
    /executeApprovedNurtureSequenceCore[\s\S]*approvalAction[\s\S]*send_nurture/.test(openclaw),
  'Approval callback should execute explicit send_nurture approvals through the nurture agent.'
);

assert(
  pkg.scripts?.['test:ui-hardening-regression'] ===
    'node ./scripts/ui-hardening-regression-smoke.mjs',
  'package.json should expose test:ui-hardening-regression.'
);

console.log('[ui-hardening-regression-smoke] ok');
