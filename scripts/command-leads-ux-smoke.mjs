import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const commandCenter = readFileSync(resolve(root, 'src/app/routes/CommandCenter.tsx'), 'utf8');
const leads = readFileSync(resolve(root, 'src/app/routes/Leads.tsx'), 'utf8');
const callFloor = readFileSync(resolve(root, 'src/app/components/CallFloorPanel.tsx'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const runtimeSnapshot = readFileSync(resolve(root, 'src/app/hooks/useRuntimeSnapshot.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/webSearchProbeFailed/.test(commandCenter), 'Command Center should track failed web-search probes for retry.');
assert(/Retry Probe/.test(commandCenter), 'Command Center should render a web-search retry button.');
assert(/adminDecisionDraft/.test(commandCenter), 'Admin decisions should be staged in a confirmation dialog.');
assert(/Confirm admin decision/.test(commandCenter), 'Admin approval/decline should show a confirmation dialog.');
assert(/setTimeout\(\(\) => setActionStatus\(''\), 5000\)/.test(commandCenter), 'Command Center actionStatus should auto-clear.');
assert(/Number\.isFinite\(timestamp\)/.test(commandCenter), 'Activity timestamp formatting should guard invalid dates.');
assert(/The bridge has not recorded activity yet/.test(commandCenter), 'Activity feed should keep its empty state.');
assert(/pollMs = 5000/.test(runtimeSnapshot), 'Runtime polling should remain at 5 seconds or faster by default.');

for (const [label, source] of [
  ['Leads', leads],
  ['CallFloorPanel', callFloor],
]) {
  assert(!/Call queued \(demo\)|No provider call was made/i.test(source), `${label} should not show demo call copy.`);
  assert(/startLeadCallRequest/.test(source), `${label} should call the bridge for outbound calls.`);
}

assert(/export async function startLeadCallRequest/.test(runtimeBridge), 'runtimeBridge should expose a typed lead call request helper.');
assert(/invokeRuntimeTool<Record<string, unknown>>\('telnyx_call'/.test(runtimeBridge), 'Lead calls should invoke the telnyx_call tool through the bridge.');
assert(/useMemo\(\s*\(\) => Array\.isArray\(snapshot\?\.leadImports\)/s.test(leads), 'Leads should memoize snapshot-derived lead records.');
assert(/validateLeadForCall/.test(leads), 'Leads should validate call contact data before invoking Telnyx.');
assert(/validateContractBeforeSend/.test(leads), 'Leads should validate contract contact data before sending.');
assert(/contractConfirmOpen/.test(leads), 'Contract send should require an irreversible-action confirmation.');
assert(/leadActionPending/.test(leads), 'Leads should use one action mutex for save/call/contract races.');
assert(/reloadTimerRef/.test(leads) && /reloadInFlightRef/.test(leads), 'Lead detail refresh should debounce and dedupe requests.');

assert(
  pkg.scripts?.['test:command-leads-ux'] === 'node ./scripts/command-leads-ux-smoke.mjs',
  'package.json should expose test:command-leads-ux.',
);

console.log('[command-leads-ux-smoke] ok');
