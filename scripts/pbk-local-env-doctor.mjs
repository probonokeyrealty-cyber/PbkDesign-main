import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_BRIDGE_URL = 'https://pbk-openclaw-bridge.onrender.com';
const STRICT_LOCAL = process.argv.includes('--strict-local');

const LOCAL_ENV_PATHS = ['.env.local', '.pbk-local/pbk-runtime.env'];
const DEEPSEEK_KEYS = ['PBK_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const result = {};
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

function hasAny(env, keys) {
  return keys.some((key) => Boolean(String(env[key] || '').trim()));
}

function summarizeEnvSource(name, env) {
  return {
    source: name,
    deepSeekKeyPresent: hasAny(env, DEEPSEEK_KEYS),
    bridgeUrlPresent: Boolean(String(env.PBK_BRIDGE_URL || env.PBK_HOSTED_BRIDGE_URL || '').trim()),
    bridgeApiKeyPresent: Boolean(String(env.PBK_BRIDGE_API_KEY || env.PBK_DEV_BRIDGE_API_KEY || '').trim()),
  };
}

async function getHostedDeepSeekStatus(envSources) {
  const merged = Object.assign({}, ...envSources.map((item) => item.env));
  const bridgeUrl = String(
    process.env.PBK_HOSTED_BRIDGE_URL ||
      process.env.PBK_BRIDGE_URL ||
      merged.PBK_HOSTED_BRIDGE_URL ||
      merged.PBK_BRIDGE_URL ||
      DEFAULT_BRIDGE_URL
  )
    .trim()
    .replace(/\/+$/g, '');

  const startedAt = Date.now();
  const response = await fetch(`${bridgeUrl}/health`);
  const health = await response.json();
  return {
    ok: response.ok && health?.ok === true,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    bridgeUrl,
    bridgeStatus: health?.status || '',
    componentStatus: health?.componentSummary?.status || '',
    deepSeekReady: Boolean(health?.providers?.deepSeek?.ready),
    deepSeekConfigured: Boolean(health?.providers?.deepSeek?.configured),
    deepSeekModel: health?.providers?.deepSeek?.model || '',
    deepSeekFallbackModel: health?.providers?.deepSeek?.fallbackModel || '',
    strategistProvider: health?.providers?.deepSeek?.strategistProvider || '',
    missing: health?.providers?.deepSeek?.missing || [],
  };
}

async function main() {
  const fileSources = LOCAL_ENV_PATHS.map((relativePath) => ({
    name: relativePath,
    env: parseEnvFile(resolve(ROOT_DIR, relativePath)),
  }));
  const sources = [{ name: 'process.env', env: process.env }, ...fileSources];
  const localDeepSeekReady = sources.some((source) => hasAny(source.env, DEEPSEEK_KEYS));
  const hosted = await getHostedDeepSeekStatus(sources);

  const ok = hosted.ok && hosted.deepSeekReady && (!STRICT_LOCAL || localDeepSeekReady);
  const result = {
    ok,
    localDeepSeekReady,
    hostedDeepSeekReady: hosted.deepSeekReady,
    strictLocal: STRICT_LOCAL,
    sources: sources.map((source) => summarizeEnvSource(source.name, source.env)),
    hosted,
    guidance: localDeepSeekReady
      ? 'Local DeepSeek key is present in at least one checked source.'
      : 'Production Render is DeepSeek-ready, but local bridge runs need PBK_DEEPSEEK_API_KEY or DEEPSEEK_API_KEY in process env, .env.local, or .pbk-local/pbk-runtime.env.',
  };

  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || 'PBK local env doctor failed.');
  process.exitCode = 1;
});
