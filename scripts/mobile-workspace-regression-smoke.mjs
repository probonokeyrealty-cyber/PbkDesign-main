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
const leads = read('src/app/routes/Leads.tsx');
const analyzerChrome = read('src/app/components/DealAnalyzerChrome.tsx');
const timeline = read('src/app/components/inbox/ConversationTimeline.tsx');
const senderSelect = read('src/app/components/inbox/SenderIdentitySelect.tsx');
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
  /\.pbk-conversation-main\s*\{[\s\S]*?grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/.test(
    css
  ) &&
    /\.pbk-conversation-timeline-scroll\s*\{[\s\S]*?overflow-y:\s*auto/.test(css) &&
    /\.pbk-composer-scroll-body\s*\{[\s\S]*?grid-row:\s*2/.test(css),
  'Unified inbox must keep identity/composer controls fixed and scroll only messages.'
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
