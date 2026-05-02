import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const bridgeUrl = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_OPENCLAW_URL
    || process.env.OPENCLAW_URL
    || 'http://127.0.0.1:8788',
).replace(/\/+$/g, '');
const apiKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const minutesBudget = Math.max(1, Math.min(240, Number(process.env.PBK_AVA_MEMORY_DAILY_MINUTES || 60)));
const limit = Math.max(1, Math.min(200, Number(process.env.PBK_AVA_MEMORY_WORKER_LIMIT || 40)));

const response = await fetch(`${bridgeUrl}/api/ava/learning/run`, {
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
});

const text = await response.text();
let body = null;
try {
  body = text ? JSON.parse(text) : {};
} catch {
  body = { raw: text };
}

const output = {
  ok: response.ok && body?.ok !== false,
  status: response.status,
  bridgeUrl,
  result: body?.result || '',
  verbiage: body?.verbiage || '',
  candidatesProcessed: body?.session?.candidatesProcessed ?? 0,
  lessonsExtracted: body?.session?.lessonsExtracted ?? 0,
  warning: body?.warning || '',
  ranAt: new Date().toISOString(),
};

console.log(JSON.stringify(output, null, 2));

if (!output.ok) {
  process.exitCode = 1;
}
