import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const bridge = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const netlifyConfig = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const publicAvaFunction = readFileSync(resolve(root, 'netlify/functions/public-ava-chat.ts'), 'utf8');
const documentsPdfFunction = readFileSync(resolve(root, 'netlify/functions/documents-pdf.ts'), 'utf8');
const bridgeProxyFunction = readFileSync(resolve(root, 'netlify/functions/pbk-bridge-proxy.ts'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');
const reactApp = readFileSync(resolve(root, 'src/app/App.tsx'), 'utf8');
const commandCenter = readFileSync(resolve(root, 'src/app/routes/CommandCenter.tsx'), 'utf8');
const agentFleet = readFileSync(resolve(root, 'src/app/routes/AgentFleet.tsx'), 'utf8');
const callModeTab = readFileSync(resolve(root, 'src/app/components/CallModeTab.tsx'), 'utf8');
const liveCallWidget = readFileSync(resolve(root, 'src/app/components/shell/LiveCallWidget.tsx'), 'utf8');
const pathDeliverables = readFileSync(resolve(root, 'src/app/components/PathDeliverables.tsx'), 'utf8');
const openclawDockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');
const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const fail = [];
const warn = [];
const staticMarkup = index
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');

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

const mysteryIconPatterns = [
  {
    label: 'question-mark icon prefix',
    regex: />\s*\?\s+(?:Agent|Best|Slack|Recommended|Use|Unknown|Waterfall|AI|Risk|Smart|Trigger|Action|Condition|Inspector|Topics|Bookmarks|A\+|Research|Revenue|Recent|Market|Today|Because|Property|Motivation|Compliance|Sentiment|Deal|Ava|Step|Quick|Navigate|Leads)\b/g,
  },
  {
    label: 'question-mark arrow or trend marker',
    regex: /(?:Sort:\s*Score|Score|Verbal yes|CSV drop|Ava hears yes|Request approval|Reporting|Call recap|Sentiment|Apr\s+\d+)\s\?/g,
  },
  {
    label: 'broken keyboard glyph',
    regex: /<kbd>\?K|<span class="kb">\?K|<kbd>\?\?|<kbd>\?<\/kbd>/g,
  },
  {
    label: 'dynamic reading why prefix',
    regex: /\? \$\{escapeHtml\(item\.why/g,
    scanAll: true,
  },
  {
    label: 'typing cursor question mark',
    regex: /content:\s*'\?'/g,
    scanAll: true,
  },
];

const mysteryIconMatches = mysteryIconPatterns.flatMap(({ label, regex, scanAll = false }) => {
  const source = scanAll ? index : staticMarkup;
  const matches = [...source.matchAll(regex)].slice(0, 8);
  return matches.map((match) => `${label}: ${match[0].slice(0, 120)}`);
});
if (mysteryIconMatches.length) {
  fail.push({
    name: 'Command Center visible copy must not render mystery question-mark icons',
    details: mysteryIconMatches,
  });
}

if (/Why:\s*\$\{escapeHtml\(item\.why/.test(index) || /Why:\s+Because/i.test(staticMarkup)) {
  fail.push({
    name: 'Brain suggested reading should use human-friendly why labels',
    details: ['Suggested reading should render as "Why: active calls..." instead of "Why: Because active calls...".'],
  });
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
    .replace(/:([A-Za-z0-9_]+)/g, '[^/]+');
  return new RegExp(`^${escaped}(?:[/?#]|$)`);
}

const cleanAppPaths = new Set([
  '/',
  '/dashboard',
  '/command-center',
  '/inbox',
  '/leads',
  '/pipeline',
  '/deals',
  '/deals/analyzer',
  '/analyzer',
  '/agents',
  '/agent',
  '/agent-console',
  '/fleet',
  '/calls',
  '/live-calls',
  '/contracts',
  '/automations',
  '/analytics',
  '/campaigns',
  '/campaign-detail',
  '/brain',
  '/research',
  '/memory',
  '/integrations',
  '/settings',
  '/lead-detail',
  '/activity-log',
  '/recordings',
]);

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
    .filter((path) => !cleanAppPaths.has(path))
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

const netlifyApiProxyIndex = netlifyConfig.lastIndexOf('from = "/api/*"');
const netlifyBrainCleanIndex = netlifyConfig.lastIndexOf('from = "/brain"');
const netlifyBrainProxyIndex = netlifyConfig.lastIndexOf('from = "/brain/*"');
const netlifySpaFallbackIndex = netlifyConfig.lastIndexOf('from = "/*"');
const netlifySpaFallbackBlock = netlifySpaFallbackIndex >= 0 ? netlifyConfig.slice(netlifySpaFallbackIndex) : '';
const netlifySpaFallbackConfigured = /from\s*=\s*"\/\*"/.test(netlifySpaFallbackBlock)
  && /to\s*=\s*"\/index\.shell\.html"/.test(netlifySpaFallbackBlock)
  && /status\s*=\s*200/.test(netlifySpaFallbackBlock);
const netlifyBrainCleanRouteOrdered = netlifyBrainCleanIndex >= 0
  && netlifyBrainProxyIndex >= 0
  && netlifyBrainCleanIndex < netlifyBrainProxyIndex
  && /from\s*=\s*"\/brain"[\s\S]*?to\s*=\s*"\/index\.html"[\s\S]*?status\s*=\s*200/.test(netlifyConfig.slice(netlifyBrainCleanIndex, netlifyBrainProxyIndex));
const netlifySpaFallbackOrdered = netlifySpaFallbackConfigured
  && netlifyApiProxyIndex >= 0
  && netlifySpaFallbackIndex > netlifyApiProxyIndex;
if (!netlifySpaFallbackOrdered || !netlifyBrainCleanRouteOrdered) {
  fail.push({
    name: 'Netlify SPA fallback must protect direct Command Center links after API rewrites',
    details: [
      ...(!netlifySpaFallbackOrdered ? ['netlify.toml needs from="/*" -> /index.shell.html after /api/* so shared clean URLs render the modern app without stealing API calls.'] : []),
      ...(!netlifyBrainCleanRouteOrdered ? ['netlify.toml needs exact from="/brain" -> /index.html before /brain/* proxy so the Brain page is not treated as a protected API call.'] : []),
    ],
  });
}

const netlifyShellRouteIndex = netlifyConfig.lastIndexOf('from = "/index.shell.html/*"');
const netlifyShellRouteBlock = netlifyShellRouteIndex >= 0 ? netlifyConfig.slice(netlifyShellRouteIndex) : '';
const netlifyModernShellRouted = /from\s*=\s*"\/index\.shell\.html\/\*"/.test(netlifyShellRouteBlock)
  && /to\s*=\s*"\/index\.shell\.html"/.test(netlifyShellRouteBlock)
  && /status\s*=\s*200/.test(netlifyShellRouteBlock)
  && /force\s*=\s*true/.test(netlifyShellRouteBlock)
  && netlifyShellRouteIndex >= 0
  && (netlifyApiProxyIndex < 0 || netlifyShellRouteIndex < netlifyApiProxyIndex);
if (!netlifyModernShellRouted) {
  fail.push({
    name: 'Netlify production must serve modern shell preview routes',
    details: ['Add a forced /index.shell.html/* -> /index.shell.html rewrite before API and SPA fallback rewrites so deep links render the modern React shell instead of the legacy dashboard.'],
  });
}

const requiredArchitectureRoutes = [
  { label: '/api/analyzeDeal', path: '/api/analyzeDeal' },
  { label: '/api/approvals/:id/approve', path: '/api/approvals/approval-smoke/approve' },
  { label: '/api/approvals/:id/deny', path: '/api/approvals/approval-smoke/deny' },
  { label: '/api/contracts/draft', path: '/api/contracts/draft' },
  { label: '/api/contracts/:id/send', path: '/api/contracts/contract-smoke/send' },
  { label: '/api/contracts/:id/remind', path: '/api/contracts/contract-smoke/remind' },
  { label: '/api/contracts/:id/void', path: '/api/contracts/contract-smoke/void' },
  { label: '/api/contracts/:id/pdf', path: '/api/contracts/contract-smoke/pdf' },
];
const missingArchitectureRoutes = requiredArchitectureRoutes
  .filter(({ path }) => !routeMatchers.some(({ regex }) => regex.test(path)))
  .map(({ label }) => label);
if (missingArchitectureRoutes.length) {
  fail.push({
    name: 'Documented production control routes must exist on the bridge',
    details: missingArchitectureRoutes,
  });
}

const requiredNetlifyFunctionRoutes = [
  {
    label: '/api/public/ava-chat -> public-ava-chat function',
    path: '/api/public/ava-chat',
    functionSource: publicAvaFunction,
    functionName: 'public-ava-chat',
  },
  {
    label: '/api/documents/pdf -> documents-pdf function',
    path: '/api/documents/pdf',
    functionSource: documentsPdfFunction,
    functionName: 'documents-pdf',
  },
];
const missingNetlifyFunctionRoutes = requiredNetlifyFunctionRoutes.filter(({ path, functionSource, functionName }) => {
  const hasClassicHandler = /export\s+const\s+handler/.test(functionSource);
  const declaresConfigPath =
    /export\s+default\s+async/.test(functionSource) &&
    /export\s+const\s+config/.test(functionSource) &&
    new RegExp(`path\\s*:\\s*["']${path.replace(/\//g, '\\/')}["']`).test(functionSource);
  const redirectFrom = new RegExp(`from\\s*=\\s*["']${path.replace(/\//g, '\\/')}["']`).test(netlifyConfig);
  const redirectTo = new RegExp(`to\\s*=\\s*["']\\/\\.netlify\\/functions\\/${functionName}["']`).test(netlifyConfig);
  return !(declaresConfigPath || (hasClassicHandler && redirectFrom && redirectTo));
}).map(({ label }) => label);
if (missingNetlifyFunctionRoutes.length) {
  fail.push({
    name: 'Netlify same-origin API paths must route to deployed functions',
    details: missingNetlifyFunctionRoutes,
  });
}

const requiredBridgeProxyRoutes = [
  '/health',
  '/status',
  '/state',
  '/events',
  '/invoke',
  '/metrics',
  '/brain/*',
  '/api/*',
];
const missingBridgeProxyRoutes = requiredBridgeProxyRoutes.filter((path) => {
  const escaped = path.replace(/\*/g, '\\*').replace(/\//g, '\\/');
  const redirectFrom = new RegExp(`from\\s*=\\s*["']${escaped}["']`).test(netlifyConfig);
  const redirectTo = /to\s*=\s*["']\/\.netlify\/functions\/pbk-bridge-proxy\?path=/.test(netlifyConfig);
  return !redirectFrom || !redirectTo;
});
const bridgeProxyUnsafe = !/export\s+const\s+handler/.test(bridgeProxyFunction)
  || !/authorization/.test(bridgeProxyFunction)
  || !/X-PBK-Team-Token/i.test(bridgeProxyFunction)
  || !/PBK_BRIDGE_URL/.test(bridgeProxyFunction)
  || !/isBase64Encoded/.test(bridgeProxyFunction);
if (missingBridgeProxyRoutes.length || bridgeProxyUnsafe) {
  fail.push({
    name: 'Netlify hosted bridge proxy must cover operational routes and forward auth safely',
    details: [
      ...missingBridgeProxyRoutes,
      ...(bridgeProxyUnsafe ? ['pbk-bridge-proxy.ts missing handler/auth/team/binary forwarding contract'] : []),
    ],
  });
}

if (!/host\.includes\('pbkcommandcenter'\) \|\| host\.endsWith\('\.netlify\.app'\)/.test(index)
  || !/PBK hosted bridge proxy is preconfigured through Netlify/.test(index)
  || !/currentHost\.includes\('pbkcommandcenter'\) \|\| currentHost\.endsWith\('\.netlify\.app'\)/.test(index)
  || !/HOSTED_OPENCLAW_ENDPOINT/.test(index)
  || !/shouldRetryOpenClawViaHosted/.test(index)
  || !/buildHostedOpenClawFallbackUrl/.test(index)
  || !/usage_exceeded/i.test(index)
  || !/\[404,\s*405,\s*500,\s*502,\s*503,\s*504\]/.test(index)) {
  fail.push({
    name: 'Netlify production shell must survive hosted function exhaustion',
    details: ['index.html must default Netlify hosts to window.location.origin, keep bridge-key auth, and retry direct Render when Netlify returns usage_exceeded or proxy route/function failures.'],
  });
}

const approvalActionStart = index.indexOf('async function handleApprovalAction');
const approvalActionEnd = index.indexOf('function getPageNode', approvalActionStart);
const approvalActionBody = approvalActionStart >= 0 && approvalActionEnd > approvalActionStart
  ? index.slice(approvalActionStart, approvalActionEnd)
  : '';
if (!approvalActionBody
  || /teamAuthRequired\s*:\s*true/.test(approvalActionBody)
  || /await\s+ensureTeamAccess/.test(approvalActionBody)
  || !/actor:\s*teamSession\?\.role === 'team' \? 'PBK team dashboard' : 'PBK founder dashboard'/.test(approvalActionBody)) {
  fail.push({
    name: 'Founder Approval Board clicks must use saved bridge-key authority without forcing team-only restrictions',
    details: ['handleApprovalAction should not set teamAuthRequired=true or require a team passcode before every founder approval click.'],
  });
}

if (!/data-mobile-mode-card/.test(index)
  || !/data-mobile-mode-opt/.test(index)
  || !/mobileModeOpts\.forEach\(opt =>/.test(index)
  || !/aria-pressed/.test(index)
  || !/bindModeControl\(opt,\s*\(\)\s*=>\s*setMode\(opt\.dataset\.mode\)\)/.test(index)) {
  fail.push({
    name: 'Mobile operators must be able to switch Auto, Approval, and Manual modes',
    details: ['Mobile should move the mode picker into a dashboard home card, keep the top bar clear, and keep the controls keyboard/tap accessible.'],
  });
}

if (!approvalActionBody
  || !/canAttemptLiveOpenClawWrite\(approvalPath,\s*'PUT'\)/.test(approvalActionBody)
  || !/markApprovalCardDecisionAccepted\(card,\s*action\)/.test(approvalActionBody)
  || !/board refresh is retrying in the background/i.test(approvalActionBody)) {
  fail.push({
    name: 'Founder approval writes must not be reported failed after PBK Brain accepts them',
    details: ['handleApprovalAction should attempt live writes when a bridge key exists and separate the decision write from the follow-up board refresh.'],
  });
}

const adminTaskDecisionStart = index.indexOf('async function updateAdminTaskDecision');
const adminTaskDecisionEnd = index.indexOf('async function handleAdminTaskAction', adminTaskDecisionStart);
const adminTaskDecisionBody = adminTaskDecisionStart >= 0 && adminTaskDecisionEnd > adminTaskDecisionStart
  ? index.slice(adminTaskDecisionStart, adminTaskDecisionEnd)
  : '';
if (!adminTaskDecisionBody || !/requestOpenClawApi\(`\/api\/admin\/tasks/.test(adminTaskDecisionBody)) {
  fail.push({
    name: 'Founder admin task clicks must use the resilient bridge request helper',
    details: ['updateAdminTaskDecision should use requestOpenClawApi so Netlify proxy failures fall back to the hosted Render bridge and JSON errors surface clearly.'],
  });
}

const runtimeBridgeFallbackMissing = !/pbk:\$\{getStorageEnvironment\(\)\}:openclaw-config/.test(runtimeBridge)
  || !/shouldRetryRuntimeViaHosted/.test(runtimeBridge)
  || !/buildHostedRuntimeFallbackUrl/.test(runtimeBridge)
  || !/usage_exceeded/i.test(runtimeBridge);
if (runtimeBridgeFallbackMissing) {
  fail.push({
    name: 'React runtime bridge must share production config and Netlify exhaustion fallback',
    details: ['runtimeBridge.ts must read the namespaced Command Center config and retry direct Render when same-origin Netlify functions are exhausted.'],
  });
}

const mutationSuccessGuardMissing =
  !/function assertBridgeMutationSucceeded/.test(runtimeBridge) ||
  !/provider_missing\|safety_blocked/.test(runtimeBridge) ||
  !/return assertBridgeMutationSucceeded\(response, 'Offer email send'\)/.test(runtimeBridge) ||
  !/return assertBridgeMutationSucceeded\(response, 'Seller document send'\)/.test(runtimeBridge) ||
  !/return assertBridgeMutationSucceeded\(response, 'Lead contract send'\)/.test(runtimeBridge) ||
  !/return assertBridgeMutationSucceeded\(response, 'Approval decision'\)/.test(runtimeBridge) ||
  !/return assertBridgeMutationSucceeded\(response, 'Admin task decision'\)/.test(runtimeBridge);
if (mutationSuccessGuardMissing) {
  fail.push({
    name: 'Deal-critical mutation wrappers must reject false-success bridge JSON',
    details: [
      'Seller-facing sends and approval/admin decisions should throw on ok:false, provider_missing, safety_blocked, rejected, or missing proof results even when HTTP returned 200.',
    ],
  });
}

const sellerDocIdentityMissing =
  !/fetchSenderIdentitiesRequest/.test(pathDeliverables) ||
  !/SenderIdentitySelect/.test(pathDeliverables) ||
  !/senderIdentityId:\s*senderIdentityId \|\| undefined/.test(pathDeliverables) ||
  !/documentSet:\s*editableDocuments/.test(pathDeliverables) ||
  !/sellerEmail[\s\S]{0,240}includes\('@'\)/.test(reactApp) ||
  !/sendSellerDocsRequest\(\{[\s\S]*senderIdentityId:\s*senderIdentityId\?\.trim\(\) \|\| undefined/.test(reactApp) ||
  !/documentSet:\s*documentSet \|\| generatedDocuments/.test(reactApp) ||
  !/response\?\.senderIdentity/.test(reactApp) ||
  !/const senderIdentityId = String\(params\.senderIdentityId/.test(bridge) ||
  !/store\.getSenderIdentity\(senderIdentityId/.test(bridge) ||
  !/senderIdentity\.channel !== 'email'/.test(bridge) ||
  !/rankEligibleSenderIdentities\(\[senderIdentity\]\)/.test(bridge);
if (sellerDocIdentityMissing) {
  fail.push({
    name: 'Seller document email must use a validated connected sender identity',
    details: [
      'PathDeliverables should load email sender identities, pass senderIdentityId with the PDF email request, and the bridge should validate the selected identity before using it as From.',
    ],
  });
}

const analyzerLeadSyncMissing =
  !/const leadId = String\(deal\.leadId/.test(runtimeBridge) ||
  !/Create or sync this lead before sending analyzer context to Ava or CRM/.test(runtimeBridge) ||
  !/leadId,\s*\n\s*lead_id:\s*leadId/.test(runtimeBridge);
if (analyzerLeadSyncMissing) {
  fail.push({
    name: 'Analyzer agent sync must preserve the canonical lead id',
    details: [
      'sendDealToAgent should send only a canonical leadId/lead_id and fail before falling back to address or contact fields.',
    ],
  });
}

const canonicalLeadActionGateMissing =
  !/getLeadOptionKey/.test(agentFleet) ||
  !/selectedLeadCanonicalId/.test(agentFleet) ||
  !/Lead sync required/.test(agentFleet) ||
  !/function getDealLeadId\(deal: DealData\) \{[\s\S]*deal\.leadId/.test(callModeTab) ||
  !/Create or sync this lead before/.test(callModeTab);
if (canonicalLeadActionGateMissing) {
  fail.push({
    name: 'Deal-making actions must require canonical bridge lead ids',
    details: [
      'Agent Fleet and Call Mode should not use phone/address/manual strings as lead ids for QA, calls, notes, email, appointments, or CRM writes.',
    ],
  });
}

const approvalDecisionLockMissing =
  !/pendingAction\.startsWith\(`approval:\$\{approvalId\}:`\)/.test(commandCenter) ||
  !/isApprovalDecisionPending\(String\(approval\.id\)\)/.test(commandCenter) ||
  !/getApprovalSecondaryStatus\(approval\)/.test(commandCenter);
if (approvalDecisionLockMissing) {
  fail.push({
    name: 'Approval buttons must lock the whole approval while a decision is pending',
    details: [
      'Approve/Decline/Needs Revision should not allow duplicate or conflicting bridge decisions for the same approval id.',
    ],
  });
}

const adminDecisionLockMissing =
  !/pendingAction\.startsWith\(`admin:\$\{taskId\}:`\)/.test(commandCenter) ||
  !/isAdminDecisionPending\(String\(task\.id\)\)/.test(commandCenter);
if (adminDecisionLockMissing) {
  fail.push({
    name: 'Admin approval buttons must lock the whole admin task while pending',
    details: [
      'Admin approve/decline should disable together and guard execution while a bridge decision is already in flight.',
    ],
  });
}

const liveCallControlGateMissing =
  !/hasBridgeCallId/.test(liveCallWidget) ||
  !/canControlCall/.test(liveCallWidget) ||
  !/Waiting for bridge call id/.test(liveCallWidget);
if (liveCallControlGateMissing) {
  fail.push({
    name: 'Live call controls must require a bridge call id',
    details: [
      'Take Over, Mute, and End must stay disabled until the runtime has a real bridge call id.',
    ],
  });
}

const agentFleetCallGateMissing =
  !/CALLING_AGENT_IDS/.test(agentFleet) ||
  !/activeAgentCanCall/.test(agentFleet) ||
  !/Only Ava, Max, and Nurture Agent can initiate seller calls/.test(agentFleet);
if (agentFleetCallGateMissing) {
  fail.push({
    name: 'Agent Fleet call controls must be limited to calling-capable agents',
    details: [
      'Research, QA, Hermes, script, BANT, call-analysis, and prosody lanes should not initiate Telnyx calls as themselves.',
    ],
  });
}

const renderAppFallbackPaths = [
  '/app',
  '/dashboard',
  '/settings',
  '/leads',
  '/contracts',
  '/campaigns',
  '/brain',
  '/approvals',
];
const renderFallbackPublicPathsMissing = renderAppFallbackPaths
  .filter((publicPath) => !new RegExp(`['"]${publicPath.replace(/\//g, '\\/')}['"]`).test(bridge));
const renderFallbackServerMissing = !/COMMAND_CENTER_APP_PATHS/.test(bridge)
  || !/maybeServeRenderCommandCenter/.test(bridge)
  || !/sendPublicStaticFile/.test(bridge)
  || !/path\.join\(ROOT_DIR,\s*['"]index\.html['"]\)/.test(bridge)
  || !/path\.join\(ROOT_DIR,\s*['"]public['"],\s*['"]ava-chat-widget\.js['"]\)/.test(bridge);
const renderFallbackDockerMissing = !/COPY\s+index\.html\s+\.\/index\.html/.test(openclawDockerfile)
  || !/COPY\s+analyzer\.html\s+\.\/analyzer\.html/.test(openclawDockerfile)
  || !/COPY\s+public\s+\.\/public/.test(openclawDockerfile);
const renderFallbackDockerignoreMissing = !/^!index\.html$/m.test(dockerignore)
  || !/^!analyzer\.html$/m.test(dockerignore)
  || !/^!public$/m.test(dockerignore)
  || !/^!public\/\*\*$/m.test(dockerignore);
if (renderFallbackPublicPathsMissing.length || renderFallbackServerMissing || renderFallbackDockerMissing || renderFallbackDockerignoreMissing) {
  fail.push({
    name: 'Render-hosted Command Center fallback must survive Netlify site outages',
    details: [
      ...renderFallbackPublicPathsMissing.map((publicPath) => `Bridge public path missing for ${publicPath}.`),
      ...(renderFallbackServerMissing ? ['openclaw-local-server.mjs must serve index.html/static public assets on clean app routes without changing /health.'] : []),
      ...(renderFallbackDockerMissing ? ['Dockerfile.openclaw must copy index.html, analyzer.html, and public/ into the hosted bridge image.'] : []),
      ...(renderFallbackDockerignoreMissing ? ['.dockerignore must explicitly unignore index.html, analyzer.html, and public/** for the Render fallback image.'] : []),
    ],
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

const requiredCleanPathAliases = [
  { path: '/settings', page: 'settings' },
  { path: '/leads', page: 'leads' },
  { path: '/deals/analyzer', page: 'analyzer' },
  { path: '/contracts', page: 'contracts' },
  { path: '/campaigns', page: 'campaigns' },
  { path: '/brain', page: 'brain' },
  { path: '/calls', page: 'calls' },
  { path: '/integrations', page: 'integrations' },
];
const missingCleanPathAliases = requiredCleanPathAliases.filter(({ path, page }) => {
  const escapedPath = path.replace(/\//g, '\\/');
  return !new RegExp(`['"]${escapedPath}['"]\\s*:\\s*['"]${page}['"]`).test(index);
}).map(({ path, page }) => `${path} -> ${page}`);
const cleanPathRouterMissing = !/const\s+cleanPagePathAliases\s*=/.test(index)
  || !/function\s+getInitialPageFromLocation/.test(index)
  || !/cleanPagePathAliases\[normalizeAppPath\(\)\]/.test(index)
  || !/const\s+initialPage\s*=\s*getInitialPageFromLocation\(\)/.test(index);
if (missingCleanPathAliases.length || cleanPathRouterMissing) {
  fail.push({
    name: 'Direct Netlify clean paths must open the matching Command Center page',
    details: [
      ...missingCleanPathAliases,
      ...(cleanPathRouterMissing ? ['index.html missing clean path startup router contract'] : []),
    ],
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
      name: 'Netlify same-origin API paths route to functions',
      ok: missingNetlifyFunctionRoutes.length === 0,
      count: requiredNetlifyFunctionRoutes.length,
    },
    {
      name: 'Netlify function exhaustion falls back to direct Render',
      ok: !runtimeBridgeFallbackMissing,
      count: 2,
    },
    {
      name: 'Seller document email uses validated sender identity',
      ok: !sellerDocIdentityMissing,
      count: 1,
    },
    {
      name: 'Deal-making controls avoid false success and identity drift',
      ok:
        !analyzerLeadSyncMissing &&
        !approvalDecisionLockMissing &&
        !adminDecisionLockMissing &&
        !liveCallControlGateMissing &&
        !agentFleetCallGateMissing,
      count: 5,
    },
    {
      name: 'Netlify direct app links fall back to the SPA shell',
      ok: netlifySpaFallbackOrdered && netlifyBrainCleanRouteOrdered,
      count: [netlifySpaFallbackConfigured, netlifyBrainCleanRouteOrdered].filter(Boolean).length,
    },
    {
      name: 'Page navigation targets exist',
      ok: missingPages.length === 0 && missingShowPageTargets.length === 0,
      count: navPages.length,
    },
    {
      name: 'Direct Netlify clean paths open matching pages',
      ok: missingCleanPathAliases.length === 0 && !cleanPathRouterMissing,
      count: requiredCleanPathAliases.length,
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
