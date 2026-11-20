import { writeFile } from 'node:fs/promises';
import path from 'node:path';

if (!process.env.PBK_SMOKE_ISOLATION_NONCE || !process.send || !process.permission) {
  throw new Error('World-model fixture requires the isolated bridge harness');
}
const endpoint = 'https://world-model.fixture.invalid/predict';
const deniedFetch = globalThis.fetch;
const requests = [];
process.env.PBK_EMOTION_WORLD_MODEL_ENDPOINT = endpoint;
process.env.PBK_EMOTION_WORLD_MODEL_API_KEY = 'mock-model-secret';
process.env.PBK_EMOTION_WORLD_MODEL_TIMEOUT_MS = '2000';
globalThis.fetch = async (input, options) => {
  if (String(input) !== endpoint) return deniedFetch(input, options);
  if (options?.method !== 'POST' || new Headers(options.headers).get('authorization') !== 'Bearer mock-model-secret') {
    throw new Error('Invalid fixture model request');
  }
  requests.push(JSON.parse(options.body));
  await writeFile(path.join(process.env.PBK_OPENCLAW_STATE_DIR, 'model-requests.json'), JSON.stringify(requests));
  return Response.json({ ok: true, model: 'mock-emotional-onnx-v0',
    nextEmotion: { joy: 0.32, sadness: 0.18, anger: 0.06, fear: 0.44 },
    policyHint: 'model_selected_calibrated_question', confidence: 0.91 });
};
await import('../openclaw-local-server.mjs');
