import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sidebar = read('src/app/shell/Sidebar.tsx');
const paradiseLayout = read('src/app/shell/ParadiseLayout.tsx');
const callMode = read('src/app/components/CallModeTab.tsx');
const callFloor = read('src/app/components/CallFloorPanel.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const pkg = JSON.parse(read('package.json'));

assert(!/v0\.1 shell - engine intact|collapsed \? 'v0\.1'/.test(sidebar), 'Sidebar version should not be hardcoded to v0.1.');
assert(/buildReleaseLabel/.test(sidebar), 'Sidebar should render build/release metadata.');
assert(/pendingApprovals/.test(sidebar) && /showBadge/.test(sidebar), 'Sidebar should surface pending approval badges.');

assert(/VALID_SHELL_PATHS/.test(paradiseLayout), 'ParadiseLayout should validate saved lastPage routes before navigating.');
assert(/isValidShellPath/.test(paradiseLayout), 'ParadiseLayout should guard deleted or renamed saved routes.');
assert(/lastPageRestoredRef/.test(paradiseLayout), 'ParadiseLayout should restore lastPage only once on shell mount.');
assert(/dispatchShortcutEvent/.test(paradiseLayout), 'ParadiseLayout shortcuts should report unhandled events.');
assert(/showUiToast/.test(paradiseLayout), 'ParadiseLayout should show a toast when a shortcut fires into no listener.');

assert(/saveLeadNoteRequest/.test(callMode), 'CallMode should save call notes through the bridge.');
assert(
  /setCallNotes\(deal\.notes \|\| ''\);\s*setLastSavedNotes\(deal\.notes \|\| ''\);\s*}\s*,\s*\[deal\.address,\s*deal\.notes\]/s.test(callMode),
  'CallMode notes sync effect should depend on deal.notes.'
);
assert(/scheduleAppointmentRequest/.test(callMode), 'Schedule Follow-up should call the bridge scheduler.');
assert(/sendOfferEmailRequest/.test(callMode), 'Send Offer Email should call the bridge email endpoint.');
assert(/invokeRuntimeTool<Record<string, unknown>>\('updateCRM'/.test(callMode), 'Add to CRM should invoke the runtime CRM tool.');
assert(/onBlur=\{\(\) => void saveCallNotes\(\)\}/.test(callMode), 'Call notes should autosave on blur.');
assert(/handleScheduleFollowUp/.test(callMode) && /handleSendOfferEmail/.test(callMode) && /handleAddToCrm/.test(callMode), 'CallMode post-call buttons should have handlers.');

assert(/startLeadCallRequest/.test(callFloor), 'CallFloor should request provider calls through the bridge.');
assert(!/No provider call was made|startDemoCall/.test(callFloor), 'CallFloor should not contain demo-call copy or stubs.');
assert(/scheduleAppointmentRequest/.test(callFloor), 'CallFloor scheduling should sync scheduled calls to the bridge.');
assert(/cancelScheduledCallRequest/.test(callFloor), 'CallFloor cancel should sync cancellation to the bridge.');
assert(/notifyDueScheduledCalls/.test(callFloor), 'CallFloor should use granted browser notifications for due scheduled calls.');
assert(!/local schedule|Removed from the local call floor list|local<\/span>/.test(callFloor), 'CallFloor scheduled-call copy should not imply local-only state.');

assert(/export async function scheduleAppointmentRequest/.test(runtimeBridge), 'runtimeBridge should expose appointment scheduling.');
assert(/export async function cancelScheduledCallRequest/.test(runtimeBridge), 'runtimeBridge should expose scheduled-call cancellation.');
assert(/export async function saveLeadNoteRequest/.test(runtimeBridge), 'runtimeBridge should expose lead note saving.');
assert(/export async function sendOfferEmailRequest/.test(runtimeBridge), 'runtimeBridge should expose offer email sending.');

assert(
  pkg.scripts?.['test:shell-callmode-callfloor'] === 'node ./scripts/shell-callmode-callfloor-smoke.mjs',
  'package.json should expose test:shell-callmode-callfloor.',
);

console.log('[shell-callmode-callfloor-smoke] ok');
