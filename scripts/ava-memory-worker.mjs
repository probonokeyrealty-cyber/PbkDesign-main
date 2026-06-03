import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFailureAlertPayload,
  fetchJsonWithRetry,
  resolveMemoryWorkerConfig,
  sendFailureAlert,
} from './ava-memory-worker-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.resolve(ROOT_DIR, process.env.PBK_OPENCLAW_STATE_DIR || '.pbk-local');

function hydrateLocalRuntimeEnv() {
  const envPath = path.join(RUNTIME_DIR, 'pbk-runtime.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

hydrateLocalRuntimeEnv();

let config = null;
try {
  config = resolveMemoryWorkerConfig(process.env);
  const { bridgeUrl, apiKey, minutesBudget, limit, timeoutMs, retryDelaysMs } = config;
  const result = await fetchJsonWithRetry(
    `${bridgeUrl}/api/ava/learning/run`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        actor: 'Ava memory worker',
        minutesBudget,
        limit,
      }),
    },
    { timeoutMs, retryDelaysMs }
  );
  const body = result.body || {};
  const output = {
    ok: true,
    status: result.status,
    attempts: result.attempts,
    bridgeUrl,
    timeoutMs,
    result: body?.result || '',
    verbiage: body?.verbiage || '',
    candidatesProcessed: body?.session?.candidatesProcessed ?? 0,
    lessonsExtracted: body?.session?.lessonsExtracted ?? 0,
    warning: body?.warning || '',
    ranAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  const alertPayload = buildFailureAlertPayload(error, {
    bridgeUrl: config?.bridgeUrl || '',
    status: error.status || 0,
    attempts: error.attempts || 1,
    body: error.body || null,
  });
  let alert = { ok: false, skipped: true };
  if (config?.bridgeUrl) {
    alert = await sendFailureAlert({
      bridgeUrl: config.bridgeUrl,
      apiKey: config.apiKey,
      alertPayload,
    });
  }
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: error.status || 0,
        attempts: error.attempts || 1,
        bridgeUrl: config?.bridgeUrl || '',
        error: String(error.message || error),
        alert,
        ranAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
