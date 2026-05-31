import pg from 'pg';

const { Pool } = pg;

const DEFAULT_WINDOW_DAYS = 7;
const MIN_SUCCESS_COUNT_TO_BOOST = 5;
const MIN_SUCCESS_RATE_TO_BOOST = 0.8;
const CONFIDENCE_INCREMENT = 0.05;
const MAX_CONFIDENCE = 0.95;

function getDatabaseUrl() {
  return String(process.env.PBK_DATABASE_URL || process.env.DATABASE_URL || '').trim();
}

function createPool() {
  const connectionString = getDatabaseUrl();
  if (!connectionString) return null;
  return new Pool({
    connectionString,
    max: 2,
    ssl: /(localhost|127\.0\.0\.1)/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
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

async function extractSkillCandidate(call, strategist) {
  const transcript = transcriptToText(call.transcript).slice(0, 7000);
  if (!transcript) return null;
  if (typeof strategist === 'function') {
    const prompt = [
      'Extract exactly one reusable PBK acquisition skill from this successful call.',
      'Return JSON only with: skill_name, skill_type (objection_handler|probe|closing_tactic), trigger_keywords, content, confidence.',
      `Call ID: ${call.id}`,
      `Transcript:\n${transcript}`,
    ].join('\n\n');
    const result = await strategist({ prompt, role: 'Auto Skill Learner', responseFormat: 'json' });
    const parsed = extractJsonObject(result?.rawAnswer || result?.answer || result?.text || result?.response?.raw || JSON.stringify(result?.response || result || {}));
    if (parsed?.skill_name && parsed?.content) return parsed;
  }

  const objection = transcript.match(/\b(too expensive|think about it|talk to (?:my )?(?:wife|husband|spouse|partner)|send me|call me later|not interested)\b/i)?.[0] || 'successful seller hesitation';
  return {
    skill_name: `Auto-learned ${objection}`.slice(0, 80),
    skill_type: 'objection_handler',
    trigger_keywords: [objection],
    content: 'Acknowledge the concern, ask one clarifying question, then reconnect the seller to their stated timeline and cost of delay.',
    confidence: 0.62,
  };
}

async function insertSkillCandidate(pool, candidate, callId) {
  const name = String(candidate.skill_name || candidate.name || '').trim().slice(0, 120);
  const content = String(candidate.content || candidate.response || candidate.question || '').trim();
  if (!name || !content) return null;
  const keywords = Array.isArray(candidate.trigger_keywords)
    ? candidate.trigger_keywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const confidence = clampConfidence(candidate.confidence ?? 0.65);
  const type = String(candidate.skill_type || 'closing_tactic').trim();

  if (type === 'objection_handler') {
    const result = await pool.query(
      `INSERT INTO public.coach_memory (
         workspace_id, memory_type, objection_tag, prompt, response, source, outcome, score, metadata, created_at, updated_at
       )
       VALUES ('pbk','objection',$1,$2,$3,'auto_learner','approved',$4,$5::jsonb,NOW(),NOW())
       RETURNING id, objection_tag AS name, score AS confidence`,
      [
        name,
        `Seller says: ${keywords.join(' or ') || name}`,
        content,
        confidence,
        safeJson({ sourceCallId: callId, triggerKeywords: keywords }),
      ],
    );
    return { table: 'coach_memory', ...result.rows[0] };
  }

  if (type === 'probe') {
    const result = await pool.query(
      `INSERT INTO public.probe_questions (
         workspace_id, signal_keywords, question_text, follow_up_depth, priority, metadata, created_at
       )
       VALUES ('pbk',$1::text[],$2,1,75,$3::jsonb,NOW())
       RETURNING id, question_text AS name, priority AS confidence`,
      [keywords, content, safeJson({ sourceCallId: callId, autoLearnerConfidence: confidence })],
    );
    return { table: 'probe_questions', ...result.rows[0] };
  }

  const result = await pool.query(
    `INSERT INTO public.skills (
       workspace_id, agent_id, agent_name, name, source, level, status, confidence, evidence, metadata, created_at, updated_at
     )
     VALUES ('pbk','ava','Ava',$1,'auto_learner','candidate','active',$2,$3,$4::jsonb,NOW(),NOW())
     ON CONFLICT DO NOTHING
     RETURNING id, name, confidence`,
    [name, confidence, `Extracted from successful call ${callId}`, safeJson({ sourceCallId: callId, triggerKeywords: keywords, content })],
  );
  return result.rows[0] ? { table: 'skills', ...result.rows[0] } : null;
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
    const candidate = await extractSkillCandidate(call, options.strategist).catch(() => null);
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
  const pool = options.pool || createPool();
  const ownsPool = !options.pool && Boolean(pool);
  if (!pool) return { ok: false, result: 'postgres_unavailable', error: 'PBK_DATABASE_URL/DATABASE_URL is not configured.' };
  try {
    await ensureAutoSkillSchema(pool);
    const boosted = await boostSuccessfulSkills(pool, options);
    const created = await generateNewSkillsFromSuccess(pool, options);
    return {
      ok: true,
      result: 'auto_skill_learner_complete',
      boostedCount: boosted.length,
      createdCount: created.length,
      boosted,
      created,
    };
  } finally {
    if (ownsPool) await pool.end().catch(() => {});
  }
}

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
