import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const OUTPUT_DIR = resolvePath(process.env.PBK_BRAIN_EXPORT_DIR || path.join(ROOT_DIR, 'brain-export'));
const OPENCLAW_MIRROR_DIR = resolvePath(
  process.env.PBK_OPENCLAW_BRAIN_EXPORT_DIR || path.join(os.homedir(), '.openclaw', 'workspace', 'brain-export'),
);
const LOCAL_STATE_FILE = path.join(ROOT_DIR, '.pbk-local', 'openclaw-state.json');

const args = process.argv.slice(2);
const SOURCE_MODE = getArgValue('--source') || 'auto';
const BRIDGE_API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const HOSTED_BRIDGE_URL = normalizeUrl(
  process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com',
);
const LOCAL_BRIDGE_URL = normalizeUrl(process.env.PBK_LOCAL_BRIDGE_URL || 'http://127.0.0.1:8788');
const SHOULD_MIRROR_OPENCLAW = !args.includes('--no-openclaw-mirror');

const stateBundle = await loadStateBundle();
await exportGraph(OUTPUT_DIR, stateBundle, { mirrorLabel: 'repo' });

if (SHOULD_MIRROR_OPENCLAW) {
  await exportGraph(OPENCLAW_MIRROR_DIR, stateBundle, { mirrorLabel: 'openclaw' });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      source: stateBundle.source,
      outputDir: OUTPUT_DIR,
      mirroredToOpenClaw: SHOULD_MIRROR_OPENCLAW,
      openClawMirrorDir: SHOULD_MIRROR_OPENCLAW ? OPENCLAW_MIRROR_DIR : null,
      revision: stateBundle.health?.revision || null,
      providerStates: summarizeProviders(stateBundle.health?.providers || {}),
      pages: stateBundle.pageCount,
      journals: stateBundle.journalCount,
    },
    null,
    2,
  ),
);

function getArgValue(flag) {
  const index = args.findIndex((entry) => entry === flag || entry.startsWith(`${flag}=`));
  if (index < 0) return '';
  if (args[index].includes('=')) {
    return args[index].split('=').slice(1).join('=').trim();
  }
  return String(args[index + 1] || '').trim();
}

function resolvePath(value) {
  if (!value) return '';
  if (path.isAbsolute(value)) return value;
  return path.resolve(ROOT_DIR, value);
}

function normalizeUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/g, '');
}

async function loadStateBundle() {
  if (SOURCE_MODE === 'hosted') {
    return loadFromBridge(HOSTED_BRIDGE_URL, 'hosted');
  }
  if (SOURCE_MODE === 'local') {
    return loadFromBridge(LOCAL_BRIDGE_URL, 'local');
  }
  if (SOURCE_MODE === 'file') {
    return loadFromFile();
  }

  for (const candidate of [
    () => loadFromBridge(HOSTED_BRIDGE_URL, 'hosted'),
    () => loadFromBridge(LOCAL_BRIDGE_URL, 'local'),
    () => loadFromFile(),
  ]) {
    try {
      return await candidate();
    } catch {
      // Try the next safest source.
    }
  }

  throw new Error('Unable to load PBK brain state from hosted bridge, local bridge, or local state file.');
}

async function loadFromBridge(baseUrl, label) {
  if (!baseUrl) {
    throw new Error(`Missing ${label} bridge URL.`);
  }

  const headers = {};
  if (BRIDGE_API_KEY) {
    headers.Authorization = `Bearer ${BRIDGE_API_KEY}`;
  }

  const [healthResponse, stateResponse] = await Promise.all([
    fetchJson(`${baseUrl}/health`, { headers }),
    fetchJson(`${baseUrl}/state`, { headers }),
  ]);

  return {
    source: `${label}-bridge`,
    bridgeUrl: baseUrl,
    health: healthResponse,
    state: stateResponse,
  };
}

async function loadFromFile() {
  if (!existsSync(LOCAL_STATE_FILE)) {
    throw new Error(`Local state file not found: ${LOCAL_STATE_FILE}`);
  }

  const raw = await readFile(LOCAL_STATE_FILE, 'utf8');
  const state = JSON.parse(raw);

  return {
    source: 'local-file',
    bridgeUrl: '',
    health: {
      revision: 'local-file-export',
      runtime: {
        mode: 'file',
        hosted: false,
        authRequired: false,
        stateBackend: 'file',
        productionReady: false,
        providers: {},
        warnings: ['Exported from local state file fallback.'],
      },
      providers: {},
      features: {
        stateBackend: 'file',
        authRequired: false,
      },
    },
    state,
  };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} @ ${url}`);
  }
  return response.json();
}

async function exportGraph(baseDir, stateBundle, { mirrorLabel }) {
  const pagesDir = path.join(baseDir, 'pages', 'generated');
  const journalsDir = path.join(baseDir, 'journals', 'generated');

  await mkdir(baseDir, { recursive: true });
  await rm(pagesDir, { recursive: true, force: true });
  await rm(journalsDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });
  await mkdir(journalsDir, { recursive: true });

  const { state, health } = stateBundle;
  const approvals = arrayOf(state.approvals);
  const analyzerRuns = arrayOf(state.analyzerRuns);
  const contracts = arrayOf(state.contracts);
  const activity = arrayOf(state.activity);
  const brainDocs = arrayOf(state.brainDocs);
  const dncEntries = arrayOf(state.dncEntries);
  const providerStates = summarizeProviders(health?.providers || {});
  const pageWrites = [];

  pageWrites.push(
    writePage(
      pagesDir,
      'PBK Brain Home.md',
      renderHomePage({
        stateBundle,
        approvals,
        analyzerRuns,
        contracts,
        brainDocs,
        activity,
        providerStates,
      }),
    ),
    writePage(pagesDir, 'Research Library.md', renderResearchIndexPage({ stateBundle, brainDocs })),
    writePage(
      pagesDir,
      'Deal Recaps.md',
      renderDealIndexPage({ stateBundle, approvals, analyzerRuns, contracts, activity }),
    ),
    writePage(
      pagesDir,
      'Contracts Pipeline.md',
      renderContractsPage({ stateBundle, contracts, approvals }),
    ),
    writePage(
      pagesDir,
      'Provider Status.md',
      renderProviderPage({ stateBundle, providerStates }),
    ),
    writePage(
      pagesDir,
      'OpenClaw Runtime.md',
      renderRuntimePage({ stateBundle }),
    ),
    writePage(
      pagesDir,
      'Founder Activity.md',
      renderActivityPage({ stateBundle, activity, dncEntries }),
    ),
  );

  for (const doc of brainDocs) {
    pageWrites.push(
      writePage(
        pagesDir,
        `Research - ${safePageSegment(doc.title || doc.id)}.md`,
        renderResearchDocPage({ doc }),
      ),
    );
  }

  for (const recap of buildDealRecaps({ approvals, analyzerRuns, contracts, activity })) {
    pageWrites.push(
      writePage(
        pagesDir,
        `Deal - ${safePageSegment(recap.title)}.md`,
        renderDealPage({ recap }),
      ),
    );
  }

  const journalName = `${new Date().toISOString().slice(0, 10)}.md`;
  await Promise.all(pageWrites);
  await writePage(journalsDir, journalName, renderJournalPage({ stateBundle, mirrorLabel, providerStates }));
  await writeReadme(baseDir, stateBundle, mirrorLabel);

  stateBundle.pageCount = pageWrites.length;
  stateBundle.journalCount = 1;
}

async function writeReadme(baseDir, stateBundle, mirrorLabel) {
  const readme = `# PBK Brain Export

This folder is a Logseq-friendly export of the current PBK founder runtime.

- Source: \`${stateBundle.source}\`
- Bridge: ${stateBundle.bridgeUrl || 'local state file fallback'}
- Revision: \`${stateBundle.health?.revision || 'unknown'}\`
- Mirror target: \`${mirrorLabel}\`

## Layout

- \`pages/generated/\` contains generated Logseq-style pages for research, deal recaps, contracts, provider state, and runtime notes.
- \`journals/generated/\` contains a daily export snapshot page.

## Refresh

\`\`\`powershell
cd "C:\\Users\\Dell\\Documents\\New project 2\\PbkDesign-main"
node .\\scripts\\export-logseq-brain.mjs
\`\`\`

The exporter writes this repo copy and, by default, mirrors the same graph into:

\`${OPENCLAW_MIRROR_DIR}\`

That mirror gives the local OpenClaw workspace and Codex a shared markdown memory surface without changing PBK's transactional source of truth.
`;

  await writeFile(path.join(baseDir, 'README.md'), readme, 'utf8');
}

async function writePage(dir, name, content) {
  await writeFile(path.join(dir, name), `${content.trim()}\n`, 'utf8');
}

function renderHomePage({ stateBundle, approvals, analyzerRuns, contracts, brainDocs, activity, providerStates }) {
  const runtime = stateBundle.health?.runtime || {};
  const status = stateBundle.state?.status || {};
  const providerLines = Object.entries(providerStates)
    .map(([name, statusLabel]) => `  - ${capitalize(name)}:: ${statusLabel}`)
    .join('\n');

  return `
title:: PBK Brain Home
type:: graph-home
source:: ${stateBundle.source}
revision:: ${stateBundle.health?.revision || 'unknown'}
exported-at:: ${new Date().toISOString()}
bridge-url:: ${stateBundle.bridgeUrl || 'local-file'}

- [[Research Library]]
  - Sources indexed:: ${brainDocs.length}
  - Weekly sources:: ${status.weeklySources ?? 0}
- [[Deal Recaps]]
  - Analyzer runs:: ${analyzerRuns.length}
  - Pending approvals:: ${approvals.filter((item) => item.status === 'pending').length}
  - Open contracts:: ${contracts.filter((item) => !['completed', 'void', 'rejected'].includes(String(item.status || '').toLowerCase())).length}
- [[Contracts Pipeline]]
  - Last contract at:: ${status.lastContractAt || 'n/a'}
- [[OpenClaw Runtime]]
  - Mode:: ${runtime.mode || 'unknown'}
  - Hosted:: ${yesNo(runtime.hosted)}
  - Auth required:: ${yesNo(runtime.authRequired)}
  - State backend:: ${runtime.stateBackend || 'unknown'}
  - Production ready:: ${yesNo(runtime.productionReady)}
- [[Provider Status]]
${providerLines || '  - No provider state available'}
- [[Founder Activity]]
  - Recent events:: ${activity.slice(0, 5).length}
`;
}

function renderResearchIndexPage({ stateBundle, brainDocs }) {
  const docs = brainDocs
    .map(
      (doc) => `- [[Research - ${pageRef(doc.title || doc.id)}]]
  - topic:: [[${doc.topic || 'Wholesaling'}]]
  - kind:: ${doc.kind || 'note'}
  - source:: ${doc.source || 'Unknown'}
  - citation:: ${doc.citation || 'n/a'}
  - summary:: ${doc.summary || doc.excerpt || 'No summary provided.'}`,
    )
    .join('\n');

  return `
title:: Research Library
type:: knowledge-index
source:: ${stateBundle.source}
exported-at:: ${new Date().toISOString()}

- PBK research notes exported from the founder runtime.
${docs || '- No research documents exported yet.'}
`;
}

function renderResearchDocPage({ doc }) {
  const tags = arrayOf(doc.tags).map((tag) => `[[${tag}]]`).join(', ') || '[[Wholesaling]]';

  return `
title:: Research - ${pageRef(doc.title || doc.id)}
topic:: [[${doc.topic || 'Wholesaling'}]]
kind:: ${doc.kind || 'note'}
source:: ${doc.source || 'Unknown'}
citation:: ${doc.citation || 'n/a'}
created-at:: ${doc.createdAt || ''}
tags:: ${tags}

- Summary
  - ${doc.summary || doc.excerpt || 'No summary provided.'}
- Excerpt
  - ${doc.excerpt || doc.summary || 'No excerpt provided.'}
- Connected pages
  - [[Research Library]]
  - [[PBK Brain Home]]
`;
}

function renderDealIndexPage({ stateBundle, approvals, analyzerRuns, contracts, activity }) {
  const recaps = buildDealRecaps({ approvals, analyzerRuns, contracts, activity });
  const lines = recaps
    .map(
      (recap) => `- [[Deal - ${pageRef(recap.title)}]]
  - lead:: ${recap.leadName || 'Unknown seller'}
  - address:: ${recap.address || 'Unknown property'}
  - stage:: ${recap.stage}
  - summary:: ${recap.summary}`,
    )
    .join('\n');

  return `
title:: Deal Recaps
type:: deal-index
source:: ${stateBundle.source}
exported-at:: ${new Date().toISOString()}

${lines || '- No deal recaps exported yet.'}
`;
}

function renderDealPage({ recap }) {
  const analyzerLine = recap.analyzer
    ? `- Analyzer
  - arv:: ${recap.analyzer.arv ?? 'n/a'}
  - repairs-mid:: ${recap.analyzer.repairsMid ?? 'n/a'}
  - mao:: ${recap.analyzer.mao ?? 'n/a'}
  - target-offer:: ${recap.analyzer.targetOffer ?? 'n/a'}
  - est-profit:: ${recap.analyzer.estProfit ?? 'n/a'}`
    : '- Analyzer\n  - No analyzer run captured.';

  const approvalLine = recap.approval
    ? `- Approval
  - status:: ${recap.approval.status || 'n/a'}
  - offer-price:: ${recap.approval.offerPrice ?? 'n/a'}
  - notes:: ${recap.approval.notes || 'n/a'}`
    : '- Approval\n  - No approval captured.';

  const contractLine = recap.contract
    ? `- Contract
  - status:: ${recap.contract.status || 'n/a'}
  - document-title:: ${recap.contract.documentTitle || recap.contract.title || 'n/a'}
  - updated-at:: ${recap.contract.updatedAt || recap.contract.createdAt || 'n/a'}`
    : '- Contract\n  - No contract captured.';

  const recentEvents = arrayOf(recap.events)
    .map((event) => `  - ${event.at || 'n/a'} — ${event.text || 'Untitled event'}${event.actor ? ` (${event.actor})` : ''}`)
    .join('\n');

  return `
title:: Deal - ${pageRef(recap.title)}
lead:: ${recap.leadName || 'Unknown seller'}
address:: ${recap.address || 'Unknown property'}
stage:: ${recap.stage}
updated-at:: ${recap.updatedAt || ''}

- Summary
  - ${recap.summary}
${analyzerLine}
${approvalLine}
${contractLine}
- Recent Events
${recentEvents || '  - No recent events captured.'}
- Connected pages
  - [[Deal Recaps]]
  - [[Contracts Pipeline]]
`;
}

function renderContractsPage({ stateBundle, contracts, approvals }) {
  const lines = contracts
    .map(
      (contract) => `- ${contract.documentTitle || contract.title || contract.id}
  - status:: ${contract.status || 'draft'}
  - address:: ${contract.propertyAddress || contract.address || 'Unknown property'}
  - lead:: ${contract.leadName || 'Unknown seller'}
  - updated-at:: ${contract.updatedAt || contract.createdAt || 'n/a'}`,
    )
    .join('\n');

  return `
title:: Contracts Pipeline
type:: contracts-index
source:: ${stateBundle.source}
pending-approvals:: ${approvals.filter((item) => item.type === 'contract' && item.status === 'pending').length}

${lines || '- No contracts exported yet.'}
`;
}

function renderProviderPage({ stateBundle, providerStates }) {
  const lines = Object.entries(providerStates)
    .map(([name, label]) => `- ${capitalize(name)}
  - status:: ${label}`)
    .join('\n');

  return `
title:: Provider Status
type:: runtime-status
source:: ${stateBundle.source}
revision:: ${stateBundle.health?.revision || 'unknown'}

${lines || '- No provider states exported yet.'}
`;
}

function renderRuntimePage({ stateBundle }) {
  const runtime = stateBundle.health?.runtime || {};
  const features = stateBundle.health?.features || {};
  const warnings = arrayOf(runtime.warnings || []).map((warning) => `  - ${warning}`).join('\n');

  return `
title:: OpenClaw Runtime
type:: runtime-status
source:: ${stateBundle.source}
bridge-url:: ${stateBundle.bridgeUrl || 'local-file'}
revision:: ${stateBundle.health?.revision || 'unknown'}

- Hosted:: ${yesNo(runtime.hosted)}
- Mode:: ${runtime.mode || 'unknown'}
- Auth required:: ${yesNo(features.authRequired ?? runtime.authRequired)}
- State backend:: ${features.stateBackend || runtime.stateBackend || 'unknown'}
- Production ready:: ${yesNo(runtime.productionReady)}
- Warnings
${warnings || '  - None'}
`;
}

function renderActivityPage({ stateBundle, activity, dncEntries }) {
  const items = activity
    .slice(0, 15)
    .map(
      (entry) => `- ${entry.at || 'n/a'} — ${entry.category || 'INFO'} — ${entry.text || 'Untitled event'}
  - actor:: ${entry.actor || 'System'}
  - status:: ${entry.status || 'unknown'}
  - target:: ${entry.target || 'n/a'}`,
    )
    .join('\n');

  const dncLines = dncEntries
    .slice(0, 8)
    .map((entry) => `  - ${entry.phone || 'Unknown'} — ${entry.reason || 'No reason provided'}`)
    .join('\n');

  return `
title:: Founder Activity
type:: activity-log
source:: ${stateBundle.source}

- Recent Activity
${items || '  - No activity exported yet.'}
- DNC Snapshot
${dncLines || '  - No DNC entries exported yet.'}
`;
}

function renderJournalPage({ stateBundle, mirrorLabel, providerStates }) {
  const providerLines = Object.entries(providerStates)
    .map(([name, label]) => `  - ${capitalize(name)}:: ${label}`)
    .join('\n');

  return `
title:: PBK Brain Export Snapshot
type:: journal
source:: ${stateBundle.source}
mirror:: ${mirrorLabel}

- Exported PBK brain graph
  - at:: ${new Date().toISOString()}
  - revision:: ${stateBundle.health?.revision || 'unknown'}
  - backend:: ${stateBundle.health?.features?.stateBackend || stateBundle.health?.runtime?.stateBackend || 'unknown'}
  - bridge:: ${stateBundle.bridgeUrl || 'local-file'}
- Providers
${providerLines || '  - No providers available'}
`;
}

function buildDealRecaps({ approvals, analyzerRuns, contracts, activity }) {
  const recapsByKey = new Map();

  const ensureRecap = (key, seed = {}) => {
    if (!recapsByKey.has(key)) {
      recapsByKey.set(key, {
        key,
        title: seed.address || seed.leadName || seed.leadId || key,
        leadName: seed.leadName || '',
        address: seed.address || '',
        stage: 'Research',
        summary: 'No recap summary yet.',
        updatedAt: seed.createdAt || seed.updatedAt || seed.at || '',
        analyzer: null,
        approval: null,
        contract: null,
        events: [],
      });
    }
    return recapsByKey.get(key);
  };

  for (const run of analyzerRuns) {
    const key = run.leadId || run.address || run.id;
    const recap = ensureRecap(key, run);
    recap.title = run.address || recap.title;
    recap.leadName ||= run.leadName || '';
    recap.address ||= run.address || '';
    recap.stage = 'Analyzed';
    recap.summary = `Analyzer ran at ${run.address || 'unknown property'} with MAO ${run.mao ?? 'n/a'} and target offer ${run.targetOffer ?? 'n/a'}.`;
    recap.updatedAt = run.createdAt || recap.updatedAt;
    recap.analyzer = run;
  }

  for (const approval of approvals) {
    const key = approval.leadId || approval.address || approval.id;
    const recap = ensureRecap(key, approval);
    recap.title = approval.address || recap.title;
    recap.leadName ||= approval.leadName || '';
    recap.address ||= approval.address || '';
    recap.stage = approval.type === 'contract' ? 'Contract approval' : 'Approval queue';
    recap.summary = approval.notes || recap.summary;
    recap.updatedAt = approval.createdAt || recap.updatedAt;
    recap.approval = approval;
  }

  for (const contract of contracts) {
    const key = contract.leadId || contract.propertyAddress || contract.id;
    const recap = ensureRecap(key, contract);
    recap.title = contract.propertyAddress || contract.address || recap.title;
    recap.leadName ||= contract.leadName || '';
    recap.address ||= contract.propertyAddress || contract.address || '';
    recap.stage = `Contract ${contract.status || 'draft'}`;
    recap.summary = `${contract.documentTitle || contract.title || 'Contract'} is ${contract.status || 'draft'}.`;
    recap.updatedAt = contract.updatedAt || contract.createdAt || recap.updatedAt;
    recap.contract = contract;
  }

  for (const entry of activity) {
    const key = entry.target || entry.id;
    const matchingRecap = [...recapsByKey.values()].find(
      (recap) =>
        (recap.address && key.includes(recap.address)) ||
        (recap.leadName && key.includes(recap.leadName)) ||
        (recap.title && key.includes(recap.title)),
    );
    if (matchingRecap) {
      matchingRecap.events.push(entry);
      matchingRecap.updatedAt = matchingRecap.updatedAt || entry.at || '';
    }
  }

  return [...recapsByKey.values()]
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .slice(0, 12);
}

function summarizeProviders(providers = {}) {
  const summary = {};
  for (const [name, meta] of Object.entries(providers || {})) {
    if (!meta || typeof meta !== 'object') {
      summary[name] = 'Unknown';
      continue;
    }

    if (name === 'telnyx') {
      if (meta.messagingReady && meta.voiceReady) {
        summary[name] = 'Live (SMS + voice)';
      } else if (meta.messagingReady) {
        summary[name] = 'Live (SMS only)';
      } else {
        const missingCount = [...arrayOf(meta.messagingMissing), ...arrayOf(meta.voiceMissing)].filter(Boolean).length;
        summary[name] = missingCount ? `Missing ${missingCount} env` : 'Not configured';
      }
      continue;
    }

    if (meta.ready) {
      summary[name] = 'Live';
      continue;
    }

    const missing = arrayOf(meta.missing);
    summary[name] = missing.length ? `Missing ${missing.length} env` : meta.configured ? 'Configured, waiting' : 'Not configured';
  }
  return summary;
}

function safePageSegment(value = '') {
  return String(value || 'Untitled')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function pageRef(value = '') {
  return safePageSegment(value).replace(/\.md$/i, '');
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function capitalize(value = '') {
  const text = String(value || '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
