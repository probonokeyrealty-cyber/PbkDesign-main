import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const packageJson = read('package.json');
const pager = read('src/app/components/CompactPager.tsx');
const commandCenter = read('src/app/routes/CommandCenter.tsx');
const inbox = read('src/app/routes/Inbox.tsx');
const leads = read('src/app/routes/Leads.tsx');
const skillStudio = read('src/app/routes/SkillStudio.tsx');
const css = read('src/styles/pbk-components.css');

assert(
  packageJson.includes('"test:operator-list-pagination-ux"'),
  'package.json must expose the operator list pagination UX smoke.'
);

assert(
  /export const OPERATOR_LIST_PAGE_SIZE = 10;/.test(pager) &&
    /data-list-page-size=\{pageSize\}/.test(pager) &&
    /aria-label=\{label\}/.test(pager),
  'CompactPager must define the ten-item operator page size and accessible controls.'
);

assert(
  inbox.includes('MESSAGE_PAGE_SIZE = OPERATOR_LIST_PAGE_SIZE') &&
    inbox.includes('approvalPage') &&
    inbox.includes('messagePage') &&
    inbox.includes('offset: page * MESSAGE_PAGE_SIZE') &&
    inbox.includes('label="Approval board pages"') &&
    inbox.includes('label="Message stream pages"') &&
    inbox.includes('pbk:approval-decision'),
  'Inbox must page approvals/messages by ten and broadcast approval decisions.'
);
assert(!inbox.includes('Load more messages'), 'Inbox must use pages instead of load-more lists.');

assert(
  commandCenter.includes('OPERATOR_LIST_PAGE_SIZE') &&
    commandCenter.includes('activityPage') &&
    commandCenter.includes('approvalPage') &&
    commandCenter.includes('adminPage') &&
    commandCenter.includes('visibleApprovals') &&
    commandCenter.includes('visibleAdminTasks') &&
    commandCenter.includes('fetchFounderWorkQueueRequest({ limit: OPERATOR_LIST_PAGE_SIZE })') &&
    commandCenter.includes('rankBattlefieldItems(items).slice(0, OPERATOR_LIST_PAGE_SIZE)') &&
    commandCenter.includes('label="Approval board pages"') &&
    commandCenter.includes('label="Activity feed pages"') &&
    commandCenter.includes('label="Workspace task pages"') &&
    commandCenter.includes('pbk:approval-decision'),
  'Command Center must page core lists by ten and keep approval decisions in unison.'
);
assert(
  !commandCenter.includes('activityLimit') && !commandCenter.includes('Load more activity'),
  'Command Center must replace activity load-more behavior with page controls.'
);
for (const harshCopy of [
  'Controls needing setup',
  'waiting on you',
  'Web Search Cognition',
  'Tooling Readiness',
  'Production gaps',
]) {
  assert(!commandCenter.includes(harshCopy), `Command Center should not show harsh copy: ${harshCopy}`);
}
for (const friendlyCopy of [
  'Approval board',
  'Next best steps',
  'Workspace readiness',
  'Support tools',
  'Market and web research',
]) {
  assert(commandCenter.includes(friendlyCopy), `Command Center should use friendly copy: ${friendlyCopy}`);
}

assert(
  leads.includes('leadPage') &&
    leads.includes('getPageSlice(filteredLeads, leadPage, OPERATOR_LIST_PAGE_SIZE)') &&
    leads.includes('label="Seller roster pages"'),
  'Leads must page the seller roster by ten.'
);
assert(!leads.includes('displayLimit') && !leads.includes('Load 50 more'), 'Leads must not use the old growing list limit.');

assert(
  skillStudio.includes('skillPage') &&
    skillStudio.includes('pagedVisibleItems') &&
    skillStudio.includes('label="Ava skill pages"'),
  'Skill Studio must page the repository by ten.'
);

assert(
  css.includes('.pbk-list-pager') &&
    css.includes('.pbk-list-pager-status') &&
    css.includes('@media (max-width: 560px)'),
  'Shared pager styles must be present and mobile-aware.'
);

console.log('operator-list-pagination-ux-smoke: ok');
