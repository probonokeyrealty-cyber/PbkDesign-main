import { existsSync, readFileSync } from 'node:fs';

import { callGeminiJson, getGoogleApiKey } from './pbk-agent-lib.mjs';

function loadLocalRuntimeEnv() {
  const envPath = '.pbk-local/pbk-runtime.env';
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index);
    const value = line.slice(index + 1).trim();
    if (value && !process.env[name]) {
      process.env[name] = value;
    }
  }
}

async function runMockSmoke() {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body || '{}');

    if (!String(url).startsWith('http://127.0.0.1:8088/v1/chat/completions')) {
      throw new Error(`Unexpected VoidLLM URL: ${url}`);
    }
    if (options.headers?.Authorization !== 'Bearer smoke-key') {
      throw new Error('VoidLLM smoke did not send the configured API key.');
    }
    if (options.headers?.['X-User-Id'] !== 'pbk-smoke') {
      throw new Error('VoidLLM smoke did not send the configured X-User-Id.');
    }
    if (body.model !== 'pbk-smoke-model') {
      throw new Error(`Unexpected VoidLLM model: ${body.model}`);
    }
    if (!Array.isArray(body.messages) || body.messages.at(-1)?.content !== 'Return {"ok":true}.') {
      throw new Error('VoidLLM smoke did not send the expected chat messages payload.');
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"ok":true,"provider":"voidllm","mode":"mock"}',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  process.env.PBK_LLM_PROVIDER = 'voidllm';
  process.env.PBK_VOIDLLM_BASE_URL = 'http://127.0.0.1:8088/v1';
  process.env.PBK_VOIDLLM_API_KEY = 'smoke-key';
  process.env.PBK_VOIDLLM_MODEL = 'pbk-smoke-model';
  process.env.PBK_VOIDLLM_USER_ID = 'pbk-smoke';

  try {
    const result = await callGeminiJson({
      apiKey: process.env.PBK_VOIDLLM_API_KEY,
      prompt: 'Return {"ok":true}.',
    });

    if (!result?.ok || result?.provider !== 'voidllm' || result?.mode !== 'mock' || calls.length !== 1) {
      throw new Error(`Unexpected VoidLLM mock smoke result: ${JSON.stringify(result)}`);
    }

    return { ok: true, provider: 'voidllm', mode: 'mock', calls: calls.length };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runLiveSmoke() {
  process.env.PBK_LLM_PROVIDER = 'voidllm';
  process.env.PBK_VOIDLLM_BASE_URL ||= 'http://127.0.0.1:8088/v1';
  process.env.PBK_VOIDLLM_MODEL ||= 'default';
  process.env.PBK_VOIDLLM_USER_ID ||= 'pbk-agent-planner';

  const result = await callGeminiJson({
    apiKey: getGoogleApiKey(),
    prompt: 'Return exactly this JSON and nothing else: {"ok":true,"provider":"voidllm","mode":"live"}',
  });

  if (!result?.ok || result?.provider !== 'voidllm' || result?.mode !== 'live') {
    throw new Error(`Unexpected VoidLLM live smoke result: ${JSON.stringify(result)}`);
  }

  return {
    ok: true,
    provider: 'voidllm',
    mode: 'live',
    baseURL: process.env.PBK_VOIDLLM_BASE_URL,
    model: process.env.PBK_VOIDLLM_MODEL,
  };
}

loadLocalRuntimeEnv();

const forceMock = process.argv.includes('--mock');
const hasLiveConfig = Boolean(process.env.PBK_VOIDLLM_API_KEY || process.env.VOIDLLM_API_KEY);
const result = forceMock || !hasLiveConfig ? await runMockSmoke() : await runLiveSmoke();

console.log(JSON.stringify(result, null, 2));
