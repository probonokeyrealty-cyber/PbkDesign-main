import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('shell keyboard entry and icon navigation keep existing handlers', async () => {
  const layout = await read('src/app/shell/ParadiseLayout.tsx');
  const nav = await read('src/app/shell/Sidebar.tsx');
  assert.ok(layout.includes('Skip to workspace'));
  assert.ok(layout.includes('id="pbk-workspace-main"'));
  assert.ok(nav.includes('aria-label="Workspace pages"'));
  assert.ok(nav.includes('aria-label={showBadge ? `${label}, ${pendingApprovals} pending approvals` : label}'));
  assert.ok(nav.includes('PanelLeftOpen') && nav.includes('PanelLeftClose'));
  assert.ok(nav.includes('onClick={onToggleRail}'));
  assert.ok(layout.includes('<TeamAccessGate onAuthenticated={onAuthenticated}>'));
});

test('shared typography uses bundled fonts before route-specific styles', async () => {
  const fonts = await read('src/styles/fonts.css');
  const faces = fonts;
  assert.ok(fonts.includes("--font-ui: 'PBK Plus Jakarta Sans'"));
  for (const name of ['PlusJakartaSans.woff2', 'Fraunces.woff2',
    'JetBrainsMonoNLNerdFontMono-Regular.woff2', 'JetBrainsMonoNLNerdFontMono-Bold.woff2']) {
    assert.ok(faces.includes(name));
  }
  assert.ok(faces.includes('font-display: swap'));
  assert.ok(!(await read('src/styles/faster-triage.css')).includes('@font-face'));
  const entry = await read('src/main.shell.tsx');
  assert.ok(entry.includes("import './styles/command-center-polish.css'"));
});

test('polish CI covers shell entry and build configuration changes without deployment', async () => {
  const workflow = await read('.github/workflows/command-center-polish-verify.yml');
  for (const path of ['index.shell.html', 'vite.config.ts']) {
    assert.ok(workflow.includes(`'${path}'`), `${path} changes must trigger regression coverage`);
  }
  assert.ok(workflow.includes('contents: read'));
  assert.ok(!/^\s*run:.*\b(?:deploy|publish)\b/m.test(workflow));
});
