import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const fail = [];
const warn = [];

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function stripTags(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttrs(attrText = '') {
  const attrs = {};
  const attrRegex = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match = null;
  while ((match = attrRegex.exec(attrText))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

function camelDataName(name = '') {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function bridgeRoutes() {
  const routes = new Set(['/health', '/status', '/state', '/events', '/invoke', '/metrics']);
  const literalRegexes = [
    /pathname\s*===\s*['"]([^'"]+)['"]/g,
    /matchPath\(pathname,\s*['"]([^'"]+)['"]\)/g,
  ];
  for (const regex of literalRegexes) {
    let match = null;
    while ((match = regex.exec(bridge))) routes.add(match[1]);
  }
  const matchesPathRegex = /matchesPath\(pathname,\s*\[([\s\S]*?)\]\)/g;
  let arrayMatch = null;
  while ((arrayMatch = matchesPathRegex.exec(bridge))) {
    const literalRegex = /['"]([^'"]+)['"]/g;
    let literal = null;
    while ((literal = literalRegex.exec(arrayMatch[1]))) routes.add(literal[1]);
  }
  return unique([...routes]);
}

function routeToRegex(route = '') {
  const escaped = route
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\:([A-Za-z0-9_]+)/g, '[^/]+');
  return new RegExp(`^${escaped}(?:[/?#]|$)`);
}

function extractRequestedPaths() {
  const paths = new Set();
  const literalPathRegex = /['"`]((?:\/api|\/brain|\/events|\/invoke|\/state|\/metrics)[^'"`\s)]*)['"`]/g;
  let match = null;
  while ((match = literalPathRegex.exec(index))) {
    paths.add(match[1].replace(/\?.*$/, ''));
  }
  const templatePathRegex = /`\$\{[^}]+\}((?:\/api|\/brain|\/events|\/invoke|\/state|\/metrics)[^`?$]*)/g;
  while ((match = templatePathRegex.exec(index))) {
    paths.add(match[1].replace(/\?.*$/, ''));
  }
  return unique([...paths])
    .filter((path) => !path.includes('${'))
    .filter((path) => !path.includes('function'))
    .filter((path) => !path.endsWith('/'));
}

const routes = bridgeRoutes();
const routeMatchers = routes.map((route) => ({ route, regex: routeToRegex(route) }));
const requestedPaths = extractRequestedPaths();
const missingRoutes = requestedPaths.filter((path) => !routeMatchers.some(({ regex }) => regex.test(path)));
if (missingRoutes.length) {
  fail.push({
    name: 'Frontend API requests must map to bridge routes',
    details: missingRoutes.slice(0, 40),
  });
}

const pageContainers = unique([...index.matchAll(/class=["'][^"']*\bpage\b[^"']*["'][^>]*data-page=["']([^"']+)["']/g)].map((match) => match[1]));
const navPages = unique([...index.matchAll(/data-page=["']([^"']+)["']/g)].map((match) => match[1]))
  .filter((page) => !page.includes('${'));
const missingPages = navPages.filter((page) => !pageContainers.includes(page));
if (missingPages.length) {
  fail.push({
    name: 'Every data-page navigation target must have a page container',
    details: missingPages,
  });
}

const showPageTargets = unique([...index.matchAll(/showPage\(['"]([^'"]+)['"]/g)].map((match) => match[1]));
const missingShowPageTargets = showPageTargets.filter((page) => !pageContainers.includes(page));
if (missingShowPageTargets.length) {
  fail.push({
    name: 'Every showPage target must have a page container',
    details: missingShowPageTargets,
  });
}

const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
const buttons = [];
let buttonMatch = null;
while ((buttonMatch = buttonRegex.exec(index))) {
  const attrs = parseAttrs(buttonMatch[1]);
  const text = stripTags(buttonMatch[2]);
  buttons.push({ attrs, text, raw: buttonMatch[0] });
}

const namelessButtons = buttons
  .filter(({ attrs, text }) => !text && !attrs['aria-label'] && !attrs.title && !attrs['data-tooltip'])
  .map(({ attrs, raw }) => ({
    class: attrs.class || '',
    data: Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => `${key}=${value}`).join(' '),
    sample: raw.slice(0, 160).replace(/\s+/g, ' '),
  }));
if (namelessButtons.length) {
  fail.push({
    name: 'Buttons must have visible text or accessible labels',
    details: namelessButtons.slice(0, 40),
  });
}

const actionLikeDataAttrs = unique([
  ...index.matchAll(/\b(data-[a-z0-9-]*(?:action|filter|toggle|open|close|delete|remove|archive|approve|reject|send|call|sms|email|route|nav|page|tab|modal|select|view|status|search|sort|refresh|drill|sync|load|save)[a-z0-9-]*)=/gi),
].map((match) => match[1]));

const ignoredDataAttrs = new Set([
  'data-page',
  'data-action',
  'data-nav',
]);

const unreferencedDataAttrs = actionLikeDataAttrs.filter((attr) => {
  if (ignoredDataAttrs.has(attr)) return false;
  const camel = camelDataName(attr);
  const refPatterns = [
    `[${attr}`,
    `closest('[${attr}`,
    `closest("[${attr}`,
    `querySelector('[${attr}`,
    `querySelector("[${attr}`,
    `querySelectorAll('[${attr}`,
    `querySelectorAll("[${attr}`,
    `getAttribute('${attr}')`,
    `getAttribute("${attr}")`,
    `dataset.${camel}`,
  ];
  return !refPatterns.some((pattern) => index.includes(pattern));
});
if (unreferencedDataAttrs.length) {
  fail.push({
    name: 'Action/filter data attributes must be referenced by JS handlers',
    details: unreferencedDataAttrs,
  });
}

const dataActionValues = unique([...index.matchAll(/data-action=["']([^"']+)["']/g)].map((match) => match[1]));
const commandPaletteActions = unique([...index.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g)].map((match) => match[1]));
const dataActionsMissingHandler = dataActionValues.filter((action) => {
  const directPatterns = [
    `data.action === '${action}'`,
    `data.action === "${action}"`,
    `action === '${action}'`,
    `action === "${action}"`,
    `a === '${action}'`,
    `a === "${action}"`,
    `case '${action}'`,
    `case "${action}"`,
    `[data-action="${action}"]`,
    `[data-action='${action}']`,
  ];
  return !commandPaletteActions.includes(action) && !directPatterns.some((pattern) => index.includes(pattern));
});
if (dataActionsMissingHandler.length) {
  fail.push({
    name: 'data-action values must be handled',
    details: dataActionsMissingHandler,
  });
}

const leadBulkSelectionSafe = /function\s+getSelectedLeadRows\(\)[\s\S]*?return\s+selected;/.test(index)
  && !/return\s+selected\.length\s*\?\s*selected\s*:\s*getLeadRows\(\)\.slice\(0,\s*3\)/.test(index)
  && /toggleLeadRowCheckbox/.test(index)
  && /checkbox\.classList\.toggle\('checked'\)/.test(index);
if (!leadBulkSelectionSafe) {
  fail.push({
    name: 'Lead bulk actions must require explicit selected rows',
    details: ['No silent first-3 fallback, and delegated live-row checkbox toggling must exist.'],
  });
}

const offlineDecisionQueueSafe = /queueDisconnectedAction/.test(index)
  && /data-pending-offline-action/.test(index)
  && /flushDisconnectedActionQueue/.test(index)
  && !/Approval removed locally/.test(index)
  && !/Admin approval removed locally/.test(index);
if (!offlineDecisionQueueSafe) {
  fail.push({
    name: 'Offline approval/admin actions must queue instead of disappearing locally',
    details: ['Disconnected decisions should stay visible and be queued for replay.'],
  });
}

const liveCallControlsGuarded = /function\s+hasValidLiveCallContext/.test(index)
  && /No live call selected/.test(index)
  && /if\s*\(!hasValidLiveCallContext\(context,\s*normalized\)\)\s*return\s+null;/.test(index);
if (!liveCallControlsGuarded) {
  fail.push({
    name: 'Live call controls must require a real call id or phone',
    details: ['Dashboard controls must not post call-control or DNC events for placeholder context.'],
  });
}

const comprehensiveLeadFiltersWired = /const\s+leadListFilters\s*=/.test(index)
  && /function\s+applyLeadListFilters/.test(index)
  && /function\s+updateLeadFilterCopy/.test(index)
  && /data-leads-search/.test(index)
  && /data-lead-filter="score"/.test(index)
  && /data-lead-filter="status"/.test(index)
  && /data-lead-filter="tag"/.test(index)
  && /data-lead-filter="equity"/.test(index)
  && /data-lead-filter="assigned"/.test(index)
  && /data-lead-filter="leadType"/.test(index)
  && /data-lead-filter="propertyType"/.test(index)
  && /applyLeadListFilters\(getRuntimeLeads\(snapshot\)\)/.test(index)
  && /leadListFilters\.search/.test(index);
if (!comprehensiveLeadFiltersWired) {
  fail.push({
    name: 'Leads toolbar filters must execute against the rendered lead list',
    details: ['Score, status, tag, equity, assigned, lead type, property type, and search must filter live rows instead of only showing preview toasts.'],
  });
}

const agentFleetNoDemoFallback = /function\s+sanitizeFleetAgentForProduction/.test(index)
  && /function\s+isSeededFleetExample/.test(index)
  && /No live agents loaded/.test(index)
  && !/return\s+FLEET_AGENT_SEED\s*;/.test(index)
  && !/On call with Diane Kowalski/.test(index);
if (!agentFleetNoDemoFallback) {
  fail.push({
    name: 'Agent Fleet must not render old static/demo agents as production state',
    details: ['When no runtime agents are available, show an honest empty/connection state instead of fake Ava/Rex call examples.'],
  });
}

const destructiveButtonLabels = buttons
  .filter(({ text, attrs }) => /\b(delete|void|send|call|sms|email|approve|reject|archive|remove|run|deploy|purchase|restart)\b/i.test(text || attrs['aria-label'] || ''))
  .map(({ text, attrs }) => ({
    label: text || attrs['aria-label'] || '',
    action: attrs['data-action'] || attrs['data-contract-action'] || attrs['data-lead-row-action'] || attrs['data-recording-delete'] || '',
    hasTypeButton: attrs.type === 'button',
  }));
const destructiveWithoutType = destructiveButtonLabels.filter((button) => !button.hasTypeButton);
if (destructiveWithoutType.length) {
  warn.push({
    name: 'Destructive/provider buttons should declare type="button"',
    details: destructiveWithoutType.slice(0, 30),
  });
}

const requiredScripts = ['test:live-data-audit', 'test:bridge', 'test:founder'];
const missingScripts = requiredScripts.filter((script) => !pkg.scripts?.[script]);
if (missingScripts.length) {
  fail.push({
    name: 'Required production audit scripts must exist',
    details: missingScripts,
  });
}

const report = {
  ok: fail.length === 0,
  checkedAt: new Date().toISOString(),
  summary: {
    buttons: buttons.length,
    pageContainers: pageContainers.length,
    navTargets: navPages.length,
    requestedPaths: requestedPaths.length,
    bridgeRoutes: routes.length,
    actionLikeDataAttrs: actionLikeDataAttrs.length,
  },
  checks: [
    {
      name: 'Frontend API requests map to bridge routes',
      ok: missingRoutes.length === 0,
      count: requestedPaths.length,
    },
    {
      name: 'Page navigation targets exist',
      ok: missingPages.length === 0 && missingShowPageTargets.length === 0,
      count: navPages.length,
    },
    {
      name: 'Buttons are accessible',
      ok: namelessButtons.length === 0,
      count: buttons.length,
    },
    {
      name: 'Action/filter data attributes are wired',
      ok: unreferencedDataAttrs.length === 0 && dataActionsMissingHandler.length === 0,
      count: actionLikeDataAttrs.length,
    },
  ],
  failures: fail,
  warnings: warn,
};

console.log(JSON.stringify(report, null, 2));
if (fail.length) process.exitCode = 1;
