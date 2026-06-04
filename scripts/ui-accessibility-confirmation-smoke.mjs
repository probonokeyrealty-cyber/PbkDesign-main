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

const topBar = read('src/app/components/TopBar.tsx');
expect(topBar, 'role="switch"', 'TopBar dark-mode control exposes switch semantics');
expect(topBar, 'aria-checked={darkMode}', 'TopBar dark-mode switch exposes checked state');
expect(topBar, /verdictMeta[\s\S]*icon/, 'TopBar verdict uses icon/text metadata, not color only');

const helpCss = read('src/styles/index.css');
expect(
  helpCss,
  '.help-tooltip-trigger:focus-visible',
  'HelpTooltip trigger has a visible focus-visible ring'
);

const commandCenter = read('src/app/routes/CommandCenter.tsx');
expect(
  commandCenter,
  /type ApprovalDecisionDraft/,
  'CommandCenter has an approval confirmation draft type'
);
expect(
  commandCenter,
  /aria-labelledby="approval-decision-title"/,
  'CommandCenter renders an approval confirmation dialog'
);
expect(
  commandCenter,
  /role="status"[\s\S]*aria-live="polite"/,
  'CommandCenter action status is announced politely'
);
expect(
  commandCenter,
  /aria-label=\{`\$\{item\.label\} status:/,
  'CommandCenter tooling status badges include text labels for screen readers'
);

const inbox = read('src/app/routes/Inbox.tsx');
expect(inbox, /type ApprovalDecisionDraft/, 'Inbox has a general approval confirmation draft');
expect(inbox, /aria-labelledby="inbox-approval-decision-title"/, 'Inbox renders approval confirmation dialog');

const agentFleet = read('src/app/routes/AgentFleet.tsx');
expect(
  agentFleet,
  /aria-labelledby="skill-transfer-confirm-title"/,
  'AgentFleet confirms skill transfers before invoking the bridge'
);

const callFloor = read('src/app/components/CallFloorPanel.tsx');
expect(
  callFloor,
  /aria-label=\{`Select \$\{getLeadName\(lead\)\}/,
  'CallFloorPanel lead result button has descriptive aria-label'
);
expect(
  callFloor,
  /aria-labelledby="cancel-scheduled-call-title"/,
  'CallFloorPanel confirms scheduled callback cancellation'
);

const leads = read('src/app/routes/Leads.tsx');
expect(leads, /type LeadCallConfirmDraft/, 'Leads has a call confirmation draft');
expect(leads, /aria-selected=\{isSelected\}/, 'Leads table rows expose selected state');
expect(leads, /aria-pressed=\{isSelected\}/, 'Leads mobile cards expose pressed state');
expect(leads, /aria-label=\{`Open lead \$\{sellerName\}/, 'Leads mobile cards have contextual aria-labels');
expect(leads, /aria-label=\{`Open lead \$\{getSellerName\(lead\)\}/, 'Leads table buttons have contextual aria-labels');
expect(leads, /aria-labelledby="lead-call-confirm-title"/, 'Leads confirms call requests before dialing');

const failed = checks.filter((check) => !check.passed);

for (const check of checks) {
  console.log(`${check.passed ? 'ok' : 'not ok'} - ${check.label}`);
}

if (failed.length) {
  console.error(`\n${failed.length} UI accessibility/confirmation checks failed.`);
  process.exit(1);
}

console.log('\nUI accessibility and confirmation smoke passed.');
