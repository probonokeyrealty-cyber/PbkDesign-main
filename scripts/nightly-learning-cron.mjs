import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createPool, runAutoSkillLearner } from './auto-skill-learner.mjs';

const DEFAULT_LIMIT = 1000;
const DEFAULT_MIN_SAMPLES = 500;
const NIGHTLY_OUT_DIR = path.resolve(process.cwd(), '.pbk-local', 'nightly-learning');

function envFlag(value = '') {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
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

async function loadEmotionTrainingState(pool, options = {}) {
  const limit = Math.max(1, Math.min(5000, toInt(options.limit, DEFAULT_LIMIT)));
  const rows = await pool
    .query(
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
        WHERE training_ready = TRUE
          AND COALESCE(action_type, '') <> ''
          AND jsonb_typeof(emotion_state) = 'object'
          AND jsonb_typeof(outcome) = 'object'
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit]
    )
    .catch((error) => {
      if (/relation .*pbk_agent_decisions.* does not exist/i.test(String(error?.message || error))) {
        return { rows: [], missingTable: true, error };
      }
      throw error;
    });

  return {
    agentDecisions: (rows.rows || []).map(normalizeDecision),
    missingTable: Boolean(rows.missingTable),
    error: rows.error?.message || '',
  };
}

async function writeTrainingState(state = {}, options = {}) {
  const outDir = path.resolve(options.outDir || NIGHTLY_OUT_DIR);
  await mkdir(outDir, { recursive: true });
  const statePath = path.join(outDir, 'emotion-training-state.json');
  await writeFile(statePath, JSON.stringify(state, null, 2));
  return statePath;
}

function runEmotionTrainer(statePath, options = {}) {
  const minSamples = Math.max(1, toInt(options.minSamples, DEFAULT_MIN_SAMPLES));
  const outDir = path.resolve(options.outDir || path.join(NIGHTLY_OUT_DIR, 'emotion-world-model'));
  const args = [
    './scripts/train-emotion-world-model.mjs',
    '--input',
    statePath,
    '--out-dir',
    outDir,
    '--min-samples',
    String(minSamples),
    '--export-onnx',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
    timeout: Math.max(60_000, toInt(process.env.PBK_NIGHTLY_EMOTION_TRAIN_TIMEOUT_MS, 10 * 60_000)),
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal || '',
    stdout: String(result.stdout || '').slice(-4000),
    stderr: String(result.stderr || result.error?.message || '').slice(-4000),
    command: `node ${args.join(' ')}`,
    outDir,
  };
}

export async function runNightlyLearningCron(options = {}) {
  const env = options.env || process.env;
  const dryRun = options.dryRun ?? envFlag(env.PBK_NIGHTLY_LEARNING_DRY_RUN);
  const databaseUrl = String(env.PBK_DATABASE_URL || env.DATABASE_URL || '').trim();
  const pool = options.pool || (databaseUrl ? createPool({ env }) : null);
  const ownsPool = !options.pool;
  const minSamples = Math.max(1, toInt(options.minSamples ?? env.PBK_NIGHTLY_EMOTION_MIN_SAMPLES, DEFAULT_MIN_SAMPLES));
  const limit = Math.max(minSamples, toInt(options.limit ?? env.PBK_NIGHTLY_EMOTION_LIMIT, DEFAULT_LIMIT));

  try {
    if (!pool) {
      if (dryRun) {
        return {
          ok: true,
          result: 'nightly_learning_dry_run_no_database',
          dryRun,
          skillLearner: {
            ok: true,
            result: 'dry_run_skill_learner_skipped',
            reason: 'postgres_unavailable',
          },
          emotionTraining: {
            ok: true,
            result: 'dry_run_emotion_training_skipped',
            reason: 'postgres_unavailable',
            sampleCount: 0,
            minSamples,
          },
        };
      }
      throw new Error('PBK_DATABASE_URL/DATABASE_URL is required for nightly learning.');
    }

    const skillLearner = dryRun
      ? { ok: true, result: 'dry_run_skill_learner_skipped' }
      : await runAutoSkillLearner({
          ...options,
          env,
          pool,
        });

    const trainingState = await loadEmotionTrainingState(pool, { limit });
    const sampleCount = trainingState.agentDecisions.length;
    const statePath = await writeTrainingState(
      {
        exportedAt: new Date().toISOString(),
        source: 'nightly-learning-cron',
        agentDecisions: trainingState.agentDecisions,
      },
      options
    );

    let emotionTraining = {
      ok: true,
      result: 'skipped_insufficient_samples',
      sampleCount,
      minSamples,
      statePath,
      missingTable: trainingState.missingTable,
      error: trainingState.error,
    };

    if (sampleCount >= minSamples) {
      emotionTraining = dryRun
        ? {
            ok: true,
            result: 'dry_run_emotion_training_ready',
            sampleCount,
            minSamples,
            statePath,
          }
        : runEmotionTrainer(statePath, { ...options, minSamples });
    }

    return {
      ok: skillLearner.ok !== false && emotionTraining.ok !== false,
      result: 'nightly_learning_complete',
      dryRun,
      skillLearner,
      emotionTraining,
    };
  } finally {
    if (ownsPool && pool) await pool.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNightlyLearningCron()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
