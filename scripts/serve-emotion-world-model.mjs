import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EMOTION_KEYS = ['joy', 'sadness', 'anger', 'fear'];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeEmotionState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const values = {};
  let total = 0;
  for (const key of EMOTION_KEYS) {
    values[key] = Math.max(0, toNumber(source[key], 0));
    total += values[key];
  }
  if (total <= 0) {
    values.joy = 0.25;
    values.sadness = 0.25;
    values.anger = 0.25;
    values.fear = 0.25;
    total = 1;
  }
  for (const key of EMOTION_KEYS) {
    values[key] = Number((values[key] / total).toFixed(6));
  }
  let dominant = 'joy';
  for (const key of EMOTION_KEYS) {
    if (values[key] > values[dominant]) dominant = key;
  }
  return {
    ...values,
    dominant,
    intensity: values[dominant],
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function basenameOrEmpty(value = '') {
  return value ? path.basename(String(value)) : '';
}

function sanitizeOnnxRunner(runner = {}) {
  return {
    requested: Boolean(runner.requested),
    status: runner.status || 'not_requested',
    onnxFile: basenameOrEmpty(runner.onnxPath),
    metadataFile: basenameOrEmpty(runner.metadataPath),
    model: runner.metadata?.modelId || runner.metadata?.model || '',
    inputDim: runner.metadata?.inputDim || null,
    outputDim: runner.metadata?.outputDim || null,
    actionTypes: Array.isArray(runner.metadata?.actionTypes) ? runner.metadata.actionTypes : [],
    error: runner.error || '',
    missingDependencies: runner.missingDependencies || [],
  };
}

function predictNextEmotion(model = {}, body = {}) {
  const actionType = String(body.actionType || body.action_type || '').trim().toLowerCase();
  const currentEmotion = normalizeEmotionState(body.currentEmotion || body.emotionState || body.emotion);
  const profile = model.actionProfiles?.[actionType] || model.globalProfile || {};
  const meanDelta = profile.meanDelta || {};
  const next = {};
  for (const key of EMOTION_KEYS) {
    next[key] = Math.max(0, currentEmotion[key] + toNumber(meanDelta[key], 0));
  }
  const nextEmotion = normalizeEmotionState(next);
  const profileCount = Math.max(0, Number(profile.count || 0));
  const globalCount = Math.max(1, Number(model.sampleCount || model.globalProfile?.count || 1));
  return {
    ok: true,
    model: model.modelId || 'pbk-emotion-world-model',
    modelType: model.modelType || 'pbk-emotional-transition-regressor-v1',
    runner: 'json_baseline_fallback',
    nextEmotion,
    policyHint: actionType ? `model_selected_${actionType}` : 'model_selected_global_profile',
    confidence: Number(Math.max(0.45, Math.min(0.92, 0.55 + (profileCount / globalCount) * 0.25)).toFixed(4)),
    profile: {
      actionType: actionType || 'global',
      count: profileCount,
      averageReward: profile.averageReward ?? null,
    },
  };
}

function buildOnnxFeatureVector(metadata = {}, body = {}) {
  const currentEmotion = normalizeEmotionState(body.currentEmotion || body.emotionState || body.emotion);
  const actionType = String(body.actionType || body.action_type || '').trim().toLowerCase();
  const actionTypes = Array.isArray(metadata.actionTypes) ? metadata.actionTypes.map((item) => String(item).toLowerCase()) : [];
  const features = EMOTION_KEYS.map((key) => currentEmotion[key]);
  for (const candidate of actionTypes) {
    features.push(candidate === actionType ? 1 : 0);
  }
  return features;
}

async function loadOnnxRunner(onnxPath = '', metadataPath = '') {
  const normalizedOnnxPath = onnxPath ? path.resolve(String(onnxPath)) : '';
  const normalizedMetadataPath = metadataPath ? path.resolve(String(metadataPath)) : '';
  if (!normalizedOnnxPath) {
    return { requested: false, status: 'not_requested' };
  }
  let metadata = {};
  if (normalizedMetadataPath && existsSync(normalizedMetadataPath)) {
    metadata = JSON.parse(await readFile(normalizedMetadataPath, 'utf8'));
  }
  if (!existsSync(normalizedOnnxPath)) {
    return {
      requested: true,
      status: 'load_failed',
      onnxPath: normalizedOnnxPath,
      metadataPath: normalizedMetadataPath,
      metadata,
      error: 'ONNX artifact file does not exist.',
    };
  }
  let ort = null;
  try {
    ort = await import('onnxruntime-node');
  } catch (error) {
    return {
      requested: true,
      status: 'blocked_missing_dependencies',
      onnxPath: normalizedOnnxPath,
      metadataPath: normalizedMetadataPath,
      metadata,
      missingDependencies: ['onnxruntime-node'],
      error: error?.message || 'onnxruntime-node is not installed.',
    };
  }
  try {
    const session = await ort.InferenceSession.create(normalizedOnnxPath);
    return {
      requested: true,
      status: 'ready',
      onnxPath: normalizedOnnxPath,
      metadataPath: normalizedMetadataPath,
      metadata,
      ort,
      session,
      inputName: session.inputNames?.[0] || 'features',
      outputName: session.outputNames?.[0] || 'nextEmotion',
    };
  } catch (error) {
    return {
      requested: true,
      status: 'load_failed',
      onnxPath: normalizedOnnxPath,
      metadataPath: normalizedMetadataPath,
      metadata,
      error: error?.message || 'Failed to load ONNX artifact.',
    };
  }
}

async function predictWithOnnx(runner = {}, model = {}, body = {}) {
  if (runner.status !== 'ready' || !runner.session || !runner.ort) {
    return predictNextEmotion(model, body);
  }
  try {
    const features = buildOnnxFeatureVector(runner.metadata || {}, body);
    const tensor = new runner.ort.Tensor('float32', Float32Array.from(features), [1, features.length]);
    const outputs = await runner.session.run({ [runner.inputName]: tensor });
    const output = outputs[runner.outputName] || Object.values(outputs)[0];
    const values = Array.from(output?.data || []);
    const nextEmotion = normalizeEmotionState({
      joy: values[0],
      sadness: values[1],
      anger: values[2],
      fear: values[3],
    });
    const actionType = String(body.actionType || body.action_type || '').trim().toLowerCase();
    return {
      ok: true,
      model: runner.metadata?.modelId || model.modelId || 'pbk-emotion-world-model-onnx',
      modelType: 'pbk-emotional-transition-onnx-v1',
      runner: 'onnxruntime-node',
      nextEmotion,
      policyHint: actionType ? `model_selected_${actionType}` : 'model_selected_onnx_profile',
      confidence: 0.86,
      profile: {
        actionType: actionType || 'onnx',
        count: null,
        averageReward: null,
      },
    };
  } catch (error) {
    return {
      ...predictNextEmotion(model, body),
      runner: 'json_baseline_fallback',
      onnxError: error?.message || 'ONNX inference failed; JSON baseline fallback used.',
    };
  }
}

async function main() {
  const args = parseArgs();
  const modelPath = args.model ? path.resolve(String(args.model)) : '';
  if (!modelPath) throw new Error('Missing --model <emotion-world-model.json>.');
  const onnxPath = args.onnx ? path.resolve(String(args.onnx)) : '';
  const metadataPath = args.metadata ? path.resolve(String(args.metadata)) : '';
  const host = String(args.host || process.env.PBK_EMOTION_WORLD_MODEL_HOST || '127.0.0.1');
  const port = Number(args.port || process.env.PBK_EMOTION_WORLD_MODEL_PORT || 8789);
  const model = JSON.parse(await readFile(modelPath, 'utf8'));
  const onnxRunner = await loadOnnxRunner(onnxPath, metadataPath);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, {
          ok: true,
          result: 'emotion_world_model_server_ready',
          model: model.modelId,
          modelType: model.modelType,
          sampleCount: model.sampleCount,
          onnxReady: Boolean(model.onnxReady),
          onnxRunner: sanitizeOnnxRunner(onnxRunner),
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/predict') {
        const body = await readRequestBody(request);
        sendJson(response, 200, await predictWithOnnx(onnxRunner, model, body));
        return;
      }
      sendJson(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error?.message || 'emotion world model error' });
    }
  });

  server.listen(port, host, () => {
    console.log(JSON.stringify({
      ok: true,
      result: 'emotion_world_model_server_ready',
      url: `http://${host}:${port}`,
      model: model.modelId,
      modelType: model.modelType,
      onnxRunner: sanitizeOnnxRunner(onnxRunner),
    }));
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
