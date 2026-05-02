import { existsSync, readFileSync } from 'node:fs';

import {
  DEEPGRAM_SAMPLE_URL,
  getDeepgramProviderMeta,
  transcribeDeepgramUrl,
} from './pbk-deepgram-client.mjs';

function loadLocalRuntimeEnv() {
  const envPath = '.pbk-local/pbk-runtime.env';
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (name && value && !process.env[name]) {
      process.env[name] = value;
    }
  }
}

function runMockSmoke() {
  return {
    ok: true,
    provider: 'deepgram',
    mode: 'mock',
    model: process.env.PBK_DEEPGRAM_MODEL || process.env.DEEPGRAM_MODEL || 'nova-2',
    sampleUrl: DEEPGRAM_SAMPLE_URL,
    note: 'Request-shape smoke only; set PBK_DEEPGRAM_API_KEY for a live transcription.',
  };
}

async function runLiveSmoke() {
  const result = await transcribeDeepgramUrl({
    url: process.env.PBK_DEEPGRAM_SMOKE_URL || DEEPGRAM_SAMPLE_URL,
    sentiment: true,
    utterances: true,
    paragraphs: true,
  });

  if (!result.ok) {
    const error = new Error(result.error || 'Deepgram smoke failed.');
    error.result = result;
    throw error;
  }

  return {
    ok: true,
    provider: 'deepgram',
    mode: 'live',
    model: result.model,
    transcriptPreview: result.summary.transcriptPreview,
    sentiment: {
      label: result.summary.sentiment.label,
      score: result.summary.sentiment.score,
      pbkScore: result.summary.sentiment.pbkScore,
      segmentCount: result.summary.sentiment.segmentCount,
    },
    utteranceCount: result.summary.utteranceCount,
  };
}

loadLocalRuntimeEnv();

const forceMock = process.argv.includes('--mock');
const meta = getDeepgramProviderMeta();

if (forceMock || !meta.ready) {
  const output = forceMock ? runMockSmoke() : {
    ok: false,
    provider: 'deepgram',
    mode: 'provider_missing',
    missing: meta.missing,
    hint: 'Set PBK_DEEPGRAM_API_KEY or DEEPGRAM_API_KEY in .pbk-local/pbk-runtime.env, Windows User env, or Render.',
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(forceMock ? 0 : 1);
}

const output = await runLiveSmoke();
console.log(JSON.stringify(output, null, 2));
