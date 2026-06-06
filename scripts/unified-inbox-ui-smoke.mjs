import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const componentPath = resolve(root, 'src/app/components/inbox/InboxSignalLanes.tsx');
const inboxPath = resolve(root, 'src/app/routes/Inbox.tsx');
const routerPath = resolve(root, 'src/app/shell/router.tsx');
const unifiedInboxPath = resolve(root, 'src/app/routes/UnifiedInbox.tsx');
const threadRailPath = resolve(root, 'src/app/components/inbox/ConversationThreadRail.tsx');
const timelinePath = resolve(root, 'src/app/components/inbox/ConversationTimeline.tsx');
const inspectorPath = resolve(root, 'src/app/components/inbox/LeadContextInspector.tsx');
const cssPath = resolve(root, 'src/styles/pbk-components.css');
const netlifyPath = resolve(root, 'netlify.toml');

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

for (const path of [unifiedInboxPath, threadRailPath, timelinePath, inspectorPath]) {
  assert(existsSync(path), `${path.split(/[\\/]/).at(-1)} must exist.`);
}

const router = readFileSync(routerPath, 'utf8');
const unifiedInbox = readFileSync(unifiedInboxPath, 'utf8');
const threadRail = readFileSync(threadRailPath, 'utf8');
const timeline = readFileSync(timelinePath, 'utf8');
const inspector = readFileSync(inspectorPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const netlify = readFileSync(netlifyPath, 'utf8');
const combined = `${unifiedInbox}\n${threadRail}\n${timeline}\n${inspector}`;

assert(
  /const UnifiedInbox = lazy\(/.test(router) &&
    /path:\s*['"]inbox\/conversations['"]/.test(router),
  'Router must lazy-load /inbox/conversations.'
);

for (const endpoint of [
  'GET /api/conversations',
  'GET /api/conversations/:threadId/timeline',
  'GET /api/leads/:id/full',
]) {
  assert(combined.includes(endpoint), `Unified inbox must label source ${endpoint}.`);
}

assert(
  !/Diane Kowalski|Marco Hill|John Smith|123 Main St|SAMPLE_|MOCK_/.test(combined),
  'Unified inbox must not contain mock sellers or fake messages.'
);
assert(
  css.includes('.pbk-conversation-bubble') &&
    css.includes('border-radius: 17px 17px 17px 6px') &&
    css.includes('.pbk-conversation-bubble.outbound'),
  'Unified inbox must define rounded directional message bubbles.'
);
assert(
  /@media \(max-width: 320px\)/.test(css) &&
    /max-width:\s*88%/.test(css),
  'Unified inbox must include explicit 320px mobile behavior and 88% bubbles.'
);
assert(
  /from\s*=\s*["']\/inbox\/\*["'][\s\S]*?to\s*=\s*["']\/index\.shell\.html["']/.test(
    netlify
  ),
  'Netlify must route nested inbox URLs to the modern shell.'
);
assert(
  unifiedInbox.includes('selectedRequestSequence') &&
    unifiedInbox.includes('selectedPollInFlight') &&
    unifiedInbox.includes('requestThreadId !== selectedThreadIdRef.current'),
  'Unified inbox must reject stale selected-thread responses and overlapping polls.'
);
assert(
  unifiedInbox.includes('selectedLeadMatch') &&
    unifiedInbox.includes('Confirm merge') &&
    unifiedInbox.includes("event.key === 'Escape'"),
  'Lead matching must use an accessible two-step confirmation dialog.'
);
assert(
  timeline.includes('onLatestSeen') && timeline.includes('atBottomRef'),
  'Read state must be driven by the operator reaching the newest timeline event.'
);

console.log('unified-inbox-ui-smoke: ok');
