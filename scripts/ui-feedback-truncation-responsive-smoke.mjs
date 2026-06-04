import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expectContains(file, needle, description) {
  assert.ok(
    file.includes(needle),
    `${description}\nExpected source to contain: ${needle}`
  );
}

function expectMatches(file, pattern, description) {
  assert.ok(pattern.test(file), `${description}\nExpected pattern: ${pattern}`);
}

const leads = read('src/app/routes/Leads.tsx');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const inbox = read('src/app/routes/Inbox.tsx');
const agentFleet = read('src/app/routes/AgentFleet.tsx');
const topBar = read('src/app/components/TopBar.tsx');
const callFloor = read('src/app/components/CallFloorPanel.tsx');
const analytics = read('src/app/routes/Analytics.tsx');
const packageJson = read('package.json');

expectContains(packageJson, 'test:ui-feedback-truncation-responsive', 'Package exposes the UI feedback/truncation/responsive smoke test');

expectMatches(
  leads,
  /showUiToast\(\{\s*tone:\s*'success',\s*title:\s*'Lead updated'/s,
  'Lead save shows an explicit success toast'
);
expectContains(
  commandCenter,
  "title: 'Runtime action complete'",
  'Runtime action success emits a toast, not only a status box'
);
expectContains(
  inbox,
  'approvalFeedbackById',
  'Inbox approval cards keep a short-lived inline success indicator'
);
expectContains(
  agentFleet,
  'transferFeedbackByAgentId',
  'Agent cards keep a short-lived inline transfer indicator'
);
expectContains(
  agentFleet,
  'Transferred',
  'Agent transfer indicator uses a visible transferred label'
);

expectMatches(
  leads,
  /title=\{sellerName\}/,
  'Truncated lead names expose full seller name via title'
);
expectMatches(
  leads,
  /title=\{activeLeadTemplateName\}/,
  'Truncated template badge exposes full template name via title'
);
expectContains(
  topBar,
  "title={address || 'No property loaded'}",
  'TopBar address exposes a hover title'
);
expectContains(
  callFloor,
  'title={getLeadName(lead)}',
  'Call floor lead name exposes a title'
);
expectContains(
  callFloor,
  'title={getLeadAddress(lead)}',
  'Call floor lead address exposes a title'
);
expectContains(
  commandCenter,
  'line-clamp-2',
  'Command Center activity feed clamps long item text'
);
expectMatches(
  commandCenter,
  /title=\{String\(item\.text \|\| 'Runtime event'\)\}/,
  'Command Center activity feed exposes full text via title'
);

expectContains(
  leads,
  'xl:grid-cols-[minmax(280px,420px)_minmax(0,1fr)]',
  'Leads main grid uses a bounded responsive sidebar track'
);
expectContains(
  commandCenter,
  'max-w-screen-2xl',
  'Command Center content is capped on very wide monitors'
);
expectContains(
  callFloor,
  'grid-cols-[repeat(auto-fit,minmax(80px,1fr))]',
  'Call floor quick-time actions use an auto-fit responsive grid'
);
expectContains(
  topBar,
  'min-h-[54px]',
  'TopBar can grow vertically on very narrow screens'
);
expectContains(
  topBar,
  'flex-wrap',
  'TopBar controls can wrap instead of overflowing'
);
expectContains(
  topBar,
  'min-w-[280px]',
  'TopBar keeps a stable tiny-screen minimum width'
);
expectContains(
  analytics,
  'min-w-[min(320px,calc(100vw-2rem))]',
  'Analytics drill-down panel prevents title/close overlap on narrow screens'
);

console.log('UI feedback, truncation, and responsive smoke checks passed.');
