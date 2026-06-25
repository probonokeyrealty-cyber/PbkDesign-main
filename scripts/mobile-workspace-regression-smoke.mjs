import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const app = read('src/app/App.tsx');
const campaigns = read('src/app/routes/Campaigns.tsx');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const shell = read('src/app/shell/ParadiseLayout.tsx');
const leads = read('src/app/routes/Leads.tsx');
const analyzerChrome = read('src/app/components/DealAnalyzerChrome.tsx');
const timeline = read('src/app/components/inbox/ConversationTimeline.tsx');
const composer = read('src/app/components/inbox/ConversationComposer.tsx');
const senderSelect = read('src/app/components/inbox/SenderIdentitySelect.tsx');
const avaChat = read('src/app/routes/AvaChat.tsx');
const css = read('src/styles/pbk-components.css');

assert(
  campaigns.includes('validateStep') &&
    campaigns.includes('pbk-wiz-validation') &&
    campaigns.includes('Daily cap must be at least 1.'),
  'Campaign creation must validate each mobile wizard step before advancing.'
);
assert(
  /height:\s*calc\(100dvh - env\(safe-area-inset-top\)\)/.test(css) &&
    /\.modal-backdrop:has\(\.pbk-wiz-modal\)\s*\{[\s\S]*?z-index:\s*100/.test(css) &&
    /\.pbk-wiz-foot \.nav-btns\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/.test(css) &&
    /\.pbk-wiz-modal input,[\s\S]*?font-size:\s*16px/.test(css),
  'Campaign wizard must fit the dynamic mobile viewport without iOS input zoom.'
);

const railIndex = app.indexOf('<DealAnalyzerMobileRail');
const contentIndex = app.indexOf('<div className="pbk-deal-content');
assert(
  railIndex > 0 && contentIndex > railIndex,
  'Deal analyzer mobile actions must render between command controls and analyzer content.'
);
assert(
  !analyzerChrome.includes('window.PBKAnalyzer + POST /api/analyzeDeal') &&
    !timeline.includes('GET /api/conversations/:threadId/timeline') &&
    !senderSelect.includes('GET /api/communication-identities'),
  'Operator pages must not expose requested bridge source debugging captions.'
);

assert(
  /\.pbk-conversation-main\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/.test(
    css
  ) &&
    /\.pbk-conversation-timeline\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/.test(
      css
    ) &&
    /\.pbk-conversation-timeline-scroll\s*\{[\s\S]*?overflow-y:\s*auto/.test(css) &&
    /\.pbk-conversation-composer\s*\{[\s\S]*?display:\s*grid[\s\S]*?grid-template-rows:\s*auto\s+auto/.test(
      css
    ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-unified-inbox\s*\{[\s\S]*?height:\s*100%[\s\S]*?max-height:\s*100%[\s\S]*?overflow:\s*hidden/.test(
      css
    ),
  'Unified inbox must keep identity/composer controls fixed and scroll only messages.'
);
assert(
  shell.includes('isFullHeightChatRoute') &&
    shell.includes('pbk-shell-content-chat') &&
    shell.includes('pbk-shell-main-column-chat') &&
    shell.includes("location.pathname === '/inbox/conversations'") &&
    shell.includes("location.pathname === '/ava-chat'") &&
    /@media \(max-width: 767px\)[\s\S]*?\.pbk-shell-frame\s*\{[\s\S]*?height:\s*100dvh[\s\S]*?min-height:\s*100dvh/.test(
      css
    ) &&
    /@media \(max-width: 767px\)[\s\S]*?\.pbk-shell-content\s*\{[\s\S]*?--pbk-mobile-nav-clearance:\s*max\(86px, calc\(76px \+ env\(safe-area-inset-bottom\)\)\)[\s\S]*?padding-bottom:\s*var\(--pbk-mobile-nav-clearance\)/.test(
      css
    ) &&
    /\.pbk-shell-content-chat\s*\{[\s\S]*?height:\s*100%[\s\S]*?max-height:\s*100%[\s\S]*?min-height:\s*0/.test(
      css
    ) &&
    /@media \(max-width: 767px\)[\s\S]*?\.pbk-shell-content-chat\s*\{[\s\S]*?height:\s*calc\(100dvh - 56px - var\(--pbk-mobile-nav-clearance\)\)[\s\S]*?max-height:\s*calc\(100dvh - 56px - var\(--pbk-mobile-nav-clearance\)\)[\s\S]*?padding-bottom:\s*0[\s\S]*?overflow:\s*hidden/.test(
      css
    ) &&
    /@media \(max-width: 767px\)[\s\S]*?\.pbk-shell-main-column-chat \.pbk-shell-favorites\s*\{[\s\S]*?display:\s*none/.test(
      css
    ) &&
    /@media \(max-width: 767px\)[\s\S]*?\.pbk-shell-content-chat\s*\{[\s\S]*?overflow:\s*hidden/.test(
      css
    ),
  'Full-height chat routes must let the shell own mobile nav inset while their internal timeline owns scrolling.'
);
assert(
  !/@media \(max-width: 760px\)[\s\S]*?\.pbk-unified-inbox\s*\{[\s\S]*?padding-bottom:\s*max\(84px/.test(
    css
  ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-unified-inbox\s*\{[\s\S]*?padding-bottom:\s*0/.test(
      css
    ),
  'Unified Inbox must not reserve mobile navigation space twice.'
);
assert(
  composer.includes('const showSendGuard') &&
    composer.indexOf('pbk-composer-draft-shell') <
      composer.lastIndexOf('pbk-composer-mobile-tools-toggle') &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-composer-mobile-tools-toggle\s*\{[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/.test(
      css
    ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-composer-body textarea\s*\{[\s\S]*?height:\s*44px/.test(
      css
    ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-conversation-timeline-head \.pbk-eyebrow\s*\{[\s\S]*?display:\s*none/.test(
      css
    ) &&
    /@media \(max-width: 760px\)[\s\S]*?\.pbk-conversation-timeline-head h2\s*\{[\s\S]*?white-space:\s*nowrap/.test(
      css
    ),
  'Unified inbox mobile composer must keep tools and send controls in a compact reachable dock.'
);
assert(
  avaChat.includes('pbk-ava-chat-composer') &&
    avaChat.includes('pbk-ava-chat-controls') &&
    avaChat.includes('min-w-0') &&
  avaChat.includes('h-full max-h-full') &&
    !avaChat.includes('h-[calc(100dvh-188px)]') &&
    avaChat.includes('pbk-ava-chat-toolbar') &&
    avaChat.includes('pbk-ava-chat-action-rail') &&
    avaChat.includes('grid-rows-[auto_minmax(0,1fr)_auto]') &&
    /\.pbk-ava-chat-composer\s*\{[\s\S]*?padding-bottom:\s*max\(/.test(css) &&
    /\.pbk-ava-chat-send-button\s*\{[\s\S]*?touch-action:\s*manipulation[\s\S]*?pointer-events:\s*auto/.test(
      css
    ) &&
    /\.pbk-ava-chat-action-rail\s*\{[\s\S]*?overflow-x:\s*auto/.test(css) &&
    /@media \(max-width: 640px\)[\s\S]*?\.pbk-ava-chat-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+44px/.test(
      css
    ) &&
    /@media \(max-width: 420px\)[\s\S]*?\.pbk-ava-chat-controls\s*\{[\s\S]*?display:\s*flex[\s\S]*?width:\s*100%/.test(
      css
    ) &&
    avaChat.includes('aria-label="Send to Ava"') &&
    avaChat.includes('className="pbk-ava-chat-send-button min-h-11 min-w-11 justify-center px-3"') &&
    !avaChat.includes('pbk-ava-lane-toggle'),
  'Ava Chat composer controls must fit 320px mobile viewports with a reachable send button.'
);

assert(
  leads.includes('pbk-leads-search') &&
    leads.includes('leadFilter') &&
    leads.includes('Contract ready') &&
    leads.includes('filteredLeads'),
  'Leads and contracts must expose interactive roster search and smart filters.'
);
assert(
  leads.includes('onClick={() => setSelectedLeadId(id)}') &&
    leads.includes('navigate(`/leads/${encodeURIComponent(activeLeadId)}`)') &&
    leads.includes('Agreed pricing / last offer') &&
    leads.includes('Contract path'),
  'Lead roster selection must stay in the workspace while an explicit Open lead action reaches the full portal.'
);
assert(
  commandCenter.includes('CALL_QUALITY_REVIEWED_KEY') &&
    commandCenter.includes('persistReviewedCallId') &&
    commandCenter.includes('reviewedCallRef.current.has(callId)'),
  'Reviewed call-quality dialogs must persist across dashboard reloads.'
);

console.log('mobile-workspace-regression-smoke: ok');
