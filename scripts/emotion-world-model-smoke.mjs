import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const child = await startIsolatedBridge({ startupMs: 60000,
    entry: fileURLToPath(new URL('./fixtures/emotion-world-model-bridge-fixture.mjs', import.meta.url)) });

  try {
    const response = await child.fetch(child.origin + '/api/emotion/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${child.apiKey}` },
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

    const predicted = { response, body: await response.json() };
    const modelRequests = JSON.parse(await readFile(path.join(child.stateDir, 'model-requests.json'), 'utf8'));
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
    await child.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
