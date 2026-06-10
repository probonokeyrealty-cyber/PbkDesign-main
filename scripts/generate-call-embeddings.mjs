import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  createTextEmbedding,
  getEmbeddingProviderConfig,
} from './vector-embedding.mjs';
import {
  isExcludedEpisodicCall,
  selectBestEpisodicTranscript,
} from './ava-episodic-memory.mjs';

const { Pool } = pg;

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

function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const entry = argv[i];
    if (!entry.startsWith('--')) {
      args._.push(entry);
      continue;
    }
    const [key, inlineValue] = entry.slice(2).split(/=(.*)/s).filter(Boolean);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sha256(value = '') {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function inferOutcome(call = {}) {
  const status = String(call.status || '').trim().toLowerCase();
  const notes = String(call.notes || '').trim().toLowerCase();
  const haystack = `${status} ${notes}`;
  if (/\b(contract|signed|closed|accepted|won|appointment|transferring|qualified)\b/.test(haystack)) return 'successful';
  if (/\b(no[_ -]?show|lost|dead|failed|dnc|blocked|rejected)\b/.test(haystack)) return 'unsuccessful';
  if (status) return status;
  return 'unknown';
}

function vectorLiteral(embedding = []) {
  return `[${embedding.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : '0';
  }).join(',')}]`;
}

hydrateLocalRuntimeEnv();

const args = parseArgs();
const databaseUrl = String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const apiKey = String(process.env.PBK_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
const baseUrl = String(process.env.PBK_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com').trim().replace(/\/+$/g, '');
const embeddingConfig = getEmbeddingProviderConfig();
const model = embeddingConfig.configuredModel;
const limit = Math.max(1, Math.min(500, toNumber(args.limit || process.env.PBK_CALL_EMBEDDINGS_LIMIT, 100)));
const minChars = Math.max(24, Math.min(2000, toNumber(args.minChars || process.env.PBK_CALL_EMBEDDINGS_MIN_CHARS, 80)));
const timeoutMs = Math.max(1000, Math.min(60000, toNumber(args.timeoutMs || process.env.PBK_OPENAI_EMBEDDING_TIMEOUT_MS, 15000)));
const force = args.force === true || /^(1|true|yes|on)$/i.test(String(args.force || process.env.PBK_CALL_EMBEDDINGS_FORCE || '').trim());
const dryRun = args.dryRun === true || /^(1|true|yes|on)$/i.test(String(args.dryRun || process.env.PBK_CALL_EMBEDDINGS_DRY_RUN || '').trim());

if (!databaseUrl) {
  console.error('Missing PBK_DATABASE_URL or DATABASE_URL. Run migrations and backfill against an explicit database target.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  ssl: /(localhost|127\.0\.0\.1)/.test(databaseUrl)
    ? false
    : { rejectUnauthorized: false },
});

async function loadCandidateCalls() {
  const result = await pool.query(
    `SELECT c.id, c.lead_id, c.workspace_id, c.status, c.provider, c.assistant_id,
            c.sentiment, c.transcript, c.notes, c.started_at, c.ended_at, c.created_at, c.updated_at
     FROM public.calls c
     LEFT JOIN public.call_embeddings ce
       ON ce.workspace_id = COALESCE(NULLIF(c.workspace_id, ''), 'pbk')
      AND ce.call_id = c.id
      AND ce.embedding_model = $1
     WHERE ($2::boolean IS TRUE OR ce.id IS NULL)
       AND c.transcript IS NOT NULL
     ORDER BY COALESCE(c.ended_at, c.updated_at, c.created_at, NOW()) DESC
     LIMIT $3`,
    [model, force, limit],
  );
  return result.rows || [];
}

async function upsertCallEmbedding(call, sourceText, embedding) {
  const workspaceId = call.workspace_id || 'pbk';
  const transcriptHash = sha256(sourceText);
  const outcome = inferOutcome(call);
  const metadata = {
    source: 'generate-call-embeddings',
    status: call.status || '',
    notesPreview: String(call.notes || '').slice(0, 500),
    startedAt: call.started_at || '',
    endedAt: call.ended_at || '',
    transcriptChars: sourceText.length,
  };
  if (dryRun) {
    return { ok: true, dryRun: true, outcome, transcriptHash };
  }
  await pool.query(
    `INSERT INTO public.call_embeddings (
       workspace_id, call_id, lead_id, outcome, sentiment, source_text,
       transcript_hash, embedding_model, embedding, synthetic, metadata, created_at, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,FALSE,$10::jsonb,NOW(),NOW())
     ON CONFLICT (workspace_id, call_id, embedding_model) DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       outcome = EXCLUDED.outcome,
       sentiment = EXCLUDED.sentiment,
       source_text = EXCLUDED.source_text,
       transcript_hash = EXCLUDED.transcript_hash,
       embedding = EXCLUDED.embedding,
       synthetic = EXCLUDED.synthetic,
       metadata = public.call_embeddings.metadata || EXCLUDED.metadata,
       updated_at = NOW()`,
    [
      workspaceId,
      call.id,
      call.lead_id || '',
      outcome,
      call.sentiment === null || call.sentiment === undefined ? null : Number(call.sentiment),
      sourceText.slice(0, 12000),
      transcriptHash,
      model,
      vectorLiteral(embedding),
      JSON.stringify(metadata),
    ],
  );
  return { ok: true, outcome, transcriptHash };
}

async function main() {
  const calls = await loadCandidateCalls();
  const summary = {
    ok: true,
    result: 'call_embeddings_generated',
    provider: embeddingConfig.provider,
    model,
    dryRun,
    limit,
    candidates: calls.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const call of calls) {
    if (isExcludedEpisodicCall(call)) {
      summary.skipped += 1;
      continue;
    }
    const sourceText = selectBestEpisodicTranscript([call.transcript, call.notes]);
    if (sourceText.length < minChars) {
      summary.skipped += 1;
      continue;
    }
    try {
      const embeddingResult = await createTextEmbedding(sourceText, {
        provider: embeddingConfig.provider,
        openAiApiKey: apiKey,
        openAiBaseUrl: baseUrl,
        openAiModel: embeddingConfig.openAiModel,
        localModel: embeddingConfig.localModel,
        timeoutMs,
      });
      if (!embeddingResult.ok) {
        throw new Error(
          embeddingResult.error ||
            embeddingResult.result ||
            'Embedding generation failed.'
        );
      }
      const { embedding } = embeddingResult;
      await upsertCallEmbedding(call, sourceText, embedding);
      summary.processed += 1;
      console.log(JSON.stringify({ ok: true, callId: call.id, leadId: call.lead_id || '', chars: sourceText.length }));
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({ callId: call.id, error: error?.message || String(error) });
      console.warn(JSON.stringify({ ok: false, callId: call.id, error: error?.message || String(error) }));
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

try {
  await main();
} finally {
  await pool.end();
}
