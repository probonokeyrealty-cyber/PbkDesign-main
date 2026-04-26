import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const IS_RESET = process.argv.includes('--reset');
const IS_LAN = process.argv.includes('--lan');
const IS_PUBLIC = process.argv.includes('--public');
const IS_HOSTED =
  IS_PUBLIC ||
  Boolean(process.env.RENDER) ||
  Boolean(process.env.FLY_APP_NAME) ||
  process.env.NODE_ENV === 'production';

const STATE_DIR_ENV = String(process.env.PBK_OPENCLAW_STATE_DIR || '').trim();
const RUNTIME_DIR = STATE_DIR_ENV
  ? path.isAbsolute(STATE_DIR_ENV)
    ? STATE_DIR_ENV
    : path.resolve(ROOT_DIR, STATE_DIR_ENV)
  : path.join(ROOT_DIR, '.pbk-local');
const STATE_FILE = path.join(RUNTIME_DIR, 'openclaw-state.json');

const HOST =
  process.env.PBK_OPENCLAW_HOST ||
  process.env.HOST ||
  (IS_HOSTED || IS_LAN ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PBK_OPENCLAW_PORT || process.env.PORT || 8788);

const APPROVAL_WEBHOOK_URL = String(process.env.PBK_N8N_APPROVAL_WEBHOOK || '').trim();
const LEAD_WEBHOOK_URL = String(process.env.PBK_N8N_LEAD_WEBHOOK || '').trim();

const SHOULD_RESET = IS_RESET;

const TOOL_NAMES = [
  'analyzeDeal',
  'createApproval',
  'updateCRM',
  'ingestResearchDoc',
  'getBrainState',
  'checkDNC',
  'telnyx_call',
  'telnyx_sms',
  'sendDocuSign',
  'sendContract',
  'skipTrace',
  'detectYelling',
  'slackNotify',
  'runAgentCommand',
];

const LIMITS = {
  approvals: 60,
  activity: 160,
  brainDocs: 90,
  leadImports: 90,
  analyzerRuns: 90,
  dncEntries: 120,
  calls: 90,
  messages: 140,
  contracts: 90,
};

function isoNow() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimArray(items = [], limit = 25) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

function hashString(value = '') {
  let hash = 0;
  const normalized = String(value || 'pbk').trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) % 2147483647;
  }
  return Math.abs(hash || 1);
}

function jsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

function getItemTimestamp(item = {}) {
  return (
    item.updatedAt ||
    item.actedAt ||
    item.completedAt ||
    item.startedAt ||
    item.createdAt ||
    item.at ||
    item.addedAt ||
    ''
  );
}

function sortNewest(items = []) {
  return [...items].sort((left, right) => String(getItemTimestamp(right)).localeCompare(String(getItemTimestamp(left))));
}

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(toNumber(value, 0));
}

function averagePrices(deal = {}) {
  const prices = ['A', 'B', 'C']
    .map((key) => toNumber(deal?.comps?.[key]?.price, 0))
    .filter((value) => value > 0);
  if (!prices.length) return 0;
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

function buildToolUsageSeed() {
  return Object.fromEntries(TOOL_NAMES.map((toolName) => [toolName, 0]));
}

function makeActivity({
  actor = 'System',
  category = 'INFO',
  status = 'success',
  text = '',
  target = '',
  at = isoNow(),
}) {
  return {
    id: randomUUID(),
    at,
    actor,
    category,
    status,
    text,
    target,
  };
}

function buildDefaultBrainDocs() {
  return [
    {
      id: 'brain-70-rule',
      kind: 'pdf',
      topic: 'Wholesaling',
      title: 'The 70% Rule: When to Break It and When to Obey It',
      source: 'PBK memo',
      excerpt:
        'Use the 70% rule as a speed filter, not as theology. Thin-comp markets need stronger downside protection and narrative-based comp review.',
      summary:
        'Use the 70% rule as a speed filter. In thin-comp markets, protect the downside with stronger repair buffers and better comp notes.',
      citation: 'PBK memo - 12 pages',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      tags: ['Wholesaling', 'Analyzer', 'MAO'],
    },
    {
      id: 'brain-probate-2026',
      kind: 'article',
      topic: 'Probate',
      title: 'Why Probate Is Still a Great Lead Source',
      source: 'REtipster',
      excerpt:
        'Executor fatigue, equity, and urgency still combine into one of the highest-signal direct-to-seller profiles.',
      summary:
        'Probate leads remain high-signal when outreach is empathetic and executor authority is confirmed before price talk.',
      citation: 'REtipster - 8 min read',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      tags: ['Probate', 'Wholesaling', 'Negotiation'],
    },
    {
      id: 'brain-subto-case',
      kind: 'case',
      topic: 'Subject-To',
      title: '$47k Assignment Fee on a Subject-To Deal',
      source: 'PBK case file',
      excerpt:
        'A 3.2% mortgage stayed in place, the buyer stepped into the payments, and the seller got relief without listing.',
      summary:
        'Use subject-to when the debt is attractive, the seller wants speed, and the buyer can absorb payment risk with clear disclosure.',
      citation: 'PBK case CF-0412',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      tags: ['Subject-To', 'Creative Finance', 'Case Study'],
    },
    {
      id: 'brain-tcpa-consent',
      kind: 'legal',
      topic: 'Legal & TCPA',
      title: 'TCPA One-to-One Consent for Wholesalers',
      source: 'FCC.gov',
      excerpt:
        'Each lead form must name your company specifically. Shared blanket consent no longer protects AI-led telemarketing.',
      summary:
        'Keep one-to-one consent language on every lead form, store consent timestamps, and start every AI call with clear disclosure.',
      citation: 'FCC ruling summary',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      tags: ['Compliance', 'Legal & TCPA', 'Voice'],
    },
    {
      id: 'brain-akron-notes',
      kind: 'note',
      topic: 'Market Reports',
      title: "Jordan's notes: Akron vs Columbus seller psychology",
      source: 'Voice memo',
      excerpt:
        'Akron responds to urgency and burden removal. Columbus responds better to empathy and clean-process language.',
      summary:
        'Route scripts by sub-market. Akron can take firmer anchors sooner. Columbus needs more relationship framing first.',
      citation: 'Voice memo - Apr 10',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
      tags: ['Negotiation', 'Market Reports', 'Wholesaling'],
    },
  ];
}

function buildDefaultActivity() {
  return [
    makeActivity({
      actor: 'Ava',
      category: 'APPROVAL',
      status: 'pending',
      text: 'Requested approval for $78,000 offer - MAO $91,500',
      target: 'Diane Kowalski - 202 Cherry Ln',
      at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    }),
    makeActivity({
      actor: 'System',
      category: 'ANALYZE',
      status: 'success',
      text: 'Analyzer ran - ARV $185k - repairs $38k - MAO $91,500',
      target: '202 Cherry Ln',
      at: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    }),
    makeActivity({
      actor: 'n8n',
      category: 'IMPORT',
      status: 'complete',
      text: 'Lead intake flow normalized 47 fresh probate rows',
      target: 'daily_probate_import.csv',
      at: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    }),
    makeActivity({
      actor: 'Rex',
      category: 'RESEARCH',
      status: 'indexed',
      text: 'Indexed 3 new sources and updated negotiation guidance',
      target: 'Brain library',
      at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    }),
  ];
}

function buildDefaultApprovals() {
  return [
    {
      id: 'approval-offer-202-cherry',
      type: 'offer',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      offerPrice: 78000,
      mao: 91500,
      notes: 'Quick-close empathy anchor after probate rapport.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    },
    {
      id: 'approval-contract-robert-chen',
      type: 'contract',
      leadId: 'lead-robert-chen',
      leadName: 'Robert Chen',
      address: '55 Birch Rd, Columbus OH',
      offerPrice: 98500,
      mao: 112000,
      notes: 'Send DocuSign at verbal yes price.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString(),
    },
    {
      id: 'approval-batch-akron',
      type: 'outbound',
      leadId: 'batch-akron-probate-20260425',
      leadName: 'Akron Probate Batch',
      address: 'Akron list',
      offerPrice: 0,
      mao: 0,
      notes: 'Start outbound campaign on 47 fresh probate leads using approval-first mode.',
      status: 'pending',
      createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    },
  ];
}

function buildDefaultAnalyzerRuns() {
  return [
    {
      id: 'run-cherry-ln',
      leadId: 'lead-diane-kowalski',
      address: '202 Cherry Ln, Columbus OH',
      arv: 185000,
      repairsMid: 38000,
      mao: 91500,
      targetOffer: 78000,
      estProfit: 13500,
      status: 'complete',
      createdAt: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
    },
  ];
}

function buildDefaultLeadImports() {
  return [
    {
      id: 'leadimport-daily-probate',
      leadId: 'lead-diane-kowalski',
      source: 'daily_probate_import.csv',
      seller: {
        name: 'Diane Kowalski',
        phone: '+1 (614) 555-0142',
      },
      property: {
        address: '202 Cherry Ln, Columbus OH',
      },
      tags: ['probate', 'high-equity', 'ohio'],
      createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    },
  ];
}

function buildDefaultDncEntries() {
  return [
    {
      id: 'dnc-2165550401',
      phone: '+12165550401',
      name: 'Manual DNC',
      reason: 'Yelling detected and explicit stop request.',
      source: 'auto-detect',
      addedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    },
    {
      id: 'dnc-4405550622',
      phone: '+14405550622',
      name: 'SMS STOP',
      reason: 'Requested removal via SMS STOP.',
      source: 'sms',
      addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
    {
      id: 'dnc-6145550914',
      phone: '+16145550914',
      name: 'Manual add',
      reason: 'Prior client requested no more calls.',
      source: 'manual',
      addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    },
  ];
}

function buildDefaultCalls() {
  return [
    {
      id: 'call-diane-live',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      phone: '+16145550142',
      direction: 'outbound',
      status: 'live',
      assistantId: 'ava-acquisition-v3',
      script: 'grief-aware, repair-anchored',
      sentiment: 0.72,
      yellRisk: 0.04,
      startedAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 45).toISOString(),
      transcript: [
        { speaker: 'AI', text: 'I am so sorry for your loss. I know that is a lot to carry.' },
        { speaker: 'Seller', text: 'Honestly I just want this house gone.' },
      ],
    },
    {
      id: 'call-john-live',
      leadId: 'lead-john-smith',
      leadName: 'John Smith',
      address: '123 Main St, Akron OH',
      phone: '+13305550119',
      direction: 'outbound',
      status: 'live',
      assistantId: 'ava-acquisition-v3',
      script: 'firm comps and close speed',
      sentiment: 0.55,
      yellRisk: 0.08,
      startedAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 30).toISOString(),
      transcript: [
        { speaker: 'AI', text: 'I hear you on the $150k, but that is a stretch for us with repairs.' },
      ],
    },
  ];
}

function buildDefaultMessages() {
  return [
    {
      id: 'sms-diane-1',
      leadId: 'lead-diane-kowalski',
      leadName: 'Diane Kowalski',
      address: '202 Cherry Ln, Columbus OH',
      phone: '+16145550142',
      direction: 'inbound',
      channel: 'sms',
      body: 'Can you call me after 5pm tomorrow? Working a double shift today.',
      status: 'received',
      createdAt: new Date(Date.now() - 1000 * 60 * 70).toISOString(),
    },
  ];
}

function buildDefaultContracts() {
  return [
    {
      id: 'contract-robert-chen',
      leadId: 'lead-robert-chen',
      leadName: 'Robert Chen',
      address: '55 Birch Rd, Columbus OH',
      email: 'robert@example.com',
      amount: 98500,
      status: 'sent',
      provider: 'DocuSign',
      envelopeId: 'env-robert-4821',
      createdAt: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
    },
  ];
}

function buildDefaultState() {
  return {
    status: {
      agent: 'pbk-local-openclaw',
      mode: 'approval',
      connectedAt: isoNow(),
      lastUpdatedAt: isoNow(),
      queryCountToday: 42,
      sourcesIndexed: 247,
      weeklySources: 47,
      scriptUpdates7d: 8,
      brainSizeMb: 18.4,
      tokenCount: '3.2M',
      marketPulse: [
        { source: 'Redfin', age: '8m', title: 'Columbus median DOM fell to 18 days.' },
        { source: 'FRED', age: '1h', title: '30-year fixed at 6.42%; seller financing still attractive.' },
        { source: 'ATTOM', age: '3h', title: 'Ohio foreclosure starts up 11% QoQ.' },
        { source: 'FCC', age: '1d', title: 'No new TCPA changes this week.' },
      ],
      suggestedReading: [
        {
          why: 'Because Diane K. is live right now',
          title: 'Handling grief-bereaved sellers without sounding predatory - 4 min',
        },
        {
          why: 'Because probate leads are queued',
          title: 'Ohio probate executor authority checklist - 2026',
        },
        {
          why: 'Because repair costs shifted',
          title: 'Updating your repair ballpark by quarter - 5 min',
        },
      ],
      topics: {
        Wholesaling: 82,
        'Creative Finance': 47,
        'Cash Deals': 34,
        'Subject-To': 18,
        'Seller Financing': 22,
        Novation: 9,
        'Legal & TCPA': 28,
        'Market Reports': 41,
        Negotiation: 31,
        Probate: 19,
      },
      tools: [...TOOL_NAMES],
      toolUsage: buildToolUsageSeed(),
      n8n: {
        approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
        leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
      },
    },
    approvals: buildDefaultApprovals(),
    activity: buildDefaultActivity(),
    brainDocs: buildDefaultBrainDocs(),
    leadImports: buildDefaultLeadImports(),
    analyzerRuns: buildDefaultAnalyzerRuns(),
    dncEntries: buildDefaultDncEntries(),
    calls: buildDefaultCalls(),
    messages: buildDefaultMessages(),
    contracts: buildDefaultContracts(),
  };
}

async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}

async function persistState(nextState) {
  nextState.status.lastUpdatedAt = isoNow();
  updateDerivedStatus(nextState);
  await ensureRuntimeDir();
  await writeFile(STATE_FILE, jsonStringify(nextState), 'utf8');
}

function limitStateArrays(nextState) {
  nextState.approvals = sortNewest(nextState.approvals).slice(0, LIMITS.approvals);
  nextState.activity = sortNewest(nextState.activity).slice(0, LIMITS.activity);
  nextState.brainDocs = sortNewest(nextState.brainDocs).slice(0, LIMITS.brainDocs);
  nextState.leadImports = sortNewest(nextState.leadImports).slice(0, LIMITS.leadImports);
  nextState.analyzerRuns = sortNewest(nextState.analyzerRuns).slice(0, LIMITS.analyzerRuns);
  nextState.dncEntries = sortNewest(nextState.dncEntries).slice(0, LIMITS.dncEntries);
  nextState.calls = sortNewest(nextState.calls).slice(0, LIMITS.calls);
  nextState.messages = sortNewest(nextState.messages).slice(0, LIMITS.messages);
  nextState.contracts = sortNewest(nextState.contracts).slice(0, LIMITS.contracts);
}

function updateDerivedStatus(nextState) {
  nextState.status.sourcesIndexed = nextState.brainDocs.length;
  nextState.status.pendingApprovals = nextState.approvals.filter((approval) => approval.status === 'pending').length;
  nextState.status.activeCalls = nextState.calls.filter((call) => call.status === 'live').length;
  nextState.status.dncCount = nextState.dncEntries.length;
  nextState.status.contractsOpen = nextState.contracts.filter((contract) => !['completed', 'void', 'rejected'].includes(String(contract.status || '').toLowerCase())).length;
  nextState.status.lastApprovalAt = nextState.approvals[0]?.createdAt || null;
  nextState.status.lastImportAt = nextState.leadImports[0]?.createdAt || null;
  nextState.status.lastAnalyzerAt = nextState.analyzerRuns[0]?.createdAt || null;
  nextState.status.lastCallAt = getItemTimestamp(nextState.calls[0] || {}) || null;
  nextState.status.lastMessageAt = getItemTimestamp(nextState.messages[0] || {}) || null;
  nextState.status.lastContractAt = getItemTimestamp(nextState.contracts[0] || {}) || null;
  nextState.status.tools = [...TOOL_NAMES];
  nextState.status.toolUsage = {
    ...buildToolUsageSeed(),
    ...(nextState.status.toolUsage || {}),
  };
  nextState.status.n8n = {
    approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
    leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
  };
}

function hydrateState(raw = {}) {
  const defaults = buildDefaultState();
  const hydrated = {
    ...defaults,
    ...raw,
    status: {
      ...defaults.status,
      ...(raw.status || {}),
      toolUsage: {
        ...defaults.status.toolUsage,
        ...(raw.status?.toolUsage || {}),
      },
    },
    approvals: trimArray(raw.approvals || defaults.approvals, LIMITS.approvals),
    activity: trimArray(raw.activity || defaults.activity, LIMITS.activity),
    brainDocs: trimArray(raw.brainDocs || defaults.brainDocs, LIMITS.brainDocs),
    leadImports: trimArray(raw.leadImports || defaults.leadImports, LIMITS.leadImports),
    analyzerRuns: trimArray(raw.analyzerRuns || defaults.analyzerRuns, LIMITS.analyzerRuns),
    dncEntries: trimArray(raw.dncEntries || defaults.dncEntries, LIMITS.dncEntries),
    calls: trimArray(raw.calls || defaults.calls, LIMITS.calls),
    messages: trimArray(raw.messages || defaults.messages, LIMITS.messages),
    contracts: trimArray(raw.contracts || defaults.contracts, LIMITS.contracts),
  };
  limitStateArrays(hydrated);
  updateDerivedStatus(hydrated);
  return hydrated;
}

async function loadState() {
  await ensureRuntimeDir();
  if (SHOULD_RESET) {
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }

  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return hydrateState(JSON.parse(raw));
  } catch {
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }
}

function recordToolUse(toolName) {
  state.status.toolUsage[toolName] = toNumber(state.status.toolUsage[toolName], 0) + 1;
}

function addActivity(stateRef, entry) {
  stateRef.activity.unshift(entry);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addApproval(stateRef, approval) {
  stateRef.approvals.unshift(approval);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addBrainDoc(stateRef, doc) {
  stateRef.brainDocs.unshift(doc);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addLeadImport(stateRef, leadImport) {
  stateRef.leadImports.unshift(leadImport);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addAnalyzerRun(stateRef, run) {
  stateRef.analyzerRuns.unshift(run);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function addDncEntry(stateRef, entry) {
  stateRef.dncEntries.unshift(entry);
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertCall(stateRef, call) {
  const existingIndex = stateRef.calls.findIndex((item) => item.id === call.id);
  if (existingIndex >= 0) {
    stateRef.calls.splice(existingIndex, 1, { ...stateRef.calls[existingIndex], ...call, updatedAt: isoNow() });
  } else {
    stateRef.calls.unshift(call);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertMessage(stateRef, message) {
  const existingIndex = stateRef.messages.findIndex((item) => item.id === message.id);
  if (existingIndex >= 0) {
    stateRef.messages.splice(existingIndex, 1, { ...stateRef.messages[existingIndex], ...message });
  } else {
    stateRef.messages.unshift(message);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function upsertContract(stateRef, contract) {
  const existingIndex = stateRef.contracts.findIndex((item) => item.id === contract.id);
  if (existingIndex >= 0) {
    stateRef.contracts.splice(existingIndex, 1, { ...stateRef.contracts[existingIndex], ...contract, updatedAt: isoNow() });
  } else {
    stateRef.contracts.unshift(contract);
  }
  limitStateArrays(stateRef);
  updateDerivedStatus(stateRef);
}

function findLeadContext(params = {}) {
  const fallbackImport = state.leadImports[0] || {};
  const fallbackApproval = state.approvals[0] || {};
  const fallbackCall = state.calls.find((call) => call.status === 'live') || state.calls[0] || {};
  const fallback = {
    leadId: fallbackApproval.leadId || fallbackImport.leadId || fallbackCall.leadId || randomUUID(),
    leadName:
      params.leadName ||
      params.name ||
      fallbackApproval.leadName ||
      fallbackImport?.seller?.name ||
      fallbackCall.leadName ||
      'Unknown seller',
    address:
      params.address ||
      fallbackApproval.address ||
      fallbackImport?.property?.address ||
      fallbackCall.address ||
      'Unknown property',
    phone:
      normalizePhone(params.phone || params.to || params.number) ||
      normalizePhone(fallbackCall.phone) ||
      normalizePhone(fallbackImport?.seller?.phone) ||
      '',
    email: params.email || fallbackImport?.seller?.email || '',
  };
  return fallback;
}

function buildAnalyzerSummary(params = {}) {
  const deal = params.deal || {};
  const address = params.address || deal.address || 'Unknown address';
  const seed = hashString(address);
  const fallbackArv = Math.round((120000 + (seed % 150000)) / 5000) * 5000;
  const fallbackRepairs = Math.round((16000 + (seed % 42000)) / 500) * 500;
  const arv = toNumber(params.arv, 0) || toNumber(deal.arv, 0) || averagePrices(deal) || fallbackArv;
  const repairsMid = toNumber(params.repairsMid, 0) || toNumber(deal?.repairs?.mid, 0) || fallbackRepairs;
  const fee = toNumber(params.fee, 0) || toNumber(deal.fee, 9000) || 9000;
  const mao =
    toNumber(params.mao, 0) ||
    toNumber(deal.mao60, 0) ||
    Math.max(0, Math.round((arv - repairsMid) * 0.68 - fee));
  const targetOffer =
    toNumber(params.offerPrice, 0) ||
    toNumber(deal.offer, 0) ||
    toNumber(deal.agreedPrice, 0) ||
    Math.max(0, Math.round(mao * 0.85));
  const estProfit = Math.max(0, mao - targetOffer);

  return {
    id: params.id || `run-${slugify(address) || randomUUID()}`,
    leadId: params.leadId || deal.leadId || '',
    address,
    arv,
    repairsMid,
    mao,
    targetOffer,
    estProfit,
    status: 'complete',
    createdAt: isoNow(),
  };
}

function scoreBrainDocMatch(doc, query) {
  const haystack = [
    doc.title,
    doc.excerpt,
    doc.summary,
    doc.topic,
    ...(doc.tags || []),
  ]
    .join(' ')
    .toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function answerBrainQuery(stateRef, query = '') {
  const trimmed = String(query || '').trim();
  const matches = stateRef.brainDocs
    .map((doc) => ({
      ...doc,
      score: scoreBrainDocMatch(doc, trimmed || doc.title),
    }))
    .filter((doc) => doc.score > 0 || !trimmed)
    .sort((left, right) => right.score - left.score || String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 3);

  const top = matches[0];
  const answer = top
    ? `Best match: ${top.title}. ${top.summary}`
    : 'No direct match yet. Ingest a new source or try a narrower query like "probate Ohio" or "subject-to".';

  return {
    query: trimmed,
    answer,
    matches: matches.map(({ score, ...doc }) => doc),
    citations: matches.map((doc) => doc.citation || `${doc.source} - ${doc.title}`),
  };
}

function normalizeLeadIntake(payload = {}) {
  const createdAt = payload.createdAt || isoNow();
  return {
    id: payload.id || randomUUID(),
    leadId: payload.leadId || payload.id || randomUUID(),
    source: payload.source || 'manual',
    seller: {
      name: payload?.seller?.name || payload.name || 'Unknown seller',
      phone: payload?.seller?.phone || payload.phone || '',
      email: payload?.seller?.email || payload.email || '',
    },
    property: {
      address: payload?.property?.address || payload.address || '',
      city: payload?.property?.city || payload.city || '',
      state: payload?.property?.state || payload.state || '',
    },
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    createdAt,
  };
}

function buildDncEntry(payload = {}) {
  return {
    id: payload.id || `dnc-${slugify(normalizePhone(payload.phone || payload.number || randomUUID()))}`,
    phone: normalizePhone(payload.phone || payload.number || ''),
    name: payload.name || payload.leadName || '',
    reason: payload.reason || 'Manual DNC add',
    source: payload.source || 'manual',
    addedAt: payload.addedAt || isoNow(),
  };
}

function inferSkipTraceContact(params = {}) {
  const context = findLeadContext(params);
  const seed = hashString(context.address || context.leadName || randomUUID());
  const phone = context.phone || `+1${String(2000000000 + (seed % 7000000000)).slice(0, 10)}`;
  const emailName = slugify(context.leadName || 'seller') || 'seller';
  return {
    leadId: context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone,
    email: `${emailName}@skiptrace.pbk.local`,
    confidence: 0.82,
  };
}

function createCallRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `call-${slugify(context.leadName || context.address || randomUUID())}-${Date.now()}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone: normalizePhone(params.phone || params.to || context.phone),
    direction: params.direction || 'outbound',
    status: params.status || 'live',
    assistantId: params.assistantId || 'ava-acquisition-v3',
    script: params.script || params.notes || '',
    sentiment: toNumber(params.sentiment, 0.66),
    yellRisk: toNumber(params.yellRisk, 0.05),
    humanJoined: Boolean(params.humanJoined),
    aiMuted: Boolean(params.aiMuted),
    startedAt: params.startedAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
    transcript: Array.isArray(params.transcript) ? params.transcript : [],
  };
}

function createMessageRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `msg-${Date.now()}-${slugify(context.leadName || 'lead')}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    phone: normalizePhone(params.phone || params.to || context.phone),
    email: params.email || context.email || '',
    channel: params.channel || 'sms',
    direction: params.direction || 'outbound',
    body: String(params.body || params.message || '').trim(),
    status: params.status || (params.direction === 'inbound' ? 'received' : 'sent'),
    createdAt: params.createdAt || isoNow(),
  };
}

function createContractRecord(params = {}) {
  const context = findLeadContext(params);
  return {
    id: params.id || `contract-${slugify(context.leadName || context.address || randomUUID())}`,
    leadId: params.leadId || context.leadId,
    leadName: context.leadName,
    address: context.address,
    email: params.email || context.email || '',
    amount: toNumber(params.amount || params.offerPrice, 0),
    status: params.status || 'sent',
    provider: params.provider || 'DocuSign',
    envelopeId: params.envelopeId || `env-${slugify(context.leadName || 'lead')}-${Date.now()}`,
    notes: params.notes || '',
    createdAt: params.createdAt || isoNow(),
    updatedAt: params.updatedAt || isoNow(),
  };
}

function findDncEntryByPhone(phone = '') {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return state.dncEntries.find((entry) => normalizePhone(entry.phone) === normalized) || null;
}

async function fireWebhook(url, payload) {
  if (!url) return { ok: false, skipped: true };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Webhook request failed',
    };
  }
}

let state = await loadState();

const toolHandlers = {
  async analyzeDeal(params = {}) {
    recordToolUse('analyzeDeal');
    const run = buildAnalyzerSummary(params);
    addAnalyzerRun(state, run);
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'ANALYZE',
        status: 'success',
        text: `Analyzer ran - ARV ${currency(run.arv)} - MAO ${currency(run.mao)} - target ${currency(run.targetOffer)}`,
        target: run.address,
      }),
    );
    await persistState(state);
    return run;
  },

  async createApproval(params = {}) {
    recordToolUse('createApproval');
    const approval = {
      id: params.id || randomUUID(),
      type: params.type || 'offer',
      leadId: params.leadId || randomUUID(),
      leadName: params.leadName || params.name || 'Unknown seller',
      address: params.address || 'Unknown property',
      offerPrice: toNumber(params.offerPrice, 0),
      mao: toNumber(params.mao, 0),
      notes: params.notes || '',
      status: 'pending',
      createdAt: params.createdAt || isoNow(),
    };

    addApproval(state, approval);
    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'APPROVAL',
        status: 'pending',
        text: `Queued ${approval.type} approval${approval.offerPrice ? ` for ${currency(approval.offerPrice)}` : ''}`,
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    const fanout = await fireWebhook(APPROVAL_WEBHOOK_URL, approval);
    if (fanout.ok) {
      addActivity(
        state,
        makeActivity({
          actor: 'n8n',
          category: 'APPROVAL',
          status: 'queued',
          text: `Approval request ready for ${approval.leadName} at ${approval.address}`,
          target: approval.id,
        }),
      );
      await persistState(state);
    }
    return { approval, fanout };
  },

  async updateCRM(params = {}) {
    recordToolUse('updateCRM');
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'CRM',
        status: 'queued',
        text: params.message || 'CRM sync requested from OpenClaw bridge.',
        target: params.target || params.leadId || 'crm',
      }),
    );
    await persistState(state);
    return {
      ok: true,
      updatedAt: isoNow(),
      target: params.target || params.leadId || 'crm',
    };
  },

  async ingestResearchDoc(params = {}) {
    recordToolUse('ingestResearchDoc');
    const doc = {
      id: params.id || randomUUID(),
      kind: params.kind || 'note',
      topic: params.topic || 'Wholesaling',
      title: params.title || 'Untitled source',
      source: params.source || 'Manual ingest',
      excerpt: params.excerpt || params.summary || 'No excerpt provided.',
      summary: params.summary || params.excerpt || 'No summary provided.',
      citation: params.citation || `${params.source || 'Manual ingest'} - ${new Date().toLocaleDateString()}`,
      createdAt: isoNow(),
      tags: Array.isArray(params.tags) ? params.tags : [params.topic || 'Wholesaling'],
    };

    addBrainDoc(state, doc);
    addActivity(
      state,
      makeActivity({
        actor: 'Rex',
        category: 'RESEARCH',
        status: 'indexed',
        text: `Indexed new ${doc.kind} source: ${doc.title}`,
        target: doc.topic,
      }),
    );
    state.status.weeklySources = toNumber(state.status.weeklySources, 0) + 1;
    await persistState(state);
    return { ok: true, doc };
  },

  async getBrainState(params = {}) {
    recordToolUse('getBrainState');
    const response = answerBrainQuery(state, params.query || '');
    state.status.queryCountToday = toNumber(state.status.queryCountToday, 0) + 1;
    addActivity(
      state,
      makeActivity({
        actor: 'Rex',
        category: 'QUERY',
        status: 'served',
        text: params.query ? `Answered research query: "${params.query}"` : 'Returned current Brain state',
        target: 'Brain',
      }),
    );
    await persistState(state);
    return {
      ...response,
      brainDocs: state.brainDocs.slice(0, 8),
      status: state.status,
    };
  },

  async checkDNC(params = {}) {
    recordToolUse('checkDNC');
    const phone = normalizePhone(params.phone || params.to || params.number || '');
    const match = findDncEntryByPhone(phone);
    addActivity(
      state,
      makeActivity({
        actor: 'Guardrail',
        category: 'DNC',
        status: match ? 'blocked' : 'safe',
        text: match
          ? `Blocked outbound contact to ${phone || 'unknown number'}`
          : `DNC check clear for ${phone || 'unknown number'}`,
        target: params.leadName || params.address || phone || 'DNC',
      }),
    );
    await persistState(state);
    return {
      ok: !match,
      phone,
      blocked: Boolean(match),
      reason: match?.reason || '',
      match,
    };
  },

  async telnyx_call(params = {}) {
    recordToolUse('telnyx_call');
    const context = findLeadContext(params);
    const phone = normalizePhone(params.phone || params.to || context.phone);
    const dnc = findDncEntryByPhone(phone);

    if (dnc) {
      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: `Blocked call to ${context.leadName} because the number is on DNC`,
          target: phone || context.address,
        }),
      );
      await persistState(state);
      return {
        ok: false,
        blocked: true,
        reason: dnc.reason,
        dnc,
      };
    }

    const call = createCallRecord({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      phone,
      status: 'live',
    });

    upsertCall(state, call);
    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'CALL',
        status: 'live',
        text: `Outbound call started to ${context.leadName}`,
        target: context.address || phone,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      call,
    };
  },

  async telnyx_sms(params = {}) {
    recordToolUse('telnyx_sms');
    const context = findLeadContext(params);
    const direction = params.direction || 'outbound';
    const phone = normalizePhone(params.phone || params.to || context.phone);
    const dnc = direction === 'outbound' ? findDncEntryByPhone(phone) : null;

    if (dnc) {
      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: `Blocked SMS to ${context.leadName} because the number is on DNC`,
          target: phone || context.address,
        }),
      );
      await persistState(state);
      return {
        ok: false,
        blocked: true,
        reason: dnc.reason,
        dnc,
      };
    }

    const message = createMessageRecord({
      ...params,
      leadId: context.leadId,
      leadName: context.leadName,
      address: context.address,
      phone,
      direction,
    });
    upsertMessage(state, message);
    addActivity(
      state,
      makeActivity({
        actor: direction === 'inbound' ? context.leadName || 'Seller' : 'Ava',
        category: 'SMS',
        status: direction === 'inbound' ? 'received' : 'sent',
        text: `${direction === 'inbound' ? 'Inbound' : 'Outbound'} SMS: ${message.body || '(empty message)'}`,
        target: context.address || phone,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      message,
    };
  },

  async sendDocuSign(params = {}) {
    recordToolUse('sendDocuSign');
    const contract = createContractRecord(params);
    upsertContract(state, contract);
    addActivity(
      state,
      makeActivity({
        actor: 'DocuSign',
        category: 'CONTRACT',
        status: contract.status,
        text: `Sent contract to ${contract.leadName}${contract.amount ? ` for ${currency(contract.amount)}` : ''}`,
        target: contract.address,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      contract,
    };
  },

  async sendContract(params = {}) {
    recordToolUse('sendContract');
    return toolHandlers.sendDocuSign(params);
  },

  async skipTrace(params = {}) {
    recordToolUse('skipTrace');
    const contact = inferSkipTraceContact(params);
    addActivity(
      state,
      makeActivity({
        actor: 'BatchData',
        category: 'SKIPTRACE',
        status: 'complete',
        text: `Skip trace found ${contact.phone}${contact.email ? ` and ${contact.email}` : ''}`,
        target: contact.address || contact.leadName,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      contact,
    };
  },

  async detectYelling(params = {}) {
    recordToolUse('detectYelling');
    const transcript = String(params.transcript || params.text || '').trim();
    const normalized = transcript.toLowerCase();
    const explicitStop =
      normalized.includes('stop calling') ||
      normalized.includes('do not call') ||
      normalized.includes('leave me alone') ||
      normalized.includes('take me off');
    const angryWords = ['idiot', 'sue', 'lawsuit', 'angry', 'yell', 'scream', 'mad', 'furious'];
    const angryHits = angryWords.reduce((count, token) => count + (normalized.includes(token) ? 1 : 0), 0);
    const uppercaseHits = (transcript.match(/[A-Z]{4,}/g) || []).length;
    const score = Math.max(
      toNumber(params.score, 0),
      explicitStop ? 0.95 : 0,
      angryHits ? Math.min(0.4 + angryHits * 0.14, 0.92) : 0,
      uppercaseHits ? Math.min(0.35 + uppercaseHits * 0.12, 0.78) : 0,
    );
    const detected = score >= 0.6;

    let dncEntry = null;
    if (detected) {
      dncEntry = buildDncEntry({
        phone: params.phone || params.to || params.number,
        name: params.leadName || params.name,
        reason: explicitStop
          ? 'Seller requested removal during live conversation.'
          : 'Raised-voice / hostility detected during live conversation.',
        source: explicitStop ? 'call-opt-out' : 'anger-detection',
      });

      if (dncEntry.phone && !findDncEntryByPhone(dncEntry.phone)) {
        addDncEntry(state, dncEntry);
      }

      addActivity(
        state,
        makeActivity({
          actor: 'Guardrail',
          category: 'DNC',
          status: 'blocked',
          text: explicitStop
            ? 'Seller opted out during live conversation. Number added to DNC.'
            : 'Raised voice detected. Apology flow triggered and number added to DNC.',
          target: params.address || params.leadName || dncEntry.phone,
        }),
      );
    }

    await persistState(state);
    return {
      ok: true,
      detected,
      score,
      explicitStop,
      dncEntry,
    };
  },

  async slackNotify(params = {}) {
    recordToolUse('slackNotify');
    addActivity(
      state,
      makeActivity({
        actor: 'Slack',
        category: 'NOTIFY',
        status: 'sent',
        text: params.text || params.message || 'Slack notification sent from PBK bridge.',
        target: params.channel || '#deals',
      }),
    );
    await persistState(state);
    return {
      ok: true,
      channel: params.channel || '#deals',
      sentAt: isoNow(),
    };
  },

  async runAgentCommand(params = {}) {
    recordToolUse('runAgentCommand');
    const command = String(params.command || params.text || '').trim();
    const context = findLeadContext(params);
    const lower = command.toLowerCase();

    addActivity(
      state,
      makeActivity({
        actor: 'Jordan',
        category: 'COMMAND',
        status: 'received',
        text: command ? `Command sent to Ava: ${command}` : 'Blank command received.',
        target: context.leadName || 'Agent console',
      }),
    );

    let routedTo = 'updateCRM';
    let response = null;

    if (lower.includes('contract') || lower.includes('docusign') || lower.includes('docu sign')) {
      routedTo = 'sendDocuSign';
      response = await toolHandlers.sendDocuSign({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        amount: toNumber(params.amount || params.offerPrice, 98500),
        notes: command,
      });
    } else if (lower.includes('text') || lower.includes('sms')) {
      routedTo = 'telnyx_sms';
      response = await toolHandlers.telnyx_sms({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        body:
          params.body ||
          `Hi ${context.leadName.split(' ')[0] || 'there'}, this is Ava with PBK. Wanted to follow up on ${context.address}.`,
      });
    } else if (lower.includes('call') || lower.includes('dial')) {
      routedTo = 'telnyx_call';
      response = await toolHandlers.telnyx_call({
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        phone: context.phone,
        script: command,
      });
    } else if (lower.includes('analy') || lower.includes('mao') || lower.includes('arv')) {
      routedTo = 'analyzeDeal';
      response = await toolHandlers.analyzeDeal({
        leadId: context.leadId,
        address: context.address,
        deal: params.deal || {},
      });
    } else if (lower.includes('approval')) {
      routedTo = 'createApproval';
      response = await toolHandlers.createApproval({
        type: params.type || 'offer',
        leadId: context.leadId,
        leadName: context.leadName,
        address: context.address,
        offerPrice: toNumber(params.offerPrice, 78000),
        mao: toNumber(params.mao, 91500),
        notes: command,
      });
    } else {
      response = await toolHandlers.updateCRM({
        message: `Ava logged command: ${command || 'No command text provided.'}`,
        target: context.address || context.leadName,
      });
    }

    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'DECISION',
        status: 'queued',
        text: `Ava routed the command to ${routedTo}.`,
        target: context.address || context.leadName,
      }),
    );

    await persistState(state);
    return {
      ok: true,
      command,
      routedTo,
      response,
    };
  },
};

async function handleEvent(eventType, payload = {}) {
  const normalizedEvent = String(eventType || '').trim().toLowerCase();

  if (normalizedEvent === 'lead-intake' || normalizedEvent === 'lead-import') {
    const fromN8nLeadIntake = payload?._source === 'n8n-lead-intake';

    if (LEAD_WEBHOOK_URL && !fromN8nLeadIntake) {
      addActivity(
        state,
        makeActivity({
          actor: 'System',
          category: 'IMPORT',
          status: 'queued',
          text: `Forwarded lead intake to n8n from ${payload.source || 'manual bridge event'}`,
          target: payload?.seller?.name || payload.name || payload.address || 'lead intake',
        }),
      );
      await persistState(state);
      const fanout = await fireWebhook(LEAD_WEBHOOK_URL, {
        ...payload,
        _source: payload?._source || 'openclaw-bridge',
      });
      return {
        ok: true,
        forwarded: true,
        fanout,
      };
    }

    const leadImport = normalizeLeadIntake(payload);
    const dedupeKey = `${slugify(leadImport.property.address)}::${normalizePhone(leadImport.seller.phone)}`;
    const duplicate = state.leadImports.find((item) => {
      const itemKey = `${slugify(item?.property?.address || '')}::${normalizePhone(item?.seller?.phone || '')}`;
      return item.leadId === leadImport.leadId || itemKey === dedupeKey;
    });

    if (!duplicate) {
      addLeadImport(state, leadImport);
    }

    addActivity(
      state,
      makeActivity({
        actor: 'n8n',
        category: 'IMPORT',
        status: duplicate ? 'updated' : 'complete',
        text: `${duplicate ? 'Lead refreshed' : 'Lead intake normalized'} from ${leadImport.source}`,
        target: leadImport.seller.name,
      }),
    );

    let queuedAnalyzer = null;
    if (leadImport.property.address) {
      queuedAnalyzer = {
        id: randomUUID(),
        leadId: leadImport.leadId,
        address: leadImport.property.address,
        arv: 0,
        repairsMid: 0,
        mao: 0,
        targetOffer: 0,
        estProfit: 0,
        status: 'queued',
        createdAt: isoNow(),
      };
      addAnalyzerRun(state, queuedAnalyzer);
      addActivity(
        state,
        makeActivity({
          actor: 'System',
          category: 'ANALYZE',
          status: 'queued',
          text: 'Analyzer queued from lead intake workflow',
          target: leadImport.property.address,
        }),
      );
    }

    await persistState(state);
    return {
      ok: true,
      leadImport: duplicate || leadImport,
      duplicate: Boolean(duplicate),
      queuedAnalyzer,
    };
  }

  if (normalizedEvent === 'approval-callback') {
    const approval = state.approvals.find((item) => item.id === payload.id);
    if (!approval) {
      return {
        ok: false,
        error: `Approval ${payload.id} was not found.`,
      };
    }

    approval.status = payload.status || approval.status;
    approval.actor = payload.actor || 'n8n';
    approval.actedAt = payload.actedAt || isoNow();
    approval.notes = payload.notes || approval.notes;

    addActivity(
      state,
      makeActivity({
        actor: approval.actor,
        category: approval.status === 'approved' ? 'APPROVED' : 'REJECTED',
        status: approval.status === 'approved' ? 'success' : 'warning',
        text: `${approval.type} ${approval.status}${approval.offerPrice ? ` for ${currency(approval.offerPrice)}` : ''}`,
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    return {
      ok: true,
      approval,
    };
  }

  if (normalizedEvent === 'brain-doc') {
    return toolHandlers.ingestResearchDoc(payload);
  }

  if (normalizedEvent === 'dnc-add') {
    const entry = buildDncEntry(payload);
    const existing = findDncEntryByPhone(entry.phone);
    if (!existing && entry.phone) {
      addDncEntry(state, entry);
    }
    addActivity(
      state,
      makeActivity({
        actor: 'Guardrail',
        category: 'DNC',
        status: 'blocked',
        text: `Added ${entry.phone || 'number'} to DNC`,
        target: entry.reason,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      entry: existing || entry,
      duplicate: Boolean(existing),
    };
  }

  if (normalizedEvent === 'dnc-remove') {
    const phone = normalizePhone(payload.phone || payload.number || '');
    const existingIndex = state.dncEntries.findIndex(
      (entry) => entry.id === payload.id || (phone && normalizePhone(entry.phone) === phone),
    );
    if (existingIndex === -1) {
      return {
        ok: false,
        error: 'DNC entry not found.',
      };
    }
    const [removed] = state.dncEntries.splice(existingIndex, 1);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'PBK dashboard',
        category: 'DNC',
        status: 'success',
        text: `Removed ${removed.phone} from DNC`,
        target: removed.reason,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      removed,
    };
  }

  if (normalizedEvent === 'call-control') {
    const call =
      state.calls.find((item) => item.id === payload.id) ||
      state.calls.find((item) => normalizePhone(item.phone) === normalizePhone(payload.phone || payload.to || '')) ||
      state.calls.find((item) => item.status === 'live');

    if (!call) {
      return {
        ok: false,
        error: 'No matching call found.',
      };
    }

    const action = String(payload.action || '').trim().toLowerCase();
    if (action === 'takeover' || action === 'take over') {
      call.humanJoined = true;
      call.status = 'live';
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'live',
          text: `Human takeover engaged for ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'mute' || action === 'mute ai') {
      call.aiMuted = true;
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'queued',
          text: `AI muted on live call with ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'transfer') {
      call.status = 'transferred';
      call.transferTarget = payload.target || 'human';
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'queued',
          text: `Transferred ${call.leadName} to ${call.transferTarget}`,
          target: call.address || call.phone,
        }),
      );
    } else if (action === 'end' || action === 'hangup' || action === 'hang up') {
      call.status = 'ended';
      call.endedAt = isoNow();
      call.updatedAt = isoNow();
      addActivity(
        state,
        makeActivity({
          actor: payload.actor || 'PBK dashboard',
          category: 'CALL',
          status: 'success',
          text: `Ended call with ${call.leadName}`,
          target: call.address || call.phone,
        }),
      );
    }

    upsertCall(state, call);
    await persistState(state);
    return {
      ok: true,
      call,
    };
  }

  if (normalizedEvent === 'call-status') {
    const call = createCallRecord({
      ...payload,
      id: payload.id || payload.callId || payload.call_control_id || randomUUID(),
      status: payload.status || 'live',
    });
    upsertCall(state, call);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'Telnyx',
        category: 'CALL',
        status: payload.status || 'live',
        text: `Call status update: ${payload.status || 'live'} for ${call.leadName}`,
        target: call.address || call.phone,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      call,
    };
  }

  if (normalizedEvent === 'call-transcript') {
    const call =
      state.calls.find((item) => item.id === payload.id) ||
      state.calls.find((item) => normalizePhone(item.phone) === normalizePhone(payload.phone || '')) ||
      state.calls.find((item) => item.status === 'live');
    if (!call) {
      return {
        ok: false,
        error: 'No matching call found for transcript update.',
      };
    }

    call.transcript = Array.isArray(call.transcript) ? call.transcript : [];
    if (payload.text) {
      call.transcript.push({
        speaker: payload.speaker || 'Seller',
        text: payload.text,
      });
    }
    call.updatedAt = isoNow();
    upsertCall(state, call);

    let yelling = null;
    if (payload.text) {
      yelling = await toolHandlers.detectYelling({
        transcript: payload.text,
        phone: call.phone,
        leadName: call.leadName,
        address: call.address,
      });
    }

    await persistState(state);
    return {
      ok: true,
      call,
      yelling,
    };
  }

  if (normalizedEvent === 'sms-inbound' || normalizedEvent === 'sms-outbound') {
    return toolHandlers.telnyx_sms({
      ...payload,
      direction: normalizedEvent === 'sms-inbound' ? 'inbound' : 'outbound',
    });
  }

  if (normalizedEvent === 'contract-status' || normalizedEvent === 'contract-signed') {
    const nextStatus = normalizedEvent === 'contract-signed' ? 'completed' : payload.status || 'updated';
    const contract = createContractRecord({
      ...payload,
      id: payload.id || payload.contractId || payload.envelopeId || randomUUID(),
      status: nextStatus,
    });
    upsertContract(state, contract);
    addActivity(
      state,
      makeActivity({
        actor: payload.actor || 'DocuSign',
        category: 'CONTRACT',
        status: nextStatus,
        text: `Contract ${nextStatus} for ${contract.leadName}`,
        target: contract.address,
      }),
    );
    await persistState(state);
    return {
      ok: true,
      contract,
    };
  }

  if (normalizedEvent === 'lead-command' || normalizedEvent === 'agent-command') {
    return toolHandlers.runAgentCommand(payload);
  }

  if (normalizedEvent === 'notification') {
    return toolHandlers.slackNotify(payload);
  }

  addActivity(
    state,
    makeActivity({
      actor: payload.actor || 'System',
      category: (normalizedEvent || 'EVENT').toUpperCase(),
      status: payload.status || 'received',
      text: payload.text || `Received event ${normalizedEvent}.`,
      target: payload.target || '',
    }),
  );
  await persistState(state);
  return {
    ok: true,
    received: normalizedEvent,
  };
}

function buildStateSnapshot() {
  updateDerivedStatus(state);
  return {
    status: state.status,
    approvals: state.approvals,
    activity: state.activity,
    brainDocs: state.brainDocs,
    leadImports: state.leadImports,
    analyzerRuns: state.analyzerRuns,
    dncEntries: state.dncEntries,
    calls: state.calls,
    messages: state.messages,
    contracts: state.contracts,
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function matchesPath(pathname, pathnames) {
  return pathnames.includes(pathname);
}

function matchPath(pathname, pattern) {
  const regex = new RegExp(
    `^${pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z0-9_]+)/g, '(?<$1>[^/]+)')}$`,
  );
  return pathname.match(regex);
}

function mapTelnyxWebhook(body = {}) {
  const eventType = String(body.data?.event_type || body.event_type || body.type || '').toLowerCase();
  const payload = body.data?.payload || body.payload || body.data || body;

  if (eventType.includes('message')) {
    return {
      eventType: eventType.includes('received') ? 'sms-inbound' : 'sms-outbound',
      payload: {
        id: payload.id || payload.message_id,
        phone: payload.to || payload.from || payload.phone_number,
        body: payload.text || payload.body || '',
        direction: eventType.includes('received') ? 'inbound' : 'outbound',
        status: payload.status || 'received',
        leadName: payload.contact_name || '',
      },
    };
  }

  if (eventType.includes('call')) {
    return {
      eventType: 'call-status',
      payload: {
        id: payload.call_control_id || payload.id || randomUUID(),
        phone: payload.to || payload.from || payload.phone_number,
        status: eventType.includes('hangup')
          ? 'ended'
          : eventType.includes('answered')
            ? 'live'
            : eventType.includes('bridged')
              ? 'transferred'
              : 'queued',
        leadName: payload.contact_name || '',
        address: payload.address || '',
      },
    };
  }

  return {
    eventType: 'notification',
    payload: {
      actor: 'Telnyx',
      text: `Unhandled Telnyx webhook ${eventType || 'unknown'}`,
      target: 'telnyx',
    },
  };
}

function mapDocuSignWebhook(body = {}) {
  const status = String(
    body.status ||
      body.event ||
      body.envelopeStatus ||
      body.data?.envelopeSummary?.status ||
      '',
  ).toLowerCase();

  return {
    eventType: ['completed', 'signed'].includes(status) ? 'contract-signed' : 'contract-status',
    payload: {
      id: body.id || body.envelopeId || body.data?.envelopeId || randomUUID(),
      envelopeId: body.envelopeId || body.data?.envelopeId || '',
      status: status || 'updated',
      leadName: body.leadName || body.signerName || '',
      address: body.address || '',
      amount: body.amount || body.offerPrice || 0,
    },
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && matchesPath(pathname, ['/', '/health', '/status', '/api/health', '/api/status'])) {
      json(response, 200, {
        ok: true,
        service: 'pbk-local-openclaw',
        host: HOST,
        port: PORT,
        tools: state.status.tools,
        toolUsage: state.status.toolUsage,
        n8n: state.status.n8n,
        lastUpdatedAt: state.status.lastUpdatedAt,
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/state', '/api/state'])) {
      json(response, 200, buildStateSnapshot());
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/api/tools'])) {
      json(response, 200, {
        ok: true,
        tools: TOOL_NAMES,
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/invoke', '/api/invoke'])) {
      const body = await readBody(request);
      const toolName = body.toolName;
      const params = body.params || {};
      if (!toolHandlers[toolName]) {
        json(response, 404, {
          ok: false,
          error: `Unknown tool: ${toolName}`,
          tools: Object.keys(toolHandlers),
        });
        return;
      }

      const result = await toolHandlers[toolName](params);
      json(response, 200, {
        ok: true,
        toolName,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && matchesPath(pathname, ['/events', '/api/events'])) {
      const body = await readBody(request);
      const eventType = body.eventType || body.type || body.event || '';
      const payload = body.payload || body.data || body;

      if (!eventType) {
        json(response, 400, {
          ok: false,
          error: 'eventType is required',
        });
        return;
      }

      const result = await handleEvent(eventType, payload);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/approvals') {
      json(response, 200, {
        ok: true,
        approvals: state.approvals,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/approvals') {
      const body = await readBody(request);
      const result = await toolHandlers.createApproval(body);
      json(response, 200, {
        ok: true,
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const approvalMatch = matchPath(pathname, '/api/approvals/:id');
    if (approvalMatch && request.method === 'PUT') {
      const body = await readBody(request);
      const result = await handleEvent('approval-callback', {
        id: approvalMatch.groups.id,
        status: body.status || body.action || 'approved',
        actor: body.actor || 'api',
        actedAt: body.actedAt || isoNow(),
        notes: body.notes || '',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/dnc') {
      json(response, 200, {
        ok: true,
        dncEntries: state.dncEntries,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/dnc') {
      const body = await readBody(request);
      const result = await handleEvent('dnc-add', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const dncMatch = matchPath(pathname, '/api/dnc/:id');
    if (dncMatch && request.method === 'DELETE') {
      const result = await handleEvent('dnc-remove', {
        id: dncMatch.groups.id,
        actor: 'api',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/calls') {
      json(response, 200, {
        ok: true,
        calls: state.calls,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/calls') {
      const body = await readBody(request);
      const result = await toolHandlers.telnyx_call(body);
      json(response, result.ok === false ? 409 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const callActionMatch = matchPath(pathname, '/api/calls/:id/action');
    if (callActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await handleEvent('call-control', {
        id: callActionMatch.groups.id,
        action: body.action,
        target: body.target,
        actor: body.actor || 'api',
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/messages') {
      json(response, 200, {
        ok: true,
        messages: state.messages,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/messages') {
      const body = await readBody(request);
      const result = await toolHandlers.telnyx_sms(body);
      json(response, result.ok === false ? 409 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/contracts') {
      json(response, 200, {
        ok: true,
        contracts: state.contracts,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contracts') {
      const body = await readBody(request);
      const result = await toolHandlers.sendDocuSign(body);
      json(response, 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    const contractActionMatch = matchPath(pathname, '/api/contracts/:id/action');
    if (contractActionMatch && request.method === 'POST') {
      const body = await readBody(request);
      const result = await handleEvent('contract-status', {
        id: contractActionMatch.groups.id,
        status: body.status || body.action || 'updated',
        actor: body.actor || 'api',
        leadName: body.leadName,
        address: body.address,
        amount: body.amount,
      });
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/leads/import') {
      json(response, 200, {
        ok: true,
        leadImports: state.leadImports,
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/leads/import') {
      const body = await readBody(request);
      const result = await handleEvent('lead-intake', body);
      json(response, result.ok === false ? 404 : 200, {
        ...result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/telnyx') {
      const body = await readBody(request);
      const mapped = mapTelnyxWebhook(body);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/webhooks/docusign') {
      const body = await readBody(request);
      const mapped = mapDocuSignWebhook(body);
      const result = await handleEvent(mapped.eventType, mapped.payload);
      json(response, result.ok === false ? 404 : 200, {
        ok: true,
        mappedEvent: mapped.eventType,
        result,
        state: buildStateSnapshot(),
      });
      return;
    }

    json(response, 404, {
      ok: false,
      error: `No route for ${request.method} ${pathname}`,
      available: [
        'GET /health',
        'GET /state',
        'GET /api/tools',
        'POST /invoke',
        'POST /events',
        'GET/POST /api/approvals',
        'GET/POST/DELETE /api/dnc',
        'GET/POST /api/calls',
        'POST /api/calls/:id/action',
        'GET/POST /api/messages',
        'GET/POST /api/contracts',
        'GET/POST /api/leads/import',
        'POST /api/webhooks/telnyx',
        'POST /api/webhooks/docusign',
      ],
    });
  } catch (error) {
    json(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[pbk-local-openclaw] listening on http://${HOST}:${PORT}`);
  console.log(`[pbk-local-openclaw] state file: ${STATE_FILE}`);
  console.log(`[pbk-local-openclaw] tools: ${state.status.tools.join(', ')}`);
  if (APPROVAL_WEBHOOK_URL) {
    console.log(`[pbk-local-openclaw] approval webhook -> ${APPROVAL_WEBHOOK_URL}`);
  }
  if (LEAD_WEBHOOK_URL) {
    console.log(`[pbk-local-openclaw] lead webhook -> ${LEAD_WEBHOOK_URL}`);
  }
});
