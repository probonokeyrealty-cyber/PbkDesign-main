import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.pbk-local', 'pbk-runtime.env');

async function readRuntimeEnv() {
  const text = await readFile(envPath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

async function httpOk(url, options = {}, validate = null) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const valid = validate ? validate(body) : true;
    return { ok: response.ok && valid, status: response.status };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function run() {
  const env = await readRuntimeEnv();
  const codeRunnerHeaders = {
    'X-API-Key': env.PBK_CODE_RUNNER_API_KEY || '',
    'Content-Type': 'application/json',
  };

  const temporalUi = await httpOk('http://127.0.0.1:8233');
  const voidllm = await httpOk('http://127.0.0.1:8088/healthz');
  const quartermasterHealth = await httpOk('http://127.0.0.1:8011/health', {
    headers: codeRunnerHeaders,
  });
  const quartermasterRun = await httpOk('http://127.0.0.1:8011/run', {
    method: 'POST',
    headers: codeRunnerHeaders,
    body: JSON.stringify({
      image: 'python',
      code: 'print(sum(range(1, 11)))',
      timeout: 20,
      mem_limit: '128m',
      allow_network: false,
    }),
  }, (body) => body?.exit_code === 0 && String(body?.stdout || '').trim() === '55');

  const result = {
    ok: Boolean(temporalUi.ok && voidllm.ok && quartermasterHealth.ok && quartermasterRun.ok),
    temporalUi,
    voidllm,
    quartermasterHealth,
    quartermasterRun,
    endpoints: {
      temporalGrpc: '127.0.0.1:7233',
      temporalUi: 'http://127.0.0.1:8233',
      voidllm: 'http://127.0.0.1:8088',
      quartermaster: 'http://127.0.0.1:8011',
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
