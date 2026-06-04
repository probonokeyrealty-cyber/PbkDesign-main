import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const workerPath = path.resolve('scripts', 'onnx-training-worker.mjs');

function makePool({ recentCalls = 0, lastTrainingAt = null, hasTranscriptColumn = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/information_schema\.columns/i.test(sql)) {
        return { rows: [{ has_transcript_column: hasTranscriptColumn }] };
      }
      if (/ALTER TABLE public\.pbk_call_analyses/i.test(sql)) {
        hasTranscriptColumn = true;
        return { rows: [] };
      }
      if (/CREATE INDEX IF NOT EXISTS pbk_call_analyses_transcript_ready_idx/i.test(sql)) {
        return { rows: [] };
      }
      if (/COUNT\(\*\).*recent_call_count/is.test(sql)) {
        return { rows: [{ recent_call_count: recentCalls }] };
      }
      if (/FROM public\.pbk_tool_usage/i.test(sql) && /trainEmotionWorldModel/i.test(sql)) {
        return { rows: lastTrainingAt ? [{ last_training_at: lastTrainingAt }] : [] };
      }
      if (/INSERT INTO public\.pbk_tool_usage/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in smoke test: ${sql}`);
    },
  };
}

async function main() {
  try {
    await access(workerPath);
  } catch {
    assert.fail('scripts/onnx-training-worker.mjs should exist.');
  }

  const { getEmotionTrainingStatus, runAutoTrainingIfReady } = await import(
    pathToFileURL(workerPath).href
  );

  const lowData = await runAutoTrainingIfReady(makePool({ recentCalls: 499 }), {
    minCalls: 500,
    now: new Date('2026-06-03T12:00:00.000Z'),
    trainEmotionWorldModel: async () => assert.fail('trainer should not run below threshold'),
  });
  assert.equal(lowData.trained, false);
  assert.equal(lowData.readiness.recentCalls, 499);
  assert.match(lowData.reason, /only 499 recent calls/i);

  const recentlyTrained = await runAutoTrainingIfReady(
    makePool({ recentCalls: 600, lastTrainingAt: '2026-06-02T12:00:00.000Z' }),
    {
      minCalls: 500,
      now: new Date('2026-06-03T12:00:00.000Z'),
      trainEmotionWorldModel: async () => assert.fail('trainer should not rerun within cooldown'),
    }
  );
  assert.equal(recentlyTrained.trained, false);
  assert.match(recentlyTrained.reason, /trained within last 7 days/i);

  let trainerPayload = null;
  const readyPool = makePool({ recentCalls: 640 });
  const trained = await runAutoTrainingIfReady(readyPool, {
    minCalls: 500,
    now: new Date('2026-06-03T12:00:00.000Z'),
    trainEmotionWorldModel: async (payload) => {
      trainerPayload = payload;
      return { ok: true, result: 'emotion_world_model_export_checked', modelId: 'smoke-model' };
    },
  });
  assert.equal(trained.trained, true);
  assert.equal(trained.result.modelId, 'smoke-model');
  assert.equal(trainerPayload.source, 'auto_cron');
  assert.equal(trainerPayload.minCalls, 500);
  assert(
    readyPool.calls.some((call) => /INSERT INTO public\.pbk_tool_usage/i.test(call.sql)),
    'successful auto-training should record pbk_tool_usage for cooldown/status checks.'
  );

  const status = await getEmotionTrainingStatus(makePool({ recentCalls: 640 }), {
    minCalls: 500,
    now: new Date('2026-06-03T12:00:00.000Z'),
  });
  assert.equal(status.ok, true);
  assert.equal(status.result, 'emotion_training_status');
  assert.equal(status.readiness.ready, true);
  assert.equal(status.readiness.recentCalls, 640);

  const ensurePool = makePool({ recentCalls: 0, hasTranscriptColumn: false });
  const ensured = await getEmotionTrainingStatus(ensurePool, {
    ensureSchema: true,
    minCalls: 500,
    now: new Date('2026-06-03T12:00:00.000Z'),
  });
  assert.equal(ensured.readiness.hasTranscriptColumn, true);
  assert(
    ensurePool.calls.some((call) => /ALTER TABLE public\.pbk_call_analyses/i.test(call.sql)),
    'status checks with ensureSchema should add the transcript column before readiness queries.'
  );

  const cronSource = await readFile(path.resolve('scripts', 'nightly-learning-cron.mjs'), 'utf8');
  assert.match(cronSource, /runAutoTrainingIfReady/, 'nightly cron should call the ONNX auto-training worker.');
  assert.match(cronSource, /autoOnnxTraining/, 'nightly cron should return the auto-training result.');

  const bridgeSource = await readFile(path.resolve('scripts', 'openclaw-local-server.mjs'), 'utf8');
  assert.match(
    bridgeSource,
    /\/api\/emotion\/training\/status/,
    'bridge should expose GET /api/emotion/training/status.'
  );

  const dockerfile = await readFile(path.resolve('Dockerfile.openclaw'), 'utf8');
  assert.match(
    dockerfile,
    /COPY scripts\/onnx-training-worker\.mjs \.\/scripts\/onnx-training-worker\.mjs/,
    'Render bridge image should copy the ONNX worker imported by openclaw-local-server.mjs.'
  );

  console.log('ONNX training worker smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
