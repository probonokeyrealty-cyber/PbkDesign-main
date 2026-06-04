import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const checks = [];

function expect(source, pattern, label) {
  const passed =
    pattern instanceof RegExp ? pattern.test(source) : source.includes(String(pattern));
  checks.push({ label, passed });
}

const toastHost = read('src/app/components/UiToastHost.tsx');
const uiFeedback = read('src/app/utils/uiFeedback.ts');
expect(uiFeedback, 'critical?: boolean', 'Toast payload supports critical persistence');
expect(toastHost, 'toast.critical', 'Critical toasts bypass auto-dismiss');
expect(toastHost, '6000', 'Non-critical toasts stay visible for at least 6 seconds');
expect(
  toastHost,
  /aria-live=\{hasCriticalToast \? ['"]assertive['"] : ['"]polite['"]\}/,
  'Critical toasts use assertive live region'
);

const leads = read('src/app/routes/Leads.tsx');
expect(leads, /type DetailStatus/, 'Leads tracks detail status severity');
expect(leads, /leadDetailLoading/, 'Leads tracks explicit detail loading state');
expect(leads, /lead-detail-skeleton/, 'Leads renders a lead detail skeleton');
expect(leads, /Retry detail/, 'Leads detail error exposes a retry action');
expect(leads, /RefreshCw size=\{14\} className=\{reloading \? 'animate-spin'/, 'Lead refresh button shows animated loader');
expect(leads, /clampMotivationScore/, 'Motivation score is clamped while typing');
expect(leads, /bantJsonError/, 'BANT JSON validates live while typing');
expect(leads, /seller1EmailError/, 'Contract seller email validates live');
expect(leads, /type="email"[\s\S]*required[\s\S]*value=\{contractForm\.seller1Email\}/, 'Seller 1 email is an email + required field');
expect(leads, /disabled=\{isLeadActionBusy \|\| Boolean\(contractLiveValidation\)\}/, 'Contract send is disabled by live validation');

const commandCenter = read('src/app/routes/CommandCenter.tsx');
expect(commandCenter, /type ActionStatus/, 'CommandCenter action status carries tone');
expect(commandCenter, /setActionStatus\(\{ tone: 'error'/, 'CommandCenter errors use error tone');
expect(commandCenter, /border-rose-400\/30/, 'CommandCenter error banner has red styling');
expect(commandCenter, /Loader2 size=\{15\} className="animate-spin"/, 'CommandCenter pending actions show spinner');

const inbox = read('src/app/routes/Inbox.tsx');
expect(inbox, /recipientValidation/, 'Inbox validates recipient before send');
expect(inbox, /AlertCircle/, 'Inbox error states include error icon');
expect(inbox, /border-rose-400\/30/, 'Inbox approval/send errors use red styling');
expect(inbox, /Loader2 size=\{14\} className="animate-spin"/, 'Inbox approval decisions show spinner');
expect(inbox, /showUiToast\(\{ tone: 'error'[\s\S]*critical: true/, 'Inbox send failures use persistent critical toast');

const agentFleet = read('src/app/routes/AgentFleet.tsx');
expect(agentFleet, /const \[agentsLoading/, 'AgentFleet tracks loading state');
expect(agentFleet, /fleet-loading-skeleton/, 'AgentFleet renders skeleton cards while loading');
expect(agentFleet, /const \[previewError/, 'AgentFleet keeps preview errors persistently inline');
expect(agentFleet, /Retry preview/, 'AgentFleet preview error has retry action');
expect(agentFleet, /Dismiss/, 'AgentFleet preview error can be dismissed');
expect(agentFleet, /showUiToast\(\{[\s\S]*title: 'Call request failed'[\s\S]*critical: true/, 'AgentFleet call failures use critical toast');

const styles = read('src/styles/index.css');
expect(styles, '.lead-detail-skeleton', 'Lead detail skeleton has CSS');
expect(styles, '.fleet-loading-skeleton', 'Agent Fleet skeleton has CSS');
expect(styles, '.ui-toast-critical', 'Critical toast styling exists');

const failed = checks.filter((check) => !check.passed);

for (const check of checks) {
  console.log(`${check.passed ? 'ok' : 'not ok'} - ${check.label}`);
}

if (failed.length) {
  console.error(`\n${failed.length} UI error/loading/validation checks failed.`);
  process.exit(1);
}

console.log('\nUI error/loading/validation smoke passed.');
