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

const LIMITS = {
  approvals: 50,
  activity: 120,
  brainDocs: 80,
  leadImports: 80,
  analyzerRuns: 80,
};

function isoNow() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function trimArray(items = [], limit = 25) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function formatWebhookPayload(payload) {
  return JSON.stringify(payload, null, 2);
}

function buildDefaultBrainDocs() {
  return [
    {
      id: 'brain-70-rule',
      kind: 'pdf',
      topic: 'Wholesaling',
      title: 'The 70% Rule - When to Break It and When to Obey',
      source: 'PBK memo',
      excerpt:
        'Deep dive on when flat MAO calculations fail in urban infill, luxury flips, and rural markets with thin comps.',
      summary:
        'Use the 70% rule as a speed filter, not as theology. Thin-comp markets need stronger downside protection and narrative-based comp review.',
      citation: 'PBK memo · 12 pages',
      createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
      tags: ['Wholesaling', 'Analyzer', 'MAO'],
    },
    {
      id: 'brain-probate-2026',
      kind: 'article',
      topic: 'Probate',
      title: 'Why Probate Is the Last Great Lead Source in 2026',
      source: 'REtipster',
      excerpt:
        'Executor fatigue, equity, and urgency still compound into the cleanest seller profile for direct-to-seller acquisitions.',
      summary:
        'Probate leads remain high-signal when outreach is empathetic and executor authority is confirmed before pricing conversations start.',
      citation: 'REtipster · 8 min read',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      tags: ['Probate', 'Wholesaling', 'Negotiation'],
    },
    {
      id: 'brain-subto-case',
      kind: 'case',
      topic: 'Subject-To',
      title: '$47k Assignment Fee - Subject-To - Columbus',
      source: 'PBK case file',
      excerpt:
        'A 3.2% mortgage stayed in place, the buyer stepped into payments, and the seller got relief without listing.',
      summary:
        'Use subject-to when the existing debt is attractive, the seller wants speed, and the buyer can absorb payment risk with clear written disclosure.',
      citation: 'PBK case CF-0412',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      tags: ['Subject-To', 'Creative Finance', 'Case Study'],
    },
    {
      id: 'brain-tcpa-consent',
      kind: 'legal',
      topic: 'Legal & TCPA',
      title: 'TCPA One-to-One Consent - What It Means for Wholesalers',
      source: 'FCC.gov',
      excerpt:
        'Each lead form must name your company specifically. Shared blanket consent no longer protects AI-led telemarketing.',
      summary:
        'Keep one-to-one consent language on every lead form, store consent timestamps, and start every AI call with transparent disclosure.',
      citation: 'FCC ruling summary',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      tags: ['Compliance', 'Legal & TCPA', 'Voice'],
    },
    {
      id: 'brain-akron-notes',
      kind: 'note',
      topic: 'Market Reports',
      title: "Jordan's notes - Akron vs Columbus seller psychology",
      source: 'Voice memo',
      excerpt:
        'Akron responds to urgency and burden removal. Columbus responds better to empathy and clean process language.',
      summary:
        'Route call scripts by sub-market. Akron can take firmer anchors earlier; Columbus needs more relationship framing before price.',
      citation: 'Voice memo · Apr 10',
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
      target: 'Diane Kowalski · 202 Cherry Ln',
      at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    }),
    makeActivity({
      actor: 'System',
      category: 'ANALYZE',
      status: 'success',
      text: 'Analyzer ran - ARV $185k · repairs $38k · MAO $91,500',
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
        { source: 'Redfin', age: '8m', title: 'Columbus median DOM fell to 18 days - hottest since Oct 2024' },
        { source: 'FRED', age: '1h', title: '30-yr fixed at 6.42% - seller financing appeal unchanged' },
        { source: 'ATTOM', age: '3h', title: 'Ohio foreclosure starts up 11% QoQ - pre-FC volume likely rising' },
        { source: 'FCC', age: '1d', title: 'No new TCPA changes this week - one-to-one consent still standard' },
      ],
      suggestedReading: [
        {
          why: 'Because Diane K. is live right now',
          title: 'Handling grief-bereaved sellers without sounding predatory - 4 min',
        },
        {
          why: 'Because 3 probate leads are queued',
          title: 'Ohio probate executor authority checklist - 2026',
        },
        {
          why: 'Because HVAC costs shifted',
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
      tools: ['analyzeDeal', 'createApproval', 'updateCRM', 'ingestResearchDoc', 'getBrainState'],
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
  };
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

async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
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
    const parsed = JSON.parse(raw);
    return hydrateState(parsed);
  } catch (error) {
    const fresh = buildDefaultState();
    await persistState(fresh);
    return fresh;
  }
}

async function persistState(nextState) {
  nextState.status.lastUpdatedAt = isoNow();
  await ensureRuntimeDir();
  await writeFile(STATE_FILE, formatWebhookPayload(nextState), 'utf8');
}

function hydrateState(state = {}) {
  const defaults = buildDefaultState();
  const hydrated = {
    ...defaults,
    ...state,
    status: {
      ...defaults.status,
      ...(state.status || {}),
    },
    approvals: trimArray(state.approvals || defaults.approvals, LIMITS.approvals),
    activity: trimArray(state.activity || defaults.activity, LIMITS.activity),
    brainDocs: trimArray(state.brainDocs || defaults.brainDocs, LIMITS.brainDocs),
    leadImports: trimArray(state.leadImports || defaults.leadImports, LIMITS.leadImports),
    analyzerRuns: trimArray(state.analyzerRuns || defaults.analyzerRuns, LIMITS.analyzerRuns),
  };
  updateDerivedStatus(hydrated);
  return hydrated;
}

function updateDerivedStatus(state) {
  state.status.sourcesIndexed = state.brainDocs.length;
  state.status.pendingApprovals = state.approvals.filter((approval) => approval.status === 'pending').length;
  state.status.lastApprovalAt = state.approvals[0]?.createdAt || null;
  state.status.lastImportAt = state.leadImports[0]?.createdAt || null;
  state.status.lastAnalyzerAt = state.analyzerRuns[0]?.createdAt || null;
  state.status.n8n = {
    approvalWebhookConfigured: Boolean(APPROVAL_WEBHOOK_URL),
    leadWebhookConfigured: Boolean(LEAD_WEBHOOK_URL),
  };
}

function sortByNewest(items) {
  return [...items].sort((a, b) => String(b.createdAt || b.at).localeCompare(String(a.createdAt || a.at)));
}

function limitStateArrays(state) {
  state.approvals = sortByNewest(state.approvals).slice(0, LIMITS.approvals);
  state.activity = sortByNewest(state.activity).slice(0, LIMITS.activity);
  state.brainDocs = sortByNewest(state.brainDocs).slice(0, LIMITS.brainDocs);
  state.leadImports = sortByNewest(state.leadImports).slice(0, LIMITS.leadImports);
  state.analyzerRuns = sortByNewest(state.analyzerRuns).slice(0, LIMITS.analyzerRuns);
}

function averagePrices(deal = {}) {
  const prices = ['A', 'B', 'C']
    .map((key) => toNumber(deal?.comps?.[key]?.price, 0))
    .filter((value) => value > 0);
  if (!prices.length) return 0;
  return Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
}

function buildAnalyzerSummary(params = {}) {
  const deal = params.deal || {};
  const address = params.address || deal.address || 'Unknown address';
  const arv = toNumber(deal.arv, 0) || averagePrices(deal);
  const repairsMid = toNumber(deal?.repairs?.mid, 0);
  const fee = toNumber(deal.fee, 8000) || 8000;
  const mao = Math.max(0, Math.round(arv * 0.6 - fee));
  const targetOffer = Math.max(0, Math.round(mao * 0.85));
  const estProfit = Math.max(0, mao - targetOffer);
  return {
    id: `run-${slugify(address) || randomUUID()}`,
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

function addActivity(state, entry) {
  state.activity.unshift(entry);
  limitStateArrays(state);
  updateDerivedStatus(state);
}

function addApproval(state, approval) {
  state.approvals.unshift(approval);
  limitStateArrays(state);
  updateDerivedStatus(state);
}

function addBrainDoc(state, doc) {
  state.brainDocs.unshift(doc);
  limitStateArrays(state);
  updateDerivedStatus(state);
}

function addLeadImport(state, leadImport) {
  state.leadImports.unshift(leadImport);
  limitStateArrays(state);
  updateDerivedStatus(state);
}

function addAnalyzerRun(state, run) {
  state.analyzerRuns.unshift(run);
  limitStateArrays(state);
  updateDerivedStatus(state);
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

function answerBrainQuery(state, query = '') {
  const trimmed = String(query || '').trim();
  const matches = state.brainDocs
    .map((doc) => ({
      ...doc,
      score: scoreBrainDocMatch(doc, trimmed || doc.title),
    }))
    .filter((doc) => doc.score > 0 || !trimmed)
    .sort((a, b) => b.score - a.score || String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 3);

  const top = matches[0];
  const answer = top
    ? `Best match: ${top.title}. ${top.summary}`
    : 'No direct match yet. Ingest a new source or try a narrower query like "probate Ohio" or "subject-to".';

  return {
    query: trimmed,
    answer,
    matches: matches.map(({ score, ...doc }) => doc),
    citations: matches.map((doc) => doc.citation || `${doc.source} · ${doc.title}`),
  };
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

function normalizeLeadIntake(payload = {}) {
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
    createdAt: isoNow(),
  };
}

let state = await loadState();

const toolHandlers = {
  async analyzeDeal(params = {}) {
    const run = buildAnalyzerSummary(params);
    addAnalyzerRun(state, run);
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'ANALYZE',
        status: 'success',
        text: `Analyzer ran - ARV ${currency(run.arv)} · MAO ${currency(run.mao)} · target ${currency(run.targetOffer)}`,
        target: run.address,
      }),
    );
    await persistState(state);
    return run;
  },

  async createApproval(params = {}) {
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
      createdAt: isoNow(),
    };

    addApproval(state, approval);
    addActivity(
      state,
      makeActivity({
        actor: 'Ava',
        category: 'APPROVAL',
        status: 'pending',
        text: `Queued ${approval.type} approval ${approval.offerPrice ? `for ${currency(approval.offerPrice)}` : ''}`.trim(),
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    const fanout = await fireWebhook(APPROVAL_WEBHOOK_URL, approval);
    return { approval, fanout };
  },

  async updateCRM(params = {}) {
    addActivity(
      state,
      makeActivity({
        actor: 'System',
        category: 'CRM',
        status: 'queued',
        text: params.message || 'CRM sync requested from local OpenClaw bridge.',
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
    const doc = {
      id: params.id || randomUUID(),
      kind: params.kind || 'note',
      topic: params.topic || 'Wholesaling',
      title: params.title || 'Untitled source',
      source: params.source || 'Manual ingest',
      excerpt: params.excerpt || params.summary || 'No excerpt provided.',
      summary: params.summary || params.excerpt || 'No summary provided.',
      citation: params.citation || `${params.source || 'Manual ingest'} · ${new Date().toLocaleDateString()}`,
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
};

function currency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(toNumber(value, 0));
}

async function handleEvent(eventType, payload = {}) {
  if (eventType === 'lead-intake') {
    const fromN8nLeadIntake = payload?._source === 'n8n-lead-intake';
    const leadImport = normalizeLeadIntake(payload);
    addLeadImport(state, leadImport);
    addActivity(
      state,
      makeActivity({
        actor: 'n8n',
        category: 'IMPORT',
        status: 'complete',
        text: `Lead intake normalized from ${leadImport.source}`,
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
    if (LEAD_WEBHOOK_URL && !fromN8nLeadIntake) {
      await fireWebhook(LEAD_WEBHOOK_URL, {
        eventType: 'lead-intake',
        payload: leadImport,
      });
    }
    return {
      ok: true,
      leadImport,
      queuedAnalyzer,
    };
  }

  if (eventType === 'approval-callback') {
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

    addActivity(
      state,
      makeActivity({
        actor: approval.actor,
        category: approval.status === 'approved' ? 'APPROVED' : 'REJECTED',
        status: approval.status === 'approved' ? 'success' : 'warning',
        text: `${approval.type} ${approval.status} ${approval.offerPrice ? `for ${currency(approval.offerPrice)}` : ''}`.trim(),
        target: approval.address || approval.leadName,
      }),
    );

    await persistState(state);
    return {
      ok: true,
      approval,
    };
  }

  if (eventType === 'brain-doc') {
    return toolHandlers.ingestResearchDoc(payload);
  }

  addActivity(
    state,
    makeActivity({
      actor: payload.actor || 'System',
      category: (eventType || 'EVENT').toUpperCase(),
      status: payload.status || 'received',
      text: payload.text || `Received event ${eventType}.`,
      target: payload.target || '',
    }),
  );
  await persistState(state);
  return {
    ok: true,
    received: eventType,
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
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
  return raw ? JSON.parse(raw) : {};
}

function matchesPath(pathname, pathnames) {
  return pathnames.includes(pathname);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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
        n8n: state.status.n8n,
        lastUpdatedAt: state.status.lastUpdatedAt,
      });
      return;
    }

    if (request.method === 'GET' && matchesPath(pathname, ['/state', '/api/state'])) {
      json(response, 200, buildStateSnapshot());
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

    json(response, 404, {
      ok: false,
      error: `No route for ${request.method} ${pathname}`,
      available: ['GET /health', 'GET /state', 'POST /invoke', 'POST /events'],
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
