import pg from 'pg';

import { createSkillCandidate } from './skill-governance-store.mjs';

const { Pool } = pg;

const DEFAULT_WINDOW_DAYS = 7;
const MIN_SUCCESS_COUNT_TO_BOOST = 5;
const MIN_SUCCESS_RATE_TO_BOOST = 0.8;
const MIN_FAILURE_COUNT_TO_DECAY = 3;
const MAX_SUCCESS_RATE_TO_KEEP = 0.5;
const CONFIDENCE_INCREMENT = 0.05;
const CONFIDENCE_DECAY_RATE = 0.05;
const MAX_CONFIDENCE = 0.95;
const MAX_TRANSCRIPT_CHARS = 4000;
const DATABASE_REQUIRED_MESSAGE = 'PBK_DATABASE_URL/DATABASE_URL is required for the Auto Skill Learner.';

function getDatabaseUrl(env = process.env) {
  return String(env.PBK_DATABASE_URL || env.DATABASE_URL || '').trim();
}

function assertSkillLearnerDatabaseConfigured(env = process.env) {
  const connectionString = getDatabaseUrl(env);
  if (!connectionString) throw new Error(DATABASE_REQUIRED_MESSAGE);
  return connectionString;
}

function createPool(options = {}) {
  const env = options.env || process.env;
  const connectionString = options.connectionString || assertSkillLearnerDatabaseConfigured(env);
  return new Pool({
    connectionString,
    max: 2,
    ssl: /(localhost|127\.0\.0\.1)/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
}

function hasSkillLearnerLlmProvider(env = process.env) {
  return Boolean(
    String(
      env.OPENAI_API_KEY ||
        env.ANTHROPIC_API_KEY ||
        env.GEMINI_API_KEY ||
        env.GOOGLE_API_KEY ||
        env.DEEPSEEK_API_KEY ||
        env.MISTRAL_API_KEY ||
        env.OPENROUTER_API_KEY ||
        env.PBK_LLM_PROVIDER_URL ||
        env.PBK_STRATEGIST_URL ||
        '',
    ).trim(),
  );
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return Math.max(0.05, Math.min(MAX_CONFIDENCE, numeric));
}

function safeJson(value) {
  return JSON.stringify(value && typeof value === 'object' ? value : {});
}

function extractJsonObject(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function transcriptToText(transcript) {
  if (Array.isArray(transcript)) {
    return transcript
      .map((turn) => `${turn.speaker || turn.role || 'speaker'}: ${turn.text || turn.content || ''}`.trim())
      .filter(Boolean)
      .join('\n');
  }
  if (transcript && typeof transcript === 'object') return JSON.stringify(transcript);
  return String(transcript || '');
}

function prepareSkillExtractionTranscript(transcript, options = {}) {
  const maxChars = Math.max(500, Math.min(16000, Number(options.maxChars || MAX_TRANSCRIPT_CHARS)));
  const rawText = transcriptToText(transcript);
  const truncated = rawText.length > maxChars;
  return {
    text: truncated ? rawText.slice(0, maxChars) : rawText,
    originalLength: rawText.length,
    maxChars,
    truncated,
    warning: truncated ? `Skill extraction transcript truncated to ${maxChars} characters from ${rawText.length}.` : '',
  };
}

async function ensureAutoSkillSchema(pool) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS public.skill_usage (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      skill_id TEXT,
      skill_name TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'unknown',
      success BOOLEAN,
      confidence NUMERIC,
      profit_margin NUMERIC,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.skills (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      agent_id TEXT NOT NULL DEFAULT '',
      agent_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'self-learned',
      level TEXT NOT NULL DEFAULT 'candidate',
      status TEXT NOT NULL DEFAULT 'active',
      confidence NUMERIC NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.coach_memory (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      memory_type TEXT NOT NULL DEFAULT 'general',
      objection_tag TEXT NOT NULL DEFAULT '',
      path_key TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      response TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'bridge',
      source_url TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'observed',
      score NUMERIC NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.probe_questions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL DEFAULT 'pbk',
      signal_keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      question_text TEXT NOT NULL DEFAULT '',
      follow_up_depth INT NOT NULL DEFAULT 1,
      priority INT NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS skill_usage_recent_idx
      ON public.skill_usage (workspace_id, skill_id, used_at DESC);
    CREATE INDEX IF NOT EXISTS skills_confidence_idx
      ON public.skills (workspace_id, status, confidence DESC);
  `);
}

async function boostSuccessfulSkills(pool, options = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(options.windowDays || DEFAULT_WINDOW_DAYS)));
  const minUses = Math.max(1, Number(options.minSuccessCount || MIN_SUCCESS_COUNT_TO_BOOST));
  const minRate = Math.max(0, Math.min(1, Number(options.minSuccessRate || MIN_SUCCESS_RATE_TO_BOOST)));
  const stats = await pool.query(
    `SELECT
       COALESCE(skill_id, '') AS skill_id,
       COALESCE(NULLIF(skill_name, ''), COALESCE(skill_id, 'unknown')) AS skill_name,
       COUNT(*)::int AS total_uses,
       COUNT(*) FILTER (WHERE success IS TRUE)::int AS successes
     FROM public.skill_usage
     WHERE workspace_id = 'pbk'
       AND used_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND (skill_id IS NOT NULL OR skill_name <> '')
     GROUP BY COALESCE(skill_id, ''), COALESCE(NULLIF(skill_name, ''), COALESCE(skill_id, 'unknown'))
     HAVING COUNT(*) FILTER (WHERE success IS TRUE) >= $2
     ORDER BY successes DESC
     LIMIT 100`,
    [windowDays, minUses],
  );

  const boosted = [];
  for (const row of stats.rows || []) {
    const rate = row.total_uses ? row.successes / row.total_uses : 0;
    if (rate < minRate) continue;
    let update;
    if (row.skill_id) {
      update = await pool.query(
        `UPDATE public.skills
         SET confidence = LEAST($2::numeric, COALESCE(confidence, 0) + $3::numeric),
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, confidence`,
        [
          row.skill_id,
          MAX_CONFIDENCE,
          CONFIDENCE_INCREMENT,
          safeJson({ autoLearner: { boostedAt: new Date().toISOString(), successRate: rate, uses: row.total_uses } }),
        ],
      );
    }
    if (!update?.rows?.[0] && row.skill_name) {
      update = await pool.query(
        `UPDATE public.skills
         SET confidence = LEAST($2::numeric, COALESCE(confidence, 0) + $3::numeric),
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE workspace_id = 'pbk' AND LOWER(name) = LOWER($1)
         RETURNING id, name, confidence`,
        [
          row.skill_name,
          MAX_CONFIDENCE,
          CONFIDENCE_INCREMENT,
          safeJson({ autoLearner: { boostedAt: new Date().toISOString(), successRate: rate, uses: row.total_uses } }),
        ],
      );
    }
    if (update?.rows?.[0]) {
      boosted.push({
        ...update.rows[0],
        totalUses: row.total_uses,
        successes: row.successes,
        successRate: Number(rate.toFixed(3)),
      });
    }
  }
  return boosted;
}

async function decayUnderperformingSkills(pool, options = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(options.windowDays || DEFAULT_WINDOW_DAYS)));
  const minFailures = Math.max(1, Number(options.minFailureCount || MIN_FAILURE_COUNT_TO_DECAY));
  const maxSuccessRate = Math.max(0, Math.min(1, Number(options.maxSuccessRateToKeep ?? MAX_SUCCESS_RATE_TO_KEEP)));
  const decayRate = Math.max(0.01, Math.min(0.5, Number(options.confidenceDecayRate || CONFIDENCE_DECAY_RATE)));
  const stats = await pool.query(
    `SELECT
       COALESCE(su.skill_id, '') AS skill_id,
       COALESCE(NULLIF(su.skill_name, ''), COALESCE(su.skill_id, 'unknown')) AS skill_name,
       COUNT(*)::int AS total_uses,
       COUNT(*) FILTER (WHERE su.success IS TRUE)::int AS successes,
       COUNT(*) FILTER (WHERE su.success IS FALSE)::int AS failures,
       MAX(COALESCE(s.confidence, su.confidence, 0.6))::numeric AS current_confidence
     FROM public.skill_usage su
     LEFT JOIN public.skills s ON s.id = su.skill_id
     WHERE su.workspace_id = 'pbk'
       AND su.used_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND (su.skill_id IS NOT NULL OR su.skill_name <> '')
     GROUP BY COALESCE(su.skill_id, ''), COALESCE(NULLIF(su.skill_name, ''), COALESCE(su.skill_id, 'unknown'))
     HAVING COUNT(*) FILTER (WHERE su.success IS FALSE) >= $2
     ORDER BY failures DESC
     LIMIT 100`,
    [windowDays, minFailures],
  );

  const decayed = [];
  for (const row of stats.rows || []) {
    const successes = Number(row.successes || 0);
    const totalUses = Number(row.total_uses || 0);
    const failures = Number(row.failures || 0);
    const successRate = totalUses ? successes / totalUses : 0;
    if (successRate > maxSuccessRate) continue;
    const currentConfidence = clampConfidence(row.current_confidence ?? 0.6);
    let update;
    if (row.skill_id) {
      update = await pool.query(
        `UPDATE public.skills
         SET confidence = GREATEST(0.05, COALESCE(confidence, $2::numeric) * (1 - $3::numeric)),
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, confidence`,
        [
          row.skill_id,
          currentConfidence,
          decayRate,
          safeJson({ autoLearner: { decayedAt: new Date().toISOString(), successRate, uses: totalUses, failures } }),
        ],
      );
    }
    if (!update?.rows?.[0] && row.skill_name) {
      update = await pool.query(
        `UPDATE public.skills
         SET confidence = GREATEST(0.05, COALESCE(confidence, $2::numeric) * (1 - $3::numeric)),
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
             updated_at = NOW()
         WHERE workspace_id = 'pbk' AND LOWER(name) = LOWER($1)
         RETURNING id, name, confidence`,
        [
          row.skill_name,
          currentConfidence,
          decayRate,
          safeJson({ autoLearner: { decayedAt: new Date().toISOString(), successRate, uses: totalUses, failures } }),
        ],
      );
    }
    if (update?.rows?.[0]) {
      decayed.push({
        ...update.rows[0],
        totalUses,
        failures,
        successRate: Number(successRate.toFixed(3)),
      });
    }
  }
  return decayed;
}

async function extractSkillCandidate(call, strategist, options = {}) {
  const prepared = prepareSkillExtractionTranscript(call.transcript, {
    maxChars: options.maxTranscriptChars || MAX_TRANSCRIPT_CHARS,
  });
  const transcript = prepared.text;
  if (!transcript) return null;
  if (typeof strategist === 'function') {
    const prompt = [
      'Extract exactly one reusable PBK acquisition skill from this successful call.',
      'Return JSON only with: skill_name, skill_type (objection_handler|probe|closing_tactic), trigger_keywords, content, confidence.',
      `Call ID: ${call.id}`,
      prepared.warning ? `Warning: ${prepared.warning}` : '',
      `Transcript:\n${transcript}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await strategist({ prompt, role: 'Auto Skill Learner', responseFormat: 'json' });
    const parsed = extractJsonObject(result?.rawAnswer || result?.answer || result?.text || result?.response?.raw || JSON.stringify(result?.response || result || {}));
    if (parsed?.skill_name && parsed?.content) {
      return {
        ...parsed,
        metadata: {
          ...(parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}),
          transcriptTruncated: prepared.truncated,
          transcriptOriginalLength: prepared.originalLength,
        },
      };
    }
  }

  const objection = transcript.match(/\b(too expensive|think about it|talk to (?:my )?(?:wife|husband|spouse|partner)|send me|call me later|not interested)\b/i)?.[0] || 'successful seller hesitation';
  return {
    skill_name: `Auto-learned ${objection}`.slice(0, 80),
    skill_type: 'objection_handler',
    trigger_keywords: [objection],
    content: 'Acknowledge the concern, ask one clarifying question, then reconnect the seller to their stated timeline and cost of delay.',
    confidence: 0.62,
    metadata: {
      transcriptTruncated: prepared.truncated,
      transcriptOriginalLength: prepared.originalLength,
    },
  };
}

async function insertSkillCandidate(pool, candidate, callId, options = {}) {
  const name = String(candidate.skill_name || candidate.name || '').trim().slice(0, 120);
  const instructions = String(candidate.content || candidate.response || candidate.question || '').trim();
  if (!name || !instructions) return null;
  const keywords = Array.isArray(candidate.trigger_keywords)
    ? candidate.trigger_keywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const skillType = String(candidate.skill_type || 'closing_tactic').trim() || 'closing_tactic';
  const createCandidate = options.createCandidate || createSkillCandidate;
  const slug = `auto-${String(callId || 'unknown')}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return createCandidate(pool, {
    workspaceId: 'pbk',
    slug,
    displayName: name,
    ownerId: 'ava',
    agentId: 'ava',
    riskClass: 'medium',
    source: 'auto_learner',
    instructions,
    triggerPolicy: {
      keywords,
      skillType,
      confidence: clampConfidence(candidate.confidence ?? 0.65),
    },
    sourceProvenance: {
      sourceSystem: 'successful_call',
      sourceId: String(callId || ''),
      extractorVersion: 'auto-skill-learner-v2',
    },
    safetyScan: { status: 'pending' },
    createdBy: 'auto-skill-learner',
  });
}

async function generateNewSkillsFromSuccess(pool, options = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(options.windowDays || DEFAULT_WINDOW_DAYS)));
  const limit = Math.max(1, Math.min(25, Number(options.limit || 10)));
  const calls = await pool.query(
    `SELECT id, lead_id, transcript, outcome, created_at
     FROM public.calls
     WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND (
         LOWER(COALESCE(outcome, '')) IN ('offer_accepted','closed','won','appointment_set')
         OR LOWER(COALESCE(status, '')) IN ('closed','won','completed')
       )
       AND transcript IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [windowDays, limit],
  ).catch(() => ({ rows: [] }));

  const created = [];
  for (const call of calls.rows || []) {
    const candidate = await extractSkillCandidate(call, options.strategist, options).catch(() => null);
    if (!candidate) continue;
    const inserted = await insertSkillCandidate(pool, candidate, call.id).catch((error) => ({
      ok: false,
      error: error?.message || String(error),
      candidate: candidate.skill_name || candidate.name || '',
    }));
    if (inserted) created.push(inserted);
  }
  return created;
}

export async function runAutoSkillLearner(options = {}) {
  const env = options.env || process.env;
  const pool = options.pool || createPool({ env });
  const ownsPool = !options.pool && Boolean(pool);
  try {
    await ensureAutoSkillSchema(pool);
    const boosted = await boostSuccessfulSkills(pool, options);
    const decayed = await decayUnderperformingSkills(pool, options);
    const llmAvailable = hasSkillLearnerLlmProvider(env);
    const created = llmAvailable ? await generateNewSkillsFromSuccess(pool, options) : [];
    const extractionSkippedReason = llmAvailable ? '' : 'llm_provider_unavailable';
    const reloadResult = null;
    return {
      ok: true,
      result: 'auto_skill_learner_complete',
      boostedCount: boosted.length,
      decayedCount: decayed.length,
      createdCount: created.length,
      requiresReviewCount: created.length,
      extractionSkippedReason,
      boosted,
      decayed,
      created,
      reloadResult,
    };
  } finally {
    if (ownsPool) await pool.end().catch(() => {});
  }
}

export {
  assertSkillLearnerDatabaseConfigured,
  boostSuccessfulSkills,
  clampConfidence,
  createPool,
  decayUnderperformingSkills,
  extractSkillCandidate,
  generateNewSkillsFromSuccess,
  getDatabaseUrl,
  hasSkillLearnerLlmProvider,
  insertSkillCandidate,
  prepareSkillExtractionTranscript,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runAutoSkillLearner()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
