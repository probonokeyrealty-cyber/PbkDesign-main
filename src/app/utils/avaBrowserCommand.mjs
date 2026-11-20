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

export function resolveAvaBrowserCommand(text, leadId = '') {
  const command = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]$/, '');
  const match = /^(?:(?:hey )?ava,? )?(?:please )?(?:open|go to|show me) (?:the )?(.+)$/.exec(command);
  if (!match) return null;
  const page = match[1];
  if (page === 'current lead' || page === 'this lead') {
    return { path: /^[a-z\d_-][a-z\d_.:-]{0,255}$/i.test(leadId) ? `/leads/${encodeURIComponent(leadId)}` : null };
  }
  const path = pages.get(page);
  return path ? { path } : null;
}
