import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const WORK_DIR = path.join(ROOT_DIR, '.pbk-local', `emotion-training-smoke-${SMOKE_ID}`);
const INPUT_PATH = path.join(WORK_DIR, 'state.json');
const OUT_DIR = path.join(WORK_DIR, 'model');
const MODEL_PATH = path.join(OUT_DIR, 'emotion-world-model.json');
const MANIFEST_PATH = path.join(OUT_DIR, 'emotion-world-model-manifest.json');
const DATASET_PATH = path.join(OUT_DIR, 'emotion-world-model-dataset.jsonl');
const PORT = Number(process.env.PBK_EMOTION_TRAINING_SMOKE_PORT || (23808 + (process.pid % 1000)));
const ONNX_PORT = PORT + 1;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runNode(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT_DIR,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`node ${args.join(' ')} failed with ${code}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseJsonFromOutput(output = '') {
  const text = String(output || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  return JSON.parse(text.slice(start, end + 1));
}

async function waitForServer(timeoutMs = 10000) {
  return waitForServerOnPort(PORT, timeoutMs);
}

async function waitForServerOnPort(port, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error('Timed out waiting for model server.');
}

async function main() {
  await rm(WORK_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  const state = {
    agentDecisions: [
      {
        id: 'sample-empathy-1',
        actionType: 'empathy_statement',
        emotionState: { joy: 0.03, sadness: 0.78, anger: 0.04, fear: 0.15 },
        outcome: { nextEmotion: { joy: 0.18, sadness: 0.58, anger: 0.02, fear: 0.22 } },
        reward: 0.7,
        trainingReady: true,
      },
      {
        id: 'sample-empathy-2',
        actionType: 'empathy_statement',
        emotionState: { joy: 0.05, sadness: 0.7, anger: 0.1, fear: 0.15 },
        outcome: { nextEmotion: { joy: 0.21, sadness: 0.48, anger: 0.05, fear: 0.26 } },
        reward: 0.66,
        trainingReady: true,
      },
      {
        id: 'sample-offer-1',
        actionType: 'offer_presented',
        emotionState: { joy: 0.08, sadness: 0.62, anger: 0.05, fear: 0.25 },
        outcome: { nextEmotion: { joy: 0.04, sadness: 0.52, anger: 0.2, fear: 0.24 } },
        reward: -0.1,
        trainingReady: true,
      },
      {
        id: 'sample-question-1',
        actionType: 'calibrated_question',
        emotionState: { joy: 0.12, sadness: 0.2, anger: 0.08, fear: 0.6 },
        outcome: { nextEmotion: { joy: 0.18, sadness: 0.22, anger: 0.06, fear: 0.54 } },
        reward: 0.42,
        trainingReady: true,
      },
    ],
  };
  await writeFile(INPUT_PATH, JSON.stringify(state, null, 2));

  const training = await runNode([
    './scripts/train-emotion-world-model.mjs',
    '--input', INPUT_PATH,
    '--out-dir', OUT_DIR,
    '--min-samples', '4',
  ]);
  const trainingResult = parseJsonFromOutput(training.stdout);
  assert(trainingResult.ok === true, 'Training script did not return ok=true.');
  assert(trainingResult.result === 'emotion_world_model_training_ready', `Unexpected training result: ${trainingResult.result}`);
  assert(trainingResult.sampleCount === 4, `Expected 4 samples, got ${trainingResult.sampleCount}.`);
  assert(trainingResult.onnxReady === false, 'Dependency-free trainer should honestly report onnxReady=false.');

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const model = JSON.parse(await readFile(MODEL_PATH, 'utf8'));
  const dataset = (await readFile(DATASET_PATH, 'utf8')).trim().split(/\r?\n/);
  assert(manifest.result === 'emotion_world_model_training_ready', 'Manifest missing training-ready result.');
  assert(model.modelType === 'pbk-emotional-transition-regressor-v1', 'Model artifact has wrong modelType.');
  assert(model.actionProfiles.empathy_statement.count === 2, 'Model did not learn empathy profile count.');
  assert(dataset.length === 4, `Expected 4 dataset rows, got ${dataset.length}.`);

  const onnxOutDir = path.join(WORK_DIR, 'onnx-model');
  const onnxTraining = await runNode([
    './scripts/train-emotion-world-model.mjs',
    '--input', INPUT_PATH,
    '--out-dir', onnxOutDir,
    '--min-samples', '4',
    '--export-onnx',
  ]);
  const onnxTrainingResult = parseJsonFromOutput(onnxTraining.stdout);
  assert(onnxTrainingResult.ok === true, 'ONNX export run did not return ok=true.');
  assert(onnxTrainingResult.onnxExport?.requested === true, 'ONNX export run did not record export request.');
  assert(
    ['blocked_missing_dependencies', 'exported'].includes(onnxTrainingResult.onnxExport?.status),
    `Unexpected ONNX export status: ${onnxTrainingResult.onnxExport?.status}`,
  );
  if (onnxTrainingResult.onnxExport.status === 'blocked_missing_dependencies') {
    assert(Array.isArray(onnxTrainingResult.onnxExport.missingDependencies), 'Blocked ONNX export did not list missing dependencies.');
    assert(onnxTrainingResult.onnxReady === false, 'Blocked ONNX export must report onnxReady=false.');
  } else {
    assert(String(onnxTrainingResult.onnxExport.onnxPath || '').endsWith('.onnx'), 'Exported ONNX run did not return an .onnx path.');
    assert(onnxTrainingResult.onnxReady === true, 'Exported ONNX run must report onnxReady=true.');
  }

  const onnxRunnerPath = onnxTrainingResult.onnxExport.onnxPath || path.join(onnxOutDir, 'emotion-world-model-placeholder.onnx');
  const onnxMetadataPath = onnxTrainingResult.onnxExport.metadataPath || path.join(onnxOutDir, 'emotion-world-model-onnx-metadata.json');
  if (onnxTrainingResult.onnxExport.status !== 'exported') {
    await writeFile(onnxRunnerPath, 'placeholder-on-missing-onnx-export');
    await writeFile(onnxMetadataPath, JSON.stringify({
      modelId: 'placeholder-onnx-metadata',
      inputDim: 8,
      outputDim: 4,
      emotionKeys: ['joy', 'sadness', 'anger', 'fear'],
      actionTypes: ['calibrated_question', 'empathy_statement', 'offer_presented'],
    }, null, 2));
  }

  const child = spawn(process.execPath, [
    './scripts/serve-emotion-world-model.mjs',
    '--model', MODEL_PATH,
    '--port', String(PORT),
  ], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
  const cleanup = async () => {
    if (!child.killed) child.kill();
  };

  try {
    const health = await waitForServer();
    assert(health.modelType === 'pbk-emotional-transition-regressor-v1', 'Model server health did not expose modelType.');
    const response = await fetch(`http://127.0.0.1:${PORT}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'empathy_statement',
        currentEmotion: { joy: 0.03, sadness: 0.78, anger: 0.04, fear: 0.15 },
      }),
    });
    const prediction = await response.json();
    assert(response.ok, `Prediction server returned ${response.status}`);
    assert(prediction.ok === true, 'Prediction server did not return ok=true.');
    assert(prediction.model === model.modelId, 'Prediction did not report trained model id.');
    assert(prediction.nextEmotion.sadness < 0.78, 'Trained empathy profile did not reduce sadness.');
    assert(prediction.policyHint === 'model_selected_empathy_statement', 'Prediction did not return model-selected policy hint.');
  } finally {
    await cleanup();
    if (stderr && /Error|Unhandled|EADDRINUSE/i.test(stderr)) {
      console.error(stderr);
    }
  }

  const onnxChild = spawn(process.execPath, [
    './scripts/serve-emotion-world-model.mjs',
    '--model', MODEL_PATH,
    '--onnx', onnxRunnerPath,
    '--metadata', onnxMetadataPath,
    '--port', String(ONNX_PORT),
  ], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let onnxStderr = '';
  onnxChild.stderr.on('data', (chunk) => { onnxStderr += String(chunk || ''); });
  const cleanupOnnx = async () => {
    if (!onnxChild.killed) onnxChild.kill();
    await rm(WORK_DIR, { recursive: true, force: true });
  };

  try {
    const health = await waitForServerOnPort(ONNX_PORT);
    assert(health.onnxRunner?.requested === true, 'ONNX runner health did not record the requested ONNX artifact.');
    assert(
      ['ready', 'blocked_missing_dependencies', 'load_failed'].includes(health.onnxRunner?.status),
      `Unexpected ONNX runner status: ${health.onnxRunner?.status}`,
    );
    const response = await fetch(`http://127.0.0.1:${ONNX_PORT}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actionType: 'empathy_statement',
        currentEmotion: { joy: 0.03, sadness: 0.78, anger: 0.04, fear: 0.15 },
      }),
    });
    const prediction = await response.json();
    assert(response.ok, `ONNX runner server returned ${response.status}`);
    assert(prediction.ok === true, 'ONNX runner server did not return ok=true.');
    assert(['onnxruntime-node', 'json_baseline_fallback'].includes(prediction.runner), `Unexpected prediction runner: ${prediction.runner}`);
  } finally {
    await cleanupOnnx();
    if (onnxStderr && /Error|Unhandled|EADDRINUSE/i.test(onnxStderr)) {
      console.error(onnxStderr);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    result: 'emotion_world_model_training_pipeline_ready',
    sampleCount: trainingResult.sampleCount,
    modelType: model.modelType,
    onnxReady: trainingResult.onnxReady,
    onnxExportStatus: onnxTrainingResult.onnxExport.status,
    onnxRunnerStatus: onnxTrainingResult.onnxExport.status === 'exported' ? 'ready_or_checked' : 'blocked_or_checked',
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
