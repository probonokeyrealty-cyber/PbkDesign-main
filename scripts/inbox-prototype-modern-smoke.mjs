import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const packageJson = read('package.json');
const inbox = read('src/app/routes/Inbox.tsx');
const runtimeBridge = read('src/app/utils/runtimeBridge.ts');
const pbkCss = read('src/styles/pbk-components.css');
const dataMap = read('docs/modern-shell-bridge-data-map.md');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  packageJson.includes('"test:inbox-prototype-modern"'),
  'package.json must expose test:inbox-prototype-modern.'
);

[
  'InboxHero',
  'InboxSourceRail',
  'InboxStatRibbon',
  'InboxApprovalCard',
  'InboxMessageRow',
  'InboxThreadRail',
].forEach((component) => {
  assert(inbox.includes(component), `Inbox should include ${component}.`);
});

[
  'pbk-inbox-surface',
  'pbk-inbox-hero',
  'pbk-inbox-source-rail',
  'pbk-inbox-grid',
  'pbk-inbox-stat',
  'pbk-inbox-layout',
  'pbk-inbox-thread-rail',
  'pbk-inbox-card',
  'pbk-inbox-approval-card',
  'pbk-inbox-message-row',
].forEach((className) => {
  assert(inbox.includes(className) || pbkCss.includes(`.${className}`), `${className} must be implemented.`);
});

[
  'GET /state',
  'GET /api/messages',
  'GET /api/leads',
  'PUT /api/approvals/:id',
  'POST /api/lead/send-message',
  'POST /api/messages',
  'PATCH /api/messages/:id/archive',
].forEach((endpoint) => {
  assert(inbox.includes(endpoint), `Inbox should surface data source ${endpoint}.`);
});

assert(
  /PbkDataSource[\s\S]*endpoint="GET \/state"[\s\S]*status="ships"/.test(inbox),
  'Inbox must mark GET /state as a shipped approval/snapshot source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/messages"[\s\S]*status="ships"/.test(inbox),
  'Inbox must mark GET /api/messages as a shipped message source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="GET \/api\/leads"[\s\S]*status="ships"/.test(inbox),
  'Inbox must mark GET /api/leads as a shipped compose lead source.'
);
assert(
  /PbkDataSource[\s\S]*endpoint="PATCH \/api\/messages\/:id\/archive"[\s\S]*status="ships"/.test(
    inbox
  ),
  'Inbox must mark message archive/swipe persistence as shipped once the bridge route exists.'
);

assert(/getMessageLeadId/.test(inbox), 'Inbox should resolve lead ids from message rows.');
assert(/Open lead/.test(inbox), 'Inbox message rows should expose an Open lead portal action.');
assert(
  /\/leads\/\$\{encodeURIComponent\(leadId\)\}/.test(inbox),
  'Inbox Open lead action should deep-link to the canonical bridge-backed lead portal.'
);
assert(
  /onNavigate=\{navigate\}/.test(inbox) &&
    /onNavigate\(`\/leads\/\$\{encodeURIComponent\(leadId\)\}`\)/.test(inbox) &&
    !/window\.location\.assign\(`\/leads/.test(inbox),
  'Inbox Open lead action must use SPA navigation instead of reloading the shell.'
);
assert(
  /getApprovalRisk/.test(inbox) &&
    /getApprovalTitle/.test(inbox) &&
    /getApprovalReason/.test(inbox) &&
    /Ava wants to run:/.test(inbox),
  'Inbox approvals should use plain-English action copy with an explicit reason and risk.'
);
assert(
  /Leave for later/.test(inbox) &&
    /Left pending\. Ava will wait for your decision\./.test(inbox),
  'Inbox approvals should let operators defer without rejecting the queued action.'
);
assert(
  /approvalRiskRank\(right\) - approvalRiskRank\(left\)/.test(inbox),
  'Inbox approvals should sort high-risk requests before lower-risk requests.'
);

assert(
  !/John Smith|Diane Kowalski|123 Main St|Approve Offer|UI-only|SAMPLE_MESSAGES|MOCK_MESSAGES/.test(inbox),
  'Inbox must not port prototype sample people, addresses, or mock labels.'
);

assert(
    runtimeBridge.includes('/api/messages') &&
    runtimeBridge.includes('archiveMessageRequest') &&
    runtimeBridge.includes('/api/leads') &&
    runtimeBridge.includes('/api/lead/send-message') &&
    runtimeBridge.includes('/api/approvals/'),
  'runtimeBridge must contain the Inbox endpoint helpers.'
);
assert(
  dataMap.includes('/api/messages') &&
    dataMap.includes('/api/leads') &&
    dataMap.includes('/api/lead/send-message') &&
    dataMap.includes('PATCH /api/messages/:id/archive'),
  'Bridge data map must document Inbox runtime sources and archive wiring gap.'
);

[
  '.pbk-inbox-hero',
  '.pbk-inbox-stat',
  '.pbk-inbox-thread-rail',
  '.pbk-inbox-approval-card',
  '.pbk-inbox-approval-card.risk-high',
  '.pbk-inbox-approval-card .approval-why',
  '.pbk-inbox-message-row',
].forEach((selector) => {
  assert(pbkCss.includes(selector), `PBK CSS should include ${selector}.`);
});

console.log('inbox-prototype-modern-smoke: ok');
