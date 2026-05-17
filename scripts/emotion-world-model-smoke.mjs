import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'scripts', 'openclaw-local-server.mjs');
const SMOKE_ID = `${process.pid}-${Date.now()}`;
const PORT = Number(process.env.PBK_EMOTION_MODEL_SMOKE_PORT || (21808 + (process.pid % 1000)));
const MODEL_PORT = Number(process.env.PBK_EMOTION_MODEL_MOCK_PORT || (22808 + (process.pid % 1000)));
const API_KEY = String(process.env.PBK_EMOTION_MODEL_SMOKE_API_KEY || 'pbk-emotion-model-smoke-key').trim();
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MODEL_URL = `http://127.0.0.1:${MODEL_PORT}/predict`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function waitForHealth(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return response.json();
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error('Timed out waiting for bridge health.');
}

async function jsonFetch(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  const modelRequests = [];
  const modelServer = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/predict') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'not_found' }));
      return;
    }
    const body = JSON.parse(await readRequestBody(request) || '{}');
    modelRequests.push(body);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      model: 'mock-emotional-onnx-v0',
      nextEmotion: {
        joy: 0.32,
        sadness: 0.18,
        anger: 0.06,
        fear: 0.44,
      },
      policyHint: 'model_selected_calibrated_question',
      confidence: 0.91,
    }));
  });

  await new Promise((resolve, reject) => {
    modelServer.once('error', reject);
    modelServer.listen(MODEL_PORT, '127.0.0.1', resolve);
  });

  const child = spawn(process.execPath, [SERVER_ENTRY, '--reset'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PBK_OPENCLAW_PORT: String(PORT),
      PBK_BRIDGE_API_KEY: API_KEY,
      PBK_OPENCLAW_STATE_DIR: path.join(ROOT_DIR, '.pbk-local', `emotion-model-smoke-${SMOKE_ID}`),
      PBK_OPENCLAW_RESET: '1',
      PBK_EMOTION_WORLD_MODEL_ENDPOINT: MODEL_URL,
      PBK_EMOTION_WORLD_MODEL_API_KEY: 'mock-model-secret',
      PBK_EMOTION_WORLD_MODEL_TIMEOUT_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  const cleanup = async () => {
    if (!child.killed) {
      child.kill();
      await delay(150);
    }
    await new Promise((resolve) => modelServer.close(resolve));
  };

  try {
    await waitForHealth();
    const predicted = await jsonFetch('/api/emotion/predict', {
      method: 'POST',
      body: JSON.stringify({
        leadId: 'smoke-model-lead',
        actionType: 'calibrated_question',
        message: 'What would need to feel true for this to be easier for you?',
        currentEmotion: {
          joy: 0.04,
          sadness: 0.76,
          anger: 0.05,
          fear: 0.15,
        },
      }),
    });

    assert(predicted.response.status === 200, `Expected emotion predict 200, got ${predicted.response.status}`);
    assert(predicted.body.ok === true, 'Emotion prediction did not return ok=true.');
    assert(modelRequests.length === 1, `Expected exactly one world-model request, got ${modelRequests.length}.`);
    assert(modelRequests[0].actionType === 'calibrated_question', 'World-model request did not include actionType.');
    assert(modelRequests[0].currentEmotion?.dominant === 'sadness', 'World-model request did not include normalized current emotion.');
    assert(predicted.body.prediction?.modelProvider === 'external_world_model', 'Prediction did not report external world-model provider.');
    assert(predicted.body.prediction?.model === 'mock-emotional-onnx-v0', 'Prediction did not preserve external model name.');
    assert(predicted.body.prediction?.policyHint === 'model_selected_calibrated_question', 'Prediction did not preserve external policy hint.');
    assert(predicted.body.prediction?.confidence === 0.91, 'Prediction did not preserve external confidence.');
    assert(!JSON.stringify(predicted.body).includes('mock-model-secret'), 'Prediction response leaked world-model API key.');

    console.log(JSON.stringify({
      ok: true,
      result: 'emotion_world_model_provider_ready',
      modelProvider: predicted.body.prediction.modelProvider,
      model: predicted.body.prediction.model,
      requestCount: modelRequests.length,
    }, null, 2));
  } finally {
    await cleanup();
    if (stderr && /Error|Unhandled|EADDRINUSE/i.test(stderr)) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
