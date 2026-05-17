import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EMOTION_KEYS = ['joy', 'sadness', 'anger', 'fear'];
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'models', 'emotion-world-model');
const ONNX_EXPORTER_SCRIPT = path.resolve(process.cwd(), 'scripts', 'train_emotion_world_model_onnx.py');
const PYTHON_BIN = String(process.env.PBK_PYTHON || process.env.PYTHON || 'python').trim();

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

function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
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

function readNextEmotion(outcome = {}) {
  if (!outcome || typeof outcome !== 'object') return null;
  return outcome.nextEmotion
    || outcome.next_emotion
    || outcome.emotionAfter
    || outcome.emotion_after
    || outcome.emotionStateAfter
    || outcome.emotion_state_after
    || outcome.emotionState
    || outcome.emotion_state
    || null;
}

function extractSamples(state = {}) {
  const decisions = Array.isArray(state.agentDecisions) ? state.agentDecisions : [];
  const samples = [];
  for (const decision of decisions) {
    const actionType = String(decision?.actionType || decision?.action_type || '').trim().toLowerCase();
    const currentRaw = decision?.emotionState || decision?.emotion_state || decision?.context?.emotionState || decision?.context?.emotion_state;
    const nextRaw = readNextEmotion(decision?.outcome || {});
    if (!actionType || !currentRaw || !nextRaw) continue;
    const currentEmotion = normalizeEmotionState(currentRaw);
    const nextEmotion = normalizeEmotionState(nextRaw);
    const delta = {};
    for (const key of EMOTION_KEYS) {
      delta[key] = Number((nextEmotion[key] - currentEmotion[key]).toFixed(6));
    }
    samples.push({
      id: String(decision.id || `sample-${samples.length + 1}`),
      actionType,
      currentEmotion,
      nextEmotion,
      delta,
      reward: Number.isFinite(Number(decision.reward)) ? Number(decision.reward) : null,
      source: String(decision.source || 'agent_decisions'),
    });
  }
  return samples;
}

function average(items = [], selector = (item) => item) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + selector(item), 0) / items.length;
}

function buildProfile(samples = []) {
  const meanDelta = {};
  const meanNextEmotion = {};
  for (const key of EMOTION_KEYS) {
    meanDelta[key] = Number(average(samples, (sample) => sample.delta[key]).toFixed(6));
    meanNextEmotion[key] = Number(average(samples, (sample) => sample.nextEmotion[key]).toFixed(6));
  }
  const rewards = samples.map((sample) => sample.reward).filter((value) => Number.isFinite(value));
  return {
    count: samples.length,
    meanDelta,
    meanNextEmotion: normalizeEmotionState(meanNextEmotion),
    averageReward: rewards.length ? Number(average(rewards).toFixed(6)) : null,
  };
}

function buildModel(samples = []) {
  const actionTypes = [...new Set(samples.map((sample) => sample.actionType))].sort();
  const actionProfiles = {};
  for (const actionType of actionTypes) {
    actionProfiles[actionType] = buildProfile(samples.filter((sample) => sample.actionType === actionType));
  }
  const trainedAt = new Date().toISOString();
  return {
    ok: true,
    modelId: `pbk-emotion-world-model-${Date.now()}-${slugify(actionTypes.join('-') || 'baseline')}`,
    modelType: 'pbk-emotional-transition-regressor-v1',
    inputSchema: 'pbk-emotion-world-model-request-v1',
    outputSchema: 'pbk-emotion-world-model-response-v1',
    trainedAt,
    sampleCount: samples.length,
    emotionKeys: EMOTION_KEYS,
    featureSpec: {
      currentEmotion: EMOTION_KEYS,
      categorical: ['actionType'],
      target: 'nextEmotion',
    },
    globalProfile: buildProfile(samples),
    actionProfiles,
    onnxReady: false,
    onnxExport: {
      requested: false,
      status: 'not_exported',
      reason: 'Dependency-free baseline trainer is active. Install torch and onnx to export a true ONNX model.',
    },
  };
}

function parseJsonFromOutput(output = '') {
  const text = String(output || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function checkOnnxDependencies() {
  const script = [
    'import importlib.util, json',
    "deps = ['numpy', 'torch', 'onnx']",
    'missing = [name for name in deps if importlib.util.find_spec(name) is None]',
    "print(json.dumps({'ok': len(missing) == 0, 'missingDependencies': missing}))",
  ].join('\n');
  const result = spawnSync(PYTHON_BIN, ['-c', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    windowsHide: true,
  });
  if (result.error) {
    return {
      ok: false,
      missingDependencies: ['python'],
      error: result.error.message,
    };
  }
  const payload = parseJsonFromOutput(result.stdout);
  if (!payload) {
    return {
      ok: false,
      missingDependencies: ['python-json-output'],
      error: String(result.stderr || result.stdout || '').trim(),
    };
  }
  return payload;
}

function runOnnxExporter({ datasetPath, outDir, model }) {
  const dependencyStatus = checkOnnxDependencies();
  if (!dependencyStatus.ok) {
    return {
      requested: true,
      status: 'blocked_missing_dependencies',
      missingDependencies: dependencyStatus.missingDependencies || [],
      reason: 'Install numpy, torch, and onnx to export the emotion world model as ONNX.',
      error: dependencyStatus.error || '',
    };
  }
  const onnxPath = path.join(outDir, 'emotion-world-model.onnx');
  const metadataPath = path.join(outDir, 'emotion-world-model-onnx-metadata.json');
  const result = spawnSync(PYTHON_BIN, [
    ONNX_EXPORTER_SCRIPT,
    '--dataset', datasetPath,
    '--out', onnxPath,
    '--metadata-out', metadataPath,
    '--model-id', model.modelId,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    windowsHide: true,
    timeout: Math.max(30000, Number(process.env.PBK_EMOTION_ONNX_EXPORT_TIMEOUT_MS || 120000)),
  });
  const payload = parseJsonFromOutput(result.stdout);
  if (result.status !== 0 || !payload?.ok) {
    return {
      requested: true,
      status: 'export_failed',
      onnxPath,
      metadataPath,
      error: payload?.error || String(result.stderr || result.stdout || result.error?.message || 'ONNX export failed.').slice(-2000),
    };
  }
  return {
    requested: true,
    status: 'exported',
    onnxPath,
    metadataPath,
    exporter: payload.exporter || 'torch.onnx',
    inputDim: payload.inputDim,
    outputDim: payload.outputDim,
    actionTypes: payload.actionTypes || [],
  };
}

async function main() {
  const args = parseArgs();
  const inputPath = args.input ? path.resolve(String(args.input)) : '';
  const outDir = args['out-dir'] ? path.resolve(String(args['out-dir'])) : DEFAULT_OUT_DIR;
  const minSamples = Math.max(1, Number(args['min-samples'] || 10));
  const exportOnnx = Boolean(args['export-onnx'] || args.onnx);
  if (!inputPath) {
    throw new Error('Missing --input <state.json>.');
  }
  const state = JSON.parse(await readFile(inputPath, 'utf8'));
  const samples = extractSamples(state);
  if (samples.length < minSamples) {
    throw new Error(`Not enough emotion transition samples. Need ${minSamples}, found ${samples.length}.`);
  }
  const model = buildModel(samples);
  const datasetPath = path.join(outDir, 'emotion-world-model-dataset.jsonl');
  await mkdir(outDir, { recursive: true });
  await writeFile(datasetPath, `${samples.map((sample) => JSON.stringify(sample)).join('\n')}\n`);
  if (exportOnnx) {
    model.onnxExport = runOnnxExporter({ datasetPath, outDir, model });
    model.onnxReady = model.onnxExport.status === 'exported';
  }
  const manifest = {
    ok: true,
    result: 'emotion_world_model_training_ready',
    trainedAt: model.trainedAt,
    input: inputPath,
    outDir,
    modelPath: path.join(outDir, 'emotion-world-model.json'),
    datasetPath,
    sampleCount: samples.length,
    featureCount: EMOTION_KEYS.length + 1,
    actionTypes: Object.keys(model.actionProfiles),
    modelType: model.modelType,
    modelId: model.modelId,
    onnxReady: model.onnxReady,
    onnxExport: model.onnxExport,
  };
  await writeFile(path.join(outDir, 'emotion-world-model.json'), JSON.stringify(model, null, 2));
  await writeFile(path.join(outDir, 'emotion-world-model-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
