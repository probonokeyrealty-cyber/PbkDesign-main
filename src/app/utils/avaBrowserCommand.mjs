const pages = new Map([
  ['command center', '/command-center'],
  ['dashboard', '/command-center'],
  ['leads', '/leads'],
  ['deal analyzer', '/deals/analyzer'],
  ['analyzer', '/deals/analyzer'],
  ['inbox', '/inbox'],
  ['agent fleet', '/agent-fleet'],
  ['property log', '/property-log'],
]);

const leadEvidenceCommands = new Map([
  ['saved analysis', '#lead-numbers'],
  ['saved underwriting', '#lead-numbers'],
  ['property record', '#lead-record'],
  ['saved comps', '#lead-comps'],
  ['property photos', '#lead-photos'],
]);

export function readLeadEvidenceTarget(hash) {
  if (hash === '#lead-numbers') return { sectionId: 'lead-numbers' };
  if (hash === '#lead-property') return { sectionId: 'lead-property', propertyTab: 'overview' };
  const propertyTab = /^#lead-(record|comps|photos)$/.exec(hash)?.[1];
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
  if (hash || page === 'current lead' || page === 'this lead') {
    return { path: /^[a-z\d_-][a-z\d_.:-]{0,255}$/i.test(leadId) ? `/leads/${encodeURIComponent(leadId)}${hash || ''}` : null };
  }
  const path = pages.get(page);
  return path ? { path } : null;
}
