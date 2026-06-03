import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const agentFleet = readFileSync(resolve(root, 'src/app/routes/AgentFleet.tsx'), 'utf8');
const settings = readFileSync(resolve(root, 'src/app/routes/Settings.tsx'), 'utf8');
const dealView = readFileSync(resolve(root, 'src/app/routes/DealView.tsx'), 'utf8');
const app = readFileSync(resolve(root, 'src/app/App.tsx'), 'utf8');
const shellTopbar = readFileSync(resolve(root, 'src/app/shell/ShellTopbar.tsx'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!/Call queued \(demo\)|No provider call was made/i.test(agentFleet), 'Agent Fleet should not show demo call copy.');
assert(/startLeadCallRequest/.test(agentFleet), 'Agent Fleet should invoke the real lead call bridge helper.');
assert(/handleCallSelectedLead/.test(agentFleet), 'Agent Fleet should expose a selected-lead call handler.');
assert(/pendingTransferQueueRef/.test(agentFleet), 'Agent Fleet transfer retry queue should be component-scoped.');
assert(!/const pendingTransferQueue: PendingTransfer\[\] = \[\]/.test(agentFleet), 'Agent Fleet should not use a module-level pending transfer queue.');
assert(/pendingTransferQueueRef\.current = \[\]/.test(agentFleet), 'Agent Fleet should clear pending transfers on unmount.');
assert(/assertBridgeTransferApplied/.test(agentFleet), 'Skill transfer should require a bridge acknowledgement.');
assert(/transferStatus/.test(agentFleet), 'Agent Fleet should render transfer confirmation/failure status.');

assert(/settingsAdminDecisionDraft/.test(settings), 'Settings admin decisions should be staged for confirmation.');
assert(/Confirm admin decision/.test(settings), 'Settings should render an admin confirmation dialog.');
assert(/setTimeout\(\(\) => setActionStatus\(''\), 5000\)/.test(settings), 'Settings actionStatus should auto-clear.');
assert(/refreshingDecision/.test(settings), 'Settings should show loading state while refreshing after admin decisions.');
assert(!/await refresh\(\)\.catch/.test(settings), 'Settings should not report success after swallowing refresh failures.');
assert(/<a[^>]+href=\{metricsUrl\}/s.test(settings), 'Settings metrics URL should be rendered as a clickable link.');

assert(/class DealViewErrorBoundary/.test(dealView), 'Deal View should wrap the engine in an error boundary.');
assert(/componentDidCatch|getDerivedStateFromError/.test(dealView), 'Deal View error boundary should catch render failures.');
assert(/<App engineOnly/.test(dealView), 'Deal View should mount App in engine-only mode.');
assert(
  /engineOnly/.test(app) && /!\s*engineOnly\s*&&\s*\(?\s*<TopBar/s.test(app),
  'App should suppress its internal TopBar in engine-only mode.',
);

assert(/useRuntimeSnapshot/.test(shellTopbar), 'Shell topbar should read runtime state.');
assert(/updateRuntimeSettingsRequest/.test(shellTopbar), 'Shell topbar autopilot toggle should persist to the bridge.');
assert(/searchResults/.test(shellTopbar) && /No results/.test(shellTopbar), 'Shell topbar search should render results or an empty state.');
assert(!/Probono Key Realty/.test(shellTopbar) && !/probonokeyrealty@gmail\.com/.test(shellTopbar), 'Shell topbar account chip should not hardcode founder account text.');
assert(/export async function updateRuntimeSettingsRequest/.test(runtimeBridge), 'runtimeBridge should expose settings updates.');

assert(
  pkg.scripts?.['test:agent-settings-shell-ux'] === 'node ./scripts/agent-settings-shell-ux-smoke.mjs',
  'package.json should expose test:agent-settings-shell-ux.',
);

console.log('[agent-settings-shell-ux-smoke] ok');
