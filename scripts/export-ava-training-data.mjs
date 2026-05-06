import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.resolve(ROOT_DIR, process.env.PBK_OPENCLAW_STATE_DIR || '.pbk-local');

function hydrateLocalRuntimeEnv() {
  const envPath = path.join(RUNTIME_DIR, 'pbk-runtime.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

hydrateLocalRuntimeEnv();

const bridgeUrl = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_OPENCLAW_URL
    || process.env.OPENCLAW_URL
    || 'http://127.0.0.1:8788',
).replace(/\/+$/g, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const tenantId = String(process.env.PBK_TENANT_ID || 'pbk').trim() || 'pbk';
const databaseUrl = String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const days = Math.max(1, Math.min(90, Number(process.env.PBK_AVA_TRAINING_DAYS || 7)));
const limit = Math.max(1, Math.min(2000, Number(process.env.PBK_AVA_TRAINING_LIMIT || 500)));
const outputDir = path.resolve(ROOT_DIR, process.env.PBK_AVA_TRAINING_OUTPUT_DIR || '.pbk-training');
const minChars = Math.max(1, Math.min(500, Number(process.env.PBK_AVA_TRAINING_MIN_CHARS || 20)));
const allowedDecisions = new Set(
  String(process.env.PBK_AVA_TRAINING_DECISIONS || 'approved,approve,accepted')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

const SYSTEM_PROMPT = [
  'You are Ava Chen, Senior Wholesale Acquisition Specialist at Probono Key Realty.',
  'Your goal is to qualify sellers, extract BANT, recommend the correct PBK path,',
  'handle objections ethically, and keep all outbound provider actions approval-gated.',
  'Always use PBK path language: cash-offer, creative-finance, mortgage-takeover, land, land-agent, or rbp.',
].join(' ');

function normalizeFeedback(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: String(row.id || '').trim(),
    tenantId: String(row.tenant_id || row.tenantId || tenantId).trim() || tenantId,
    leadId: String(row.lead_id || row.leadId || '').trim(),
    callId: String(row.call_id || row.callId || '').trim(),
    agentName: String(row.agent_name || row.agentName || row.agent || 'Ava').trim() || 'Ava',
    agentAction: String(row.agent_action || row.agentAction || row.action || '').trim(),
    humanDecision: String(row.human_decision || row.humanDecision || row.decision || '').trim().toLowerCase(),
    transcriptSnippet: String(row.transcript_snippet || row.transcriptSnippet || row.snippet || '').trim(),
    outcomeLabel: String(row.outcome_label || row.outcomeLabel || row.outcome || '').trim(),
    metadata,
    createdAt: row.created_at || row.createdAt || '',
  };
}

async function loadFromPostgres() {
  if (!databaseUrl) return { source: 'postgres', skipped: true, rows: [] };
  const pg = await import('pg');
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `SELECT id, tenant_id, lead_id, call_id, agent_name, agent_action,
        human_decision, transcript_snippet, outcome_label, metadata, created_at
       FROM public.pbk_feedback
       WHERE tenant_id = $1
         AND LOWER(human_decision) = ANY($2::text[])
         AND created_at >= NOW() - ($3::text || ' days')::interval
       ORDER BY created_at DESC
       LIMIT $4`,
      [tenantId, Array.from(allowedDecisions), days, limit],
    );
    return { source: 'postgres', skipped: false, rows: result.rows.map(normalizeFeedback) };
  } finally {
    await pool.end();
  }
}

async function loadFromBridgeState() {
  const response = await fetch(`${bridgeUrl}/state`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Bridge /state returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const state = text ? JSON.parse(text) : {};
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = (Array.isArray(state.pbkFeedback) ? state.pbkFeedback : [])
    .map(normalizeFeedback)
    .filter((row) => !row.createdAt || new Date(row.createdAt).getTime() >= cutoff)
    .filter((row) => allowedDecisions.has(row.humanDecision))
    .slice(0, limit);
  return { source: 'bridge-state', skipped: false, rows };
}

function buildExample(row) {
  const context = [
    row.leadId ? `Lead ID: ${row.leadId}` : '',
    row.callId ? `Call ID: ${row.callId}` : '',
    row.metadata?.leadName ? `Seller: ${row.metadata.leadName}` : '',
    row.metadata?.address ? `Property: ${row.metadata.address}` : '',
  ].filter(Boolean);
  const userContent = [
    ...context,
    'Transcript snippet:',
    row.transcriptSnippet,
  ].join('\n');
  const assistantContent = [
    row.agentAction,
    row.outcomeLabel ? `Outcome label: ${row.outcomeLabel}` : '',
  ].filter(Boolean).join('\n');
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
    metadata: {
      feedbackId: row.id,
      tenantId: row.tenantId,
      leadId: row.leadId,
      callId: row.callId,
      agentName: row.agentName,
      humanDecision: row.humanDecision,
      createdAt: row.createdAt,
    },
  };
}

function dedupeExamples(examples) {
  const seen = new Set();
  const deduped = [];
  for (const example of examples) {
    const key = `${example.metadata.feedbackId || ''}:${example.messages[1].content}:${example.messages[2].content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(example);
  }
  return deduped;
}

let source = 'bridge-state';
let rows = [];
try {
  const postgres = await loadFromPostgres();
  if (!postgres.skipped) {
    source = postgres.source;
    rows = postgres.rows;
  } else {
    const bridge = await loadFromBridgeState();
    source = bridge.source;
    rows = bridge.rows;
  }
} catch (error) {
  if (!databaseUrl) throw error;
  console.warn(`[ava-training-export] PostgreSQL export failed, falling back to bridge state: ${error?.message || error}`);
  const bridge = await loadFromBridgeState();
  source = bridge.source;
  rows = bridge.rows;
}

const rejected = [];
const examples = dedupeExamples(
  rows
    .filter((row) => {
      const ok = row.transcriptSnippet.length >= minChars && row.agentAction.length >= minChars;
      if (!ok) rejected.push({ id: row.id, reason: 'missing transcript/action text' });
      return ok;
    })
    .map(buildExample),
);

mkdirSync(outputDir, { recursive: true });
const jsonlPath = path.join(outputDir, 'ava-training-data.jsonl');
const summaryPath = path.join(outputDir, 'ava-training-summary.json');
const previewPath = path.join(outputDir, 'ava-training-preview.redacted.json');

writeFileSync(jsonlPath, `${examples.map((example) => JSON.stringify(example)).join('\n')}${examples.length ? '\n' : ''}`, 'utf8');

const summary = {
  ok: true,
  source,
  tenantId,
  days,
  requestedLimit: limit,
  allowedDecisions: Array.from(allowedDecisions),
  rowsLoaded: rows.length,
  examplesWritten: examples.length,
  rejectedCount: rejected.length,
  output: {
    jsonlPath,
    summaryPath,
    previewPath,
  },
  safety: {
    providerWrites: false,
    modelPromotion: 'manual-only',
    note: 'This exporter prepares approved examples only. It does not fine-tune, change env vars, deploy, or send providers.',
  },
  generatedAt: new Date().toISOString(),
};

writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(
  previewPath,
  JSON.stringify(
    examples.slice(0, 5).map((example) => ({
      metadata: example.metadata,
      transcriptChars: example.messages[1].content.length,
      actionChars: example.messages[2].content.length,
      system: example.messages[0].content,
      userPreview: `${example.messages[1].content.slice(0, 120)}...`,
      assistantPreview: `${example.messages[2].content.slice(0, 120)}...`,
    })),
    null,
    2,
  ),
  'utf8',
);

console.log(JSON.stringify(summary, null, 2));
