import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MIN_CALLS = 500;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_COOLDOWN_DAYS = 7;
const DEFAULT_LIMIT = 5000;
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), '.pbk-local', 'onnx-auto-training');

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isMissingDbShape(error) {
  const message = String(error?.message || error || '');
  return /relation .* does not exist|column .* does not exist|undefined_table|undefined_column/i.test(message);
}

function normalizeDecision(row = {}) {
  return {
    id: String(row.id || ''),
    actionType: String(row.action_type || row.actionType || ''),
    source: String(row.source || 'pbk_agent_decisions'),
    leadId: String(row.lead_id || row.leadId || ''),
    callId: String(row.call_id || row.callId || ''),
    context: row.context || {},
    parameters: row.parameters || {},
    emotionState: row.emotion_state || row.emotionState || {},
    outcome: row.outcome || {},
    reward: Number.isFinite(Number(row.reward)) ? Number(row.reward) : null,
    createdAt: row.created_at || row.createdAt || '',
  };
}

async function hasTranscriptColumn(pool) {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pbk_call_analyses'
          AND column_name = 'transcript'
      ) AS has_transcript_column
    `);
    return Boolean(result.rows?.[0]?.has_transcript_column);
  } catch (error) {
    if (isMissingDbShape(error)) return false;
    throw error;
  }
}

async function countRecentTranscriptCalls(pool, options = {}) {
  const tenantId = String(options.tenantId || options.tenant_id || 'pbk').trim() || 'pbk';
  const lookbackDays = Math.max(1, toInt(options.lookbackDays || options.lookback_days, DEFAULT_LOOKBACK_DAYS));
  const columnReady = await hasTranscriptColumn(pool);
  if (!columnReady) {
    return {
      ok: true,
      tenantId,
      recentCalls: 0,
      lookbackDays,
      hasTranscriptColumn: false,
      reason: 'pbk_call_analyses.transcript column unavailable',
    };
  }
  try {
    const since = new Date((options.now ? new Date(options.now).getTime() : Date.now()) - lookbackDays * 24 * 60 * 60 * 1000);
    const result = await pool.query(
      `
        SELECT COUNT(*)::int AS recent_call_count
        FROM public.pbk_call_analyses
        WHERE tenant_id = $1
          AND created_at > $2
          AND NULLIF(BTRIM(transcript), '') IS NOT NULL
          AND COALESCE(status, '') <> 'failed'
      `,
      [tenantId, since.toISOString()]
    );
    return {
      ok: true,
      tenantId,
      recentCalls: Number(result.rows?.[0]?.recent_call_count || 0),
      lookbackDays,
      hasTranscriptColumn: true,
      since: since.toISOString(),
    };
  } catch (error) {
    if (isMissingDbShape(error)) {
      return {
        ok: true,
        tenantId,
        recentCalls: 0,
        lookbackDays,
        hasTranscriptColumn: false,
        reason: error?.message || String(error),
      };
    }
    throw error;
  }
}

async function getLastTrainingAt(pool, options = {}) {
  const tenantId = String(options.tenantId || options.tenant_id || 'pbk').trim() || 'pbk';
  try {
    const result = await pool.query(
      `
        SELECT created_at AS last_training_at
        FROM public.pbk_tool_usage
        WHERE tenant_id = $1
          AND tool_name = 'trainEmotionWorldModel'
          AND success IS TRUE
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [tenantId]
    );
    return result.rows?.[0]?.last_training_at || '';
  } catch (error) {
    if (isMissingDbShape(error)) return '';
    throw error;
  }
}

async function recordTrainingUsage(pool, params = {}) {
  if (!pool) return { ok: false, reason: 'postgres_unavailable' };
  const tenantId = String(params.tenantId || params.tenant_id || 'pbk').trim() || 'pbk';
  try {
    await pool.query(
      `
        INSERT INTO public.pbk_tool_usage (
          tenant_id, agent_name, tool_name, intent, success, latency_ms,
          error_message, context, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
      `,
      [
        tenantId,
        'Rex ONNX Trainer',
        'trainEmotionWorldModel',
        params.intent || 'auto_training',
        params.success === undefined ? null : Boolean(params.success),
        params.latencyMs === undefined ? null : Math.max(0, Math.round(Number(params.latencyMs || 0))),
        String(params.error || '').slice(0, 500),
        JSON.stringify(params.context && typeof params.context === 'object' ? params.context : {}),
        params.createdAt || new Date().toISOString(),
      ]
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function buildTrainingStateFromAgentDecisions(pool, options = {}) {
  const tenantId = String(options.tenantId || options.tenant_id || 'pbk').trim() || 'pbk';
  const limit = Math.max(1, Math.min(10000, toInt(options.limit, DEFAULT_LIMIT)));
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          action_type,
          source,
          lead_id,
          call_id,
          context,
          parameters,
          emotion_state,
          outcome,
          reward,
          created_at
        FROM public.pbk_agent_decisions
        WHERE tenant_id = $1
          AND training_ready IS TRUE
          AND COALESCE(action_type, '') <> ''
          AND jsonb_typeof(emotion_state) = 'object'
          AND jsonb_typeof(outcome) = 'object'
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [tenantId, limit]
    );
    return (result.rows || []).map(normalizeDecision);
  } catch (error) {
    if (isMissingDbShape(error)) return [];
    throw error;
  }
}

function parseLastJsonObject(output = '') {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Trainer can emit non-JSON status lines; keep scanning older lines.
    }
  }
  return null;
}

export async function trainEmotionWorldModel(params = {}, options = {}) {
  const pool = options.pool || params.pool;
  if (!pool) return { ok: false, result: 'postgres_unavailable', error: 'Pool is required.' };
  const outDir = path.resolve(options.outDir || params.outDir || DEFAULT_OUT_DIR);
  const stateDir = path.join(outDir, 'state');
  await mkdir(stateDir, { recursive: true });
  const agentDecisions = await buildTrainingStateFromAgentDecisions(pool, params);
  const inputPath = path.join(stateDir, `auto-emotion-training-${Date.now()}.json`);
  await writeFile(
    inputPath,
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        source: params.source || 'auto_cron',
        tenantId: params.tenantId || params.tenant_id || 'pbk',
        recentCalls: params.recentCalls || params.recent_calls || 0,
        agentDecisions,
      },
      null,
      2
    )
  );
  const minSamples = Math.max(1, toInt(params.minSamples || params.min_samples || params.minCalls || params.min_calls, DEFAULT_MIN_CALLS));
  const modelOutDir = path.join(outDir, 'emotion-world-model');
  const args = [
    './scripts/train-emotion-world-model.mjs',
    '--input',
    inputPath,
    '--out-dir',
    modelOutDir,
    '--min-samples',
    String(minSamples),
    '--export-onnx',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
    timeout: Math.max(60_000, toInt(options.timeoutMs || params.timeoutMs || process.env.PBK_ONNX_AUTO_TRAIN_TIMEOUT_MS, 15 * 60_000)),
    maxBuffer: 1024 * 1024 * 8,
  });
  const manifest = parseLastJsonObject(result.stdout) || {};
  return {
    ok: result.status === 0,
    result: result.status === 0 ? 'emotion_world_model_export_checked' : 'emotion_world_model_export_failed',
    inputPath,
    outDir: modelOutDir,
    sampleCount: agentDecisions.length,
    status: result.status,
    signal: result.signal || '',
    manifest,
    stdoutTail: String(result.stdout || '').slice(-2000),
    stderrTail: String(result.stderr || result.error?.message || '').slice(-2000),
  };
}

export async function getEmotionTrainingStatus(pool, options = {}) {
  if (!pool) {
    return {
      ok: false,
      result: 'emotion_training_status',
      reason: 'postgres_unavailable',
      readiness: {
        ready: false,
        recentCalls: 0,
        minCalls: Math.max(1, toInt(options.minCalls || options.min_calls, DEFAULT_MIN_CALLS)),
      },
    };
  }
  const minCalls = Math.max(1, toInt(options.minCalls || options.min_calls, DEFAULT_MIN_CALLS));
  const now = options.now ? new Date(options.now) : new Date();
  const cooldownDays = Math.max(1, toInt(options.cooldownDays || options.cooldown_days, DEFAULT_COOLDOWN_DAYS));
  const recent = await countRecentTranscriptCalls(pool, { ...options, now });
  const lastTrainingAt = await getLastTrainingAt(pool, options);
  const lastTraining = lastTrainingAt ? new Date(lastTrainingAt) : null;
  const trainedWithinCooldown = Boolean(
    lastTraining && !Number.isNaN(lastTraining.getTime()) && now.getTime() - lastTraining.getTime() < cooldownDays * 24 * 60 * 60 * 1000
  );
  const ready = recent.recentCalls >= minCalls && recent.hasTranscriptColumn !== false;
  return {
    ok: true,
    result: 'emotion_training_status',
    checkedAt: now.toISOString(),
    lastTrainingAt: toIso(lastTrainingAt),
    trainedWithinCooldown,
    cooldownDays,
    readiness: {
      ready,
      eligible: ready && !trainedWithinCooldown,
      reason: ready ? '' : recent.reason || `only ${recent.recentCalls} recent calls`,
      tenantId: recent.tenantId,
      recentCalls: recent.recentCalls,
      minCalls,
      lookbackDays: recent.lookbackDays,
      hasTranscriptColumn: recent.hasTranscriptColumn,
      since: recent.since || '',
    },
  };
}

export async function runAutoTrainingIfReady(pool, options = {}) {
  const status = await getEmotionTrainingStatus(pool, options);
  if (status.ok === false) {
    return {
      trained: false,
      reason: status.reason || 'training_status_unavailable',
      status,
      readiness: status.readiness,
    };
  }
  if (!status.readiness.ready) {
    return {
      trained: false,
      reason: status.readiness.reason || `only ${status.readiness.recentCalls} recent calls`,
      status,
      readiness: status.readiness,
    };
  }
  if (status.trainedWithinCooldown) {
    return {
      trained: false,
      reason: `trained within last ${status.cooldownDays} days`,
      status,
      readiness: status.readiness,
    };
  }
  if (options.dryRun) {
    return {
      trained: false,
      reason: 'dry_run_auto_training_ready',
      status,
      readiness: status.readiness,
    };
  }

  const startedAt = Date.now();
  const trainer = options.trainEmotionWorldModel || trainEmotionWorldModel;
  try {
    const result = await trainer(
      {
        source: options.source || 'auto_cron',
        minCalls: status.readiness.minCalls,
        minSamples: options.minSamples || options.min_samples || status.readiness.minCalls,
        tenantId: status.readiness.tenantId,
        recentCalls: status.readiness.recentCalls,
      },
      { ...options, pool }
    );
    const success = result?.ok !== false;
    await recordTrainingUsage(pool, {
      tenantId: status.readiness.tenantId,
      success,
      latencyMs: Date.now() - startedAt,
      error: success ? '' : result?.error || result?.stderrTail || 'training_failed',
      createdAt: new Date(options.now || Date.now()).toISOString(),
      context: {
        source: options.source || 'auto_cron',
        recentCalls: status.readiness.recentCalls,
        minCalls: status.readiness.minCalls,
        result: result?.result || '',
      },
    });
    if (!success) {
      return {
        trained: false,
        reason: 'training_failed',
        result,
        status,
        readiness: status.readiness,
      };
    }
    return {
      trained: true,
      result,
      status,
      readiness: status.readiness,
    };
  } catch (error) {
    await recordTrainingUsage(pool, {
      tenantId: status.readiness.tenantId,
      success: false,
      latencyMs: Date.now() - startedAt,
      error: error?.message || String(error),
      createdAt: new Date(options.now || Date.now()).toISOString(),
      context: {
        source: options.source || 'auto_cron',
        recentCalls: status.readiness.recentCalls,
        minCalls: status.readiness.minCalls,
      },
    });
    return {
      trained: false,
      reason: 'training_failed',
      error: error?.message || String(error),
      status,
      readiness: status.readiness,
    };
  }
}
