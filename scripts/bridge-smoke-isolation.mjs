import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nodeModule from 'node:module';

const defaultEntry = fileURLToPath(new URL('./openclaw-local-server.mjs', import.meta.url));
const guardEntry = new URL('./bridge-smoke-guard.mjs', import.meta.url).href;
const prefix = 'pbk-bridge-smoke-';

export function buildSmokeEnv(stateDir, port, apiKey, nonce, ambient = process.env) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'SystemDrive', 'PATH', 'Path', 'PATHEXT']) {
    if (ambient[key]) env[key] = ambient[key];
  }
  return {
    ...env,
    HOME: stateDir, USERPROFILE: stateDir, APPDATA: stateDir, LOCALAPPDATA: stateDir,
    TEMP: stateDir, TMP: stateDir, TMPDIR: stateDir, NODE_ENV: 'test',
    PBK_OPENCLAW_STATE_DIR: stateDir, PBK_OPENCLAW_HOST: '127.0.0.1',
    PBK_OPENCLAW_PORT: String(port), PBK_BRIDGE_API_KEY: apiKey,
    PBK_SMOKE_ISOLATION_NONCE: nonce,
    PBK_VOICE_PREWARM_ENABLED: 'false', PBK_CAMPAIGN_WORKER_ENABLED: 'false',
    PBK_EMOTION_WORLD_MODEL_RETRAIN_ENABLED: 'false', PBK_REPLY_AUTO_DIAL_IMMEDIATE: 'false',
    PBK_AUTO_SEND_REPLY_FOLLOWUPS: 'false', PBK_REDIS_ENABLED: 'false',
  };
}

async function reservePortNumber() {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function startIsolatedBridge({ entry = defaultEntry, args = [], startupMs = 15000, lifetimeMs = 240000 } = {}) {
  if (typeof nodeModule.registerHooks !== 'function') throw new Error('Bridge smoke requires Node 22.15+ with synchronous module hooks and permissions');
  const parent = await realpath(tmpdir());
  const stateDir = await mkdtemp(path.join(parent, prefix));
  let port;
  const apiKey = randomUUID();
  const nonce = randomUUID();
  let child, closed, stopPromise, startupTimer, lifetimeTimer;
  let stderr = '';
  let active = false;
  const requests = new AbortController();
  const invalidate = () => { active = false; requests.abort(); };
  const blockedNetwork = {};
  const onInterrupt = () => { void stop().finally(() => process.exit(130)); };
  const onTerminate = () => { void stop().finally(() => process.exit(143)); };
  const onExit = () => { if (child?.exitCode === null) child.kill('SIGKILL'); };
  async function stop() {
    invalidate();
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      clearTimeout(startupTimer);
      clearTimeout(lifetimeTimer);
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
      process.removeListener('exit', onExit);
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 1500);
        try { await closed; } finally { clearTimeout(force); }
      } else if (closed) await closed;
      const resolved = await realpath(stateDir).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!resolved) return;
      if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(prefix)) {
        throw new Error('Refusing smoke cleanup outside the allocated temporary root');
      }
      await rm(resolved, { recursive: true, force: true });
    })();
    return stopPromise;
  }
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  process.once('exit', onExit);
  try {
    port = await reservePortNumber();
    child = spawn(process.execPath, [
      '--permission', '--no-experimental-sqlite', '--allow-fs-read=*', `--allow-fs-write=${stateDir}`,
      '--import', guardEntry, entry, ...args,
    ], { cwd: stateDir, env: buildSmokeEnv(stateDir, port, apiKey, nonce), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    closed = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
    child.once('exit', invalidate);
    child.once('error', invalidate);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    await new Promise((resolve, reject) => {
      startupTimer = setTimeout(() => reject(new Error('Isolated bridge startup timed out')), startupMs);
      child.once('error', reject);
      child.once('close', code => reject(new Error(`Isolated bridge exited during startup (${code}): ${stderr}`)));
      child.on('message', message => {
        if (message?.nonce !== nonce) return;
        if (message.type === 'smoke-network-blocked') blockedNetwork[message.api] = (blockedNetwork[message.api] || 0) + 1;
        if (message.type === 'smoke-listening' && message.port === port && message.host === '127.0.0.1') resolve();
      });
    });
    clearTimeout(startupTimer);
    active = true;
    lifetimeTimer = setTimeout(() => { invalidate(); child.kill('SIGKILL'); }, lifetimeMs);
    lifetimeTimer.unref();
    const origin = `http://127.0.0.1:${port}`;
    return {
      origin, apiKey, stateDir, blockedNetwork, stop,
      fetch: async (target, options = {}) => {
        if (!active || child.exitCode !== null || child.signalCode !== null) throw new Error('Isolated bridge is stopped');
        if (new URL(target).origin !== origin) throw new Error('Smoke request origin is not the isolated child');
        const signals = [requests.signal, AbortSignal.timeout(20000)];
        if (options.signal) signals.push(options.signal);
        return fetch(target, { ...options, redirect: 'error', signal: AbortSignal.any(signals) });
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
