const pages = new Map([
  ['command center', '/command-center'],
  ['dashboard', '/command-center'],
  ['today', '/command-center'],
  ['tasks', '/command-center'],
  ['work queue', '/command-center#battlefield-title'],
  ['approvals', '/command-center#approvals'],
  ['review decisions', '/command-center#approvals'],
  ['recent activity', '/command-center#pbk-activity-heading'],
  ['live call', '/command-center#live-call'],
  ['live calls', '/command-center#live-call'],
  ['admin activity', '/command-center#admin-activity'],
  ['admin tasks', '/command-center#admin-activity'],
  ['ask ava', '/ava-chat'],
  ['ava chat', '/ava-chat'],
  ['ava', '/ava-chat'],
  ['leads', '/leads'],
  ['work leads', '/leads'],
  ['new lead', '/leads?new=1'],
  ['add lead', '/leads?new=1'],
  ['batch review', '/leads/batch-review'],
  ['prospecting', '/prospecting'],
  ['prospecting evidence', '/prospecting?view=evidence'],
  ['prospect parcels', '/dialer#prospecting-list'],
  ['dialer', '/dialer'],
  ['parcel dialer', '/dialer'],
  ['deal', '/deal'],
  ['deal analyzer', '/deals/analyzer'],
  ['analyzer', '/deals/analyzer'],
  ['inbox', '/inbox'],
  ['reply inbox', '/inbox'],
  ['conversations', '/inbox/conversations'],
  ['call recordings', '/inbox/conversations?filter=call'],
  ['recordings', '/inbox/conversations?filter=call'],
  ['agent fleet', '/agent-fleet'],
  ['property log', '/property-log'],
  ['brain', '/brain'],
  ['memory', '/memory'],
  ['skill studio', '/skills'],
  ['analytics', '/analytics'],
  ['campaigns', '/campaigns'],
  ['settings', '/settings'],
]);

const leadEvidenceCommands = new Map([
  ['saved analysis', '#lead-numbers'],
  ['saved underwriting', '#lead-numbers'],
  ['property overview', '#lead-property'],
  ['investor evidence', '#lead-investor'],
  ['property record', '#lead-record'],
  ['saved comps', '#lead-comps'],
  ['property photos', '#lead-photos'],
]);

export function readTodaySectionTarget(hash) {
  return /^#(battlefield-title|approvals|pbk-activity-heading|live-call|admin-activity)$/.exec(hash)?.[1] || '';
}

export function readLeadEvidenceTarget(hash) {
  if (hash === '#lead-numbers') return { sectionId: 'lead-numbers' };
  if (hash === '#lead-property') return { sectionId: 'lead-property', propertyTab: 'overview' };
  const propertyTab = /^#lead-(record|comps|photos|investor)$/.exec(hash)?.[1];
  return propertyTab ? { sectionId: 'lead-property', propertyTab } : null;
}

export function readAvaLeadSearch(value) {
  if (typeof value !== 'string' || value.length > 160 || /\p{Cc}/u.test(value)) return '';
  return value.trim();
}

export function resolveAvaBrowserCommand(text, leadId = '') {
  const command = text.trim().replace(/\s+/g, ' ').replace(/[.!]$/, '')
    .replace(/^(?:(?:hey )?ava,? )?(?:please )?/i, '');
  const leadSearch = /^search (?:the )?leads for (.+)$/i.exec(command);
  if (leadSearch) {
    if (/\p{Cc}/u.test(text)) return null;
    const query = readAvaLeadSearch(leadSearch[1]);
    return query ? { path: '/leads', state: { avaLeadSearch: query } } : null;
  }
  const match = /^(?:open|go to|show(?: me)?) (?:the )?(.+)$/.exec(command.toLowerCase());
  if (!match) return null;
  const page = match[1];
  const hash = leadEvidenceCommands.get(page);
  if (hash || page === 'current lead' || page === 'this lead' || page === 'edit lead' || page === 'lead conversation') {
    if (!/^[a-z\d_-][a-z\d_.:-]{0,255}$/i.test(leadId)) return { path: null };
    const encoded = encodeURIComponent(leadId);
    if (page === 'lead conversation') return { path: '/inbox/conversations?lead=' + encoded };
    if (page === 'edit lead') return { path: '/leads/' + encoded + '?edit=1' };
    return { path: '/leads/' + encoded + (hash || '') };
  }
  const path = pages.get(page);
  return path ? { path } : null;
}
