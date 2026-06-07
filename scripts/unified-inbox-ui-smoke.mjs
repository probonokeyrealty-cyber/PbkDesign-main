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
const composerPath = resolve(root, 'src/app/components/inbox/ConversationComposer.tsx');
const newConversationPath = resolve(root, 'src/app/components/inbox/NewConversationDialog.tsx');
const senderSelectPath = resolve(root, 'src/app/components/inbox/SenderIdentitySelect.tsx');
const liveCallPipPath = resolve(root, 'src/app/components/inbox/LiveCallPip.tsx');
const conversationRuntimeLogicPath = resolve(
  root,
  'src/app/routes/conversationRuntimeLogic.js'
);
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

for (const path of [
  unifiedInboxPath,
  threadRailPath,
  timelinePath,
  inspectorPath,
  composerPath,
  newConversationPath,
  senderSelectPath,
  liveCallPipPath,
]) {
  assert(existsSync(path), `${path.split(/[\\/]/).at(-1)} must exist.`);
}

const router = readFileSync(routerPath, 'utf8');
const unifiedInbox = readFileSync(unifiedInboxPath, 'utf8');
const threadRail = readFileSync(threadRailPath, 'utf8');
const timeline = readFileSync(timelinePath, 'utf8');
const inspector = readFileSync(inspectorPath, 'utf8');
const composer = readFileSync(composerPath, 'utf8');
const newConversation = readFileSync(newConversationPath, 'utf8');
const senderSelect = readFileSync(senderSelectPath, 'utf8');
const liveCallPip = readFileSync(liveCallPipPath, 'utf8');
const conversationRuntimeLogic = readFileSync(conversationRuntimeLogicPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const netlify = readFileSync(netlifyPath, 'utf8');
const combined = `${unifiedInbox}\n${threadRail}\n${timeline}\n${inspector}`;
const composerCombined = `${composer}\n${senderSelect}`;

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
assert(
  /aria-label="Message channel"/.test(composer) &&
    /aria-pressed=\{channel === 'sms'\}/.test(composer) &&
    /aria-pressed=\{channel === 'email'\}/.test(composer),
  'Composer must expose an accessible SMS/email segmented control.'
);
assert(
  composer.includes('recipientRepairHref') &&
    composer.includes('Add contact info') &&
    composer.includes('/leads?new=1'),
  'Composer must route missing recipient data back to the canonical lead portal.'
);
assert(
  threadRail.includes('New message') &&
    threadRail.includes('onNewConversation') &&
    unifiedInbox.includes('<NewConversationDialog'),
  'Unified inbox must expose New message even when no thread exists.'
);
assert(
  newConversation.includes('resolveConversationThreadRequest') &&
    newConversation.includes('searchLeadsRequest') &&
    newConversation.includes('Open {channel.toUpperCase()} composer') &&
    !newConversation.includes('sendConversationMessageRequest'),
  'New message must resolve a canonical lead thread, then reuse the existing composer.'
);
assert(
  newConversation.includes("aria-pressed={channel === 'sms'}") &&
    newConversation.includes("aria-pressed={channel === 'email'}") &&
    newConversation.includes("event.key === 'Escape'"),
  'New message must provide accessible SMS/email selection and keyboard dismissal.'
);
assert(
  newConversation.includes('Add contact info in Lead Portal') &&
    newConversation.includes('Create a new lead'),
  'New message must provide direct repair paths for missing canonical contact data.'
);
for (const requiredCopy of [
  'From',
  'Telnyx',
  'Instantly',
  'Recommended',
  'Send later',
  'Ava mic',
  'Refine with Ava',
  'Smart replies',
]) {
  assert(
    composerCombined.includes(requiredCopy),
    `Sender-aware composer must include "${requiredCopy}".`
  );
}
for (const endpointHelper of [
  'fetchSenderIdentitiesRequest',
  'syncSenderIdentitiesRequest',
  'fetchSenderRecommendationRequest',
  'fetchReplyTemplatesRequest',
  'refineConversationDraftRequest',
  'sendConversationMessageRequest',
]) {
  assert(
    composer.includes(endpointHelper),
    `Composer must use bridge helper ${endpointHelper}.`
  );
}
assert(
  /if \(!\(inventory\.items \|\| \[\]\)\.length && !senderSyncAttempted\.current\)/.test(
    composer
  ) &&
    /await syncSenderIdentitiesRequest\(\)/.test(composer) &&
    /inventory = await fetchSenderIdentitiesRequest\(\{ channel \}\)/.test(composer),
  'An empty canonical sender inventory must trigger one provider sync and refetch.'
);
assert(
  /recognition\.onresult[\s\S]*setBody\(transcript\)/.test(composer) &&
    !/recognition\.onresult[\s\S]{0,450}sendMessage/.test(composer),
  'Speech recognition may edit the draft but must never send automatically.'
);
assert(
  /setBody\(response\.refinedDraft\)/.test(composer) &&
    !/refineDraft[\s\S]{0,900}sendConversationMessageRequest/.test(composer),
  'Ava refinement must remain editable and must never auto-send.'
);
assert(
  /selectedSender\?\.channel === channel/.test(composer) &&
    /!senderLoading/.test(composer),
  'Channel changes must not allow a stale sender identity to submit a message.'
);
assert(
  composer.includes('templateLeadName') &&
    composer.includes('templateAddress') &&
    composer.includes('templateInboundBody') &&
    /\[channel, templateAddress, templateInboundBody, templateLeadName\]/.test(composer),
  'Reply templates must use stable scalar dependencies instead of refetching on every render.'
);
assert(
  /submittedFingerprint/.test(composer) &&
    /exactMessageAlreadyQueued/.test(composer),
  'A queued approval or scheduled message must not be submitted twice without an edit.'
);
assert(
  /isConversationApprovalRequired\(response\)/.test(composer) &&
    /isConversationApprovalRequired/.test(conversationRuntimeLogic) &&
    /providerApproval\.id/.test(conversationRuntimeLogic) &&
    /result === 'queued_for_approval'/.test(conversationRuntimeLogic),
  'Composer must preserve drafts and show approval state for nested and top-level queue responses.'
);
assert(
  /bodyRef\.current === requestedBody/.test(composer) &&
    /channelRef\.current === requestedChannel/.test(composer) &&
    /bodyRef\.current\.trim\(\) === submittedBody/.test(composer),
  'Late Ava and provider responses must preserve newer operator edits.'
);
assert(
  /recommendationGuard/.test(composer) &&
    /if \(!recommended\) return ''/.test(composer) &&
    /reasonCodes/.test(composer),
  'A fail-closed sender recommendation must not fall back to an arbitrary identity.'
);
assert(
  /const \[notice, setNotice\]/.test(composer) &&
    /const \[sendOutcome, setSendOutcome\]/.test(composer),
  'Provider send outcomes must remain independent from dismissible composer notices.'
);
assert(
  /aria-describedby=/.test(composer) &&
    /conversation-send-requirement/.test(composer),
  'Disabled Send controls must expose their reason to assistive technology.'
);
assert(
  senderSelect.includes('POST /api/conversations/:threadId/sender-recommendation'),
  'Sender selector must identify the bridge endpoint that ranks its recommendation.'
);
assert(
  /<select[\s\S]*aria-label=\{senderLabel\}[\s\S]*value=\{selectedId\}/.test(senderSelect) &&
    /onChange=\{\(event\) => onChange\(event\.target\.value\)\}/.test(senderSelect),
  'Sender selection must use a native mobile-safe control.'
);
for (const formIdentity of [
  'id="conversation-search"',
  'name="conversationSearch"',
  'id="conversation-sender-identity"',
  'name="senderIdentityId"',
  'id="conversation-email-subject"',
  'name="subject"',
  'id="conversation-message-body"',
  'name="body"',
  'id="conversation-send-later"',
  'name="sendLater"',
  'id="conversation-scheduled-for"',
  'name="scheduledFor"',
]) {
  assert(
    `${threadRail}\n${composerCombined}`.includes(formIdentity),
    `Unified inbox form controls must include ${formIdentity}.`
  );
}
for (const action of [
  'Copy',
  'Mark important',
  'Report spam',
  'Delete',
  'toastUndo',
  'restoreConversationEventRequest',
]) {
  assert(timeline.includes(action), `Timeline event menus must include ${action}.`);
}
assert(
  /onPointerDown=\{startLongPress\}/.test(timeline) &&
    /const spamEligible = message && !outbound/.test(timeline),
  'Touch long-press must open the same menu, with spam reporting limited to inbound messages.'
);
assert(
  css.includes('.pbk-conversation-composer') &&
    css.includes('.pbk-sender-select-control') &&
    css.includes('env(safe-area-inset-bottom)') &&
    css.includes('max-height: min(58dvh, 520px)') &&
    css.includes('overflow-y: auto'),
  'Composer and sender selector must have responsive safe-area styles.'
);
assert(
  unifiedInbox.includes('useRuntimeSnapshot') &&
    /calls=\{snapshot\?\.calls \|\| \[\]\}/.test(unifiedInbox) &&
    unifiedInbox.includes('<LiveCallPip'),
  'Live call PiP must derive from real snapshot.calls data.'
);
for (const requiredCopy of [
  'Ava talk time',
  'Seller talk time',
  'Sentiment',
  'Not available',
  'Open transcript',
  'Mark important',
  'Add note',
  'Follow-up',
]) {
  assert(liveCallPip.includes(requiredCopy), `Live call PiP must include "${requiredCopy}".`);
}
for (const helper of [
  'controlRuntimeCall',
  'saveLeadNoteRequest',
  'scheduleAppointmentRequest',
]) {
  assert(liveCallPip.includes(helper), `Live call PiP must use existing helper ${helper}.`);
}
assert(
  css.includes('.pbk-live-call-pip') &&
    css.includes('env(safe-area-inset-top)') &&
    css.includes('env(safe-area-inset-bottom)'),
  'Live call PiP must stay clear of mobile safe areas and navigation.'
);
assert(
  /queued\|in\[_ -\]\?progress/.test(liveCallPip) &&
    /callStatusLabel/.test(liveCallPip),
  'Queued provider calls must surface honestly as Calling in the live PiP.'
);
assert(
  /endCallTarget/.test(liveCallPip) &&
    /endCallTarget\?\.id \|\| ''/.test(liveCallPip),
  'End-call confirmation must stay pinned to the call the operator selected.'
);
assert(
  /top:\s*calc\(150px \+ env\(safe-area-inset-top\)\)/.test(css),
  'Mobile live-call PiP must sit below conversation navigation controls.'
);
assert(
  /\.pbk-live-call-pip\.expanded[\s\S]*?bottom:\s*max\(82px,[\s\S]*?max-height:\s*none/.test(
    css
  ) &&
    /\.pbk-live-call-pip\.expanded \.pbk-live-call-pip-body[\s\S]*?flex:\s*1[\s\S]*?max-height:\s*none/.test(
      css
    ),
  'Expanded mobile live-call controls must remain scrollable on short viewports.'
);

console.log('unified-inbox-ui-smoke: ok');
