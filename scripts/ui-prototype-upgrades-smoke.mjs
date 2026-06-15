import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expectContains(source, needle, label) {
  assert.ok(source.includes(needle), `${label}\nExpected source to contain: ${needle}`);
}

function expectMatches(source, pattern, label) {
  assert.ok(pattern.test(source), `${label}\nExpected pattern: ${pattern}`);
}

const packageJson = read('package.json');
const uiPrefs = read('src/app/utils/uiPrefs.ts');
const uiFeedback = read('src/app/utils/uiFeedback.ts');
const toastHost = read('src/app/components/UiToastHost.tsx');
const layout = read('src/app/shell/ParadiseLayout.tsx');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const runtimeSnapshotHook = read('src/app/hooks/useRuntimeSnapshot.ts');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const liveCallWidget = read('src/app/components/shell/LiveCallWidget.tsx');
const callFloor = read('src/app/components/CallFloorPanel.tsx');
const bridgeMap = read('docs/modern-shell-bridge-data-map.md');

expectContains(
  packageJson,
  'test:ui-prototype-upgrades',
  'Package exposes the prototype upgrade smoke test'
);

expectContains(uiPrefs, 'getSystemPbkTheme', 'Theme prefs resolve system preference');
expectContains(uiPrefs, 'prefers-color-scheme: light', 'Theme prefs inspect prefers-color-scheme');
expectContains(layout, 'SessionTimeoutWarning', 'Shell renders the session timeout warning');
expectContains(layout, 'systemTheme', 'Shell tracks system theme changes');

expectContains(uiFeedback, 'undoId?: string', 'Toast payload supports undo handlers');
expectContains(uiFeedback, 'toastUndo', 'Undo toast helper is exported');
expectContains(toastHost, 'runToastUndo', 'Toast host can execute undo callbacks');
expectMatches(toastHost, /toast\.undoId[\s\S]*toast\.actionLabel/, 'Toast host renders undo action buttons');
expectContains(callFloor, 'toastUndo(', 'Scheduled callback cancellation offers undo');

expectContains(commandCenter, 'StatusColorLegend', 'Command Center includes the status color legend');
expectContains(commandCenter, 'visibleActivity', 'Activity feed uses progressive visible items');
expectContains(commandCenter, 'activityLimit', 'Activity feed tracks a load-more limit');
expectContains(commandCenter, 'Load more activity', 'Activity feed exposes a load-more button');
expectContains(commandCenter, 'CallQualityReviewDialog', 'Ended calls surface a quality review popup');
expectContains(commandCenter, 'pbk:command-center:widgets', 'Dashboard widget visibility is persisted locally');
expectContains(commandCenter, 'Widget controls', 'Command Center exposes dashboard widget controls');
expectMatches(
  commandCenter,
  /active\|connected\|in\[_ -\]\?progress\|live\|ringing\|transferring/,
  'Command Center live-call status mapping must match backend active statuses'
);
expectContains(
  commandCenter,
  'buildLiveCallCallerContext(call)',
  'Command Center must build live-call caller context through a sanitizer'
);
expectMatches(
  commandCenter,
  /inbound call mode\|bant\\\+ status\|negotiation guidance/,
  'Live-call caller context sanitizer must reject internal Ava prompt/script text'
);
expectMatches(
  commandCenter,
  /context:\s*buildLiveCallCallerContext\(call\)/,
  'Live-call caller context must not render raw call.script prompt text'
);
expectContains(
  runtimeSnapshotHook,
  'createRuntimeStateStreamSessionRequest',
  'Runtime snapshot hook must create a secured state-stream session'
);
expectContains(
  runtimeSnapshotHook,
  'subscribeRuntimeSnapshotStream',
  'Runtime snapshot hook must subscribe to realtime state updates with polling fallback'
);

expectContains(agentFleet, 'lastCallOutcomeByAgentId', 'Agent Fleet computes last call outcome per agent');
expectContains(agentFleet, 'runtimeCalls', 'Agent Fleet reads runtime calls from /state');
expectContains(agentFleet, 'Last call outcome', 'Agent cards surface the last call outcome');

expectContains(liveCallWidget, 'transcriptQuery', 'Live transcript has a user search query');
expectContains(liveCallWidget, 'Search transcript', 'Live transcript renders a search field');
expectContains(liveCallWidget, 'renderHighlightedTranscript(line.text, transcriptQuery)', 'Transcript search highlights matching text');

expectContains(
  bridgeMap,
  '## Campaigns',
  'Bridge map documents the ported Campaigns surface'
);
expectContains(
  bridgeMap,
  'POST /api/campaigns',
  'Bridge map pairs Campaigns with the real campaign creation endpoint'
);
expectContains(
  bridgeMap,
  'needs Mastra wiring',
  'Bridge map flags missing prototype ports instead of shipping fake data'
);

console.log('UI prototype upgrade smoke checks passed.');
