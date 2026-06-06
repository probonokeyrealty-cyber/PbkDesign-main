import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const componentPath = resolve(root, 'src/app/components/inbox/InboxSignalLanes.tsx');
const inboxPath = resolve(root, 'src/app/routes/Inbox.tsx');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(existsSync(componentPath), 'InboxSignalLanes.tsx must exist.');

const component = readFileSync(componentPath, 'utf8');
const inbox = readFileSync(inboxPath, 'utf8');

for (const copy of [
  'Approvals',
  'Ava/Rex waiting',
  'Unread',
  'seller replies',
  'Scheduled',
  'send later queue',
]) {
  assert(component.includes(copy), `InboxSignalLanes must render "${copy}".`);
}

assert(
  /from ['"]lucide-react['"]/.test(component),
  'InboxSignalLanes must use Lucide icons.'
);
assert(
  /aria-label=\{/.test(component) && /count/.test(component),
  'InboxSignalLanes buttons must expose accessible count labels.'
);
assert(
  /type InboxSignalLanesProps/.test(component) &&
    /onSelect\?: \(lane: 'approvals' \| 'unread' \| 'scheduled'\)/.test(component),
  'InboxSignalLanes must expose the planned lane callback contract.'
);

assert(
  /useNavigate/.test(inbox),
  'Inbox must use router navigation for the unified workspace.'
);
assert(
  inbox.includes('Open Unified Inbox'),
  'Inbox must expose the Open Unified Inbox command.'
);
assert(
  /navigate\(['"]\/inbox\/conversations['"]\)/.test(inbox),
  'Open Unified Inbox must navigate to /inbox/conversations.'
);
assert(
  /<InboxSignalLanes/.test(inbox),
  'Inbox must render the shared InboxSignalLanes component.'
);
assert(inbox.includes('New message') || inbox.includes('Compose'), 'Inbox must retain compose.');
assert(inbox.includes('Refresh'), 'Inbox must retain refresh.');

console.log('unified-inbox-ui-smoke: ok');
