import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BRIDGE_URL = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_HOSTED_BRIDGE_URL
    || 'https://pbk-openclaw-bridge.onrender.com',
).trim().replace(/\/+$/g, '');
const BRIDGE_API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();
const OPENCLAW_GATEWAY_TOKEN = String(
  process.env.OPENCLAW_GATEWAY_TOKEN
    || process.env.PBK_OPENCLAW_GATEWAY_TOKEN
    || readOpenClawGatewayToken()
    || '',
).trim();
const OPENCLAW_GATEWAY_WS_URL = String(
  process.env.OPENCLAW_GATEWAY_URL
    || process.env.OPENCLAW_GATEWAY_WS_URL
    || process.env.PBK_OPENCLAW_GATEWAY_URL
    || 'ws://127.0.0.1:18789',
).trim().replace(/\/+$/g, '');
const OPENCLAW_GATEWAY_HTTP_URL = String(
  process.env.OPENCLAW_GATEWAY_HTTP_URL
    || process.env.PBK_OPENCLAW_GATEWAY_HTTP_URL
    || deriveHttpUrl(OPENCLAW_GATEWAY_WS_URL)
    || 'http://127.0.0.1:18789',
).trim().replace(/\/+$/g, '');
const INTERVAL_MS = Math.max(
  10_000,
  Number(
    process.env.PBK_OPENCLAW_GATEWAY_HEARTBEAT_PUSH_INTERVAL_MS
      || getArgValue('--interval-ms')
      || 30_000,
  ),
);
const PROBE_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.PBK_OPENCLAW_GATEWAY_PROBE_TIMEOUT_MS || getArgValue('--timeout-ms') || 3000),
);
const ONCE = process.argv.includes('--once')
  || /^(1|true|yes)$/i.test(String(process.env.PBK_OPENCLAW_GATEWAY_HEARTBEAT_ONCE || '').trim());
const SKILL_STATS = process.argv.includes('--skill-stats');
const RUN_AUTO_SKILL_LEARNER = process.argv.includes('--run-auto-skill-learner');

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function deriveHttpUrl(value = '') {
  if (/^wss?:\/\//i.test(value)) return value.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

function readOpenClawGatewayToken() {
  const candidates = [
    process.env.OPENCLAW_CONFIG_PATH,
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const config = JSON.parse(readFileSync(candidate, 'utf8'));
      const token = String(
        config?.gateway?.auth?.token
          || config?.gateway?.token
          || '',
      ).trim();
      if (token) return token;
    } catch {
      // Local heartbeat fallback only. Never log config paths or token material here.
    }
  }
  return '';
}

function redactUrl(value = '') {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    for (const key of ['token', 'api_key', 'apikey', 'key', 'auth', 'authorization']) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/+$/g, '');
  } catch {
    return String(value || '').replace(/(token|api_key|apikey|key|auth|authorization)=([^&\s]+)/gi, '$1=[redacted]');
  }
}

async function requestBridgeJson(pathname = '', options = {}) {
  if (!BRIDGE_API_KEY) {
    throw new Error('PBK_BRIDGE_API_KEY is required for bridge diagnostics.');
  }
  const response = await fetch(`${BRIDGE_URL}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${BRIDGE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Bridge returned ${response.status}`);
  }
  return body;
}

async function getSkillStats() {
  const body = await requestBridgeJson('/api/skills/outcomes');
  const skills = Array.isArray(body.skills) ? body.skills : [];
  const active = skills.filter((skill) => String(skill.status || '').toLowerCase() === 'active').length;
  const candidates = skills.filter((skill) => /candidate|testing|pending/i.test(`${skill.status || ''} ${skill.level || ''}`)).length;
  const uses = skills.reduce((sum, skill) => sum + Number(skill.uses || 0), 0);
  const wins = skills.reduce((sum, skill) => sum + Number(skill.wins || 0), 0);
  const highConfidence = skills.filter((skill) => Number(skill.confidence || 0) >= 80).length;
  return {
    ok: true,
    result: 'skill_stats_ready',
    source: body.source || body.result || 'bridge',
    total: skills.length,
    active,
    candidates,
    highConfidence,
    uses,
    wins,
    successRate: uses > 0 ? Number((wins / uses).toFixed(3)) : 0,
    note: uses > 0
      ? 'Skill learner has measured usage to evaluate.'
      : 'Skills are loaded, but measured usage is still zero. Run live calls and record outcomes before auto-promotion.',
  };
}

async function runAutoSkillLearnerCommand() {
  const params = {
    lookbackDays: Number(getArgValue('--lookback-days') || getArgValue('--days') || 7),
    minSuccesses: Number(getArgValue('--min-successes') || getArgValue('--min-success-count') || 3),
    minSuccessRate: Number(getArgValue('--min-success-rate') || 0.8),
    limit: Number(getArgValue('--limit') || 10),
  };
  const body = await requestBridgeJson('/invoke', {
    method: 'POST',
    body: {
      toolName: 'runAutoSkillLearner',
      params,
    },
  });
  return {
    ok: Boolean(body.ok && body.result?.ok),
    result: body.result?.result || 'auto_skill_learner_invoked',
    params,
    boostedCount: Number(body.result?.boostedCount || 0),
    createdCount: Number(body.result?.createdCount || 0),
    boosted: body.result?.boosted || [],
    created: body.result?.created || [],
  };
}

async function probeHttp() {
  const candidates = ['/health', '/status', '/api/health', '/api/status', '']
    .map((suffix) => `${OPENCLAW_GATEWAY_HTTP_URL}${suffix}`);
  const attempts = [];
  for (const url of candidates) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: OPENCLAW_GATEWAY_TOKEN ? { Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}` } : {},
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('json')
        ? await response.json().catch(() => null)
        : await response.text().catch(() => '');
      const attempt = {
        ok: response.ok,
        configured: true,
        url: redactUrl(url),
        latencyMs: Date.now() - startedAt,
        status: response.status,
        service: typeof body === 'object' && body ? body.service || body.name || '' : '',
        revision: typeof body === 'object' && body ? body.revision || body.version || '' : '',
      };
      attempts.push(attempt);
      if (attempt.ok) return { ...attempt, attempts: attempts.slice(0, 3) };
    } catch (error) {
      attempts.push({
        ok: false,
        configured: true,
        url: redactUrl(url),
        latencyMs: Date.now() - startedAt,
        status: 0,
        error: error?.name === 'AbortError' ? `timeout_${PROBE_TIMEOUT_MS}ms` : error?.message || String(error),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const last = attempts.at(-1) || {};
  return {
    ok: false,
    configured: Boolean(OPENCLAW_GATEWAY_HTTP_URL),
    url: redactUrl(OPENCLAW_GATEWAY_HTTP_URL),
    latencyMs: Number(last.latencyMs || 0),
    status: Number(last.status || 0),
    error: last.error || 'gateway_http_probe_failed',
    attempts: attempts.slice(0, 3),
  };
}

function probeWebSocket() {
  if (!OPENCLAW_GATEWAY_WS_URL) {
    return Promise.resolve({ ok: false, configured: false, error: 'OPENCLAW_GATEWAY_URL not configured' });
  }
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let socket = null;
    const finish = (result = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.terminate?.();
      } catch {
        // Best-effort local probe cleanup only.
      }
      resolve({
        configured: true,
        url: redactUrl(OPENCLAW_GATEWAY_WS_URL),
        latencyMs: Date.now() - startedAt,
        ...result,
      });
    };
    const timer = setTimeout(() => {
      finish({ ok: false, readyState: socket?.readyState ?? WebSocket.CLOSED, error: `handshake_timeout_${PROBE_TIMEOUT_MS}ms` });
    }, PROBE_TIMEOUT_MS);

    try {
      socket = new WebSocket(OPENCLAW_GATEWAY_WS_URL, {
        headers: OPENCLAW_GATEWAY_TOKEN ? { Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}` } : {},
        handshakeTimeout: PROBE_TIMEOUT_MS,
      });
      socket.once('open', () => {
        if (OPENCLAW_GATEWAY_TOKEN) {
          try {
            socket.send(JSON.stringify({ type: 'connect', token: OPENCLAW_GATEWAY_TOKEN }));
          } catch {
            // Handshake success is enough for this heartbeat.
          }
        }
        finish({ ok: true, readyState: WebSocket.OPEN });
      });
      socket.once('error', (error) => {
        finish({ ok: false, readyState: socket?.readyState ?? WebSocket.CLOSED, error: error?.message || String(error) });
      });
      socket.once('close', (code, reason) => {
        if (settled) return;
        finish({
          ok: false,
          readyState: WebSocket.CLOSED,
          closeCode: code,
          error: String(reason || '').trim() || `closed_${code || 'unknown'}`,
        });
      });
    } catch (error) {
      finish({ ok: false, readyState: WebSocket.CLOSED, error: error?.message || String(error) });
    }
  });
}

async function sendHeartbeat() {
  if (!BRIDGE_API_KEY) {
    throw new Error('PBK_BRIDGE_API_KEY is required to post the OpenClaw gateway heartbeat.');
  }
  const [http, websocket] = await Promise.all([probeHttp(), probeWebSocket()]);
  const payload = {
    source: 'openclaw-gateway-heartbeat',
    host: os.hostname(),
    pid: process.pid,
    platform: `${process.platform}/${process.arch}`,
    mode: 'local-outbound',
    checkedAt: new Date().toISOString(),
    gatewayUrl: OPENCLAW_GATEWAY_WS_URL || OPENCLAW_GATEWAY_HTTP_URL,
    ready: Boolean(http.ok || websocket.ok),
    http,
    websocket,
    runtime: {
      uptimeSeconds: Math.round(process.uptime()),
      memory: process.memoryUsage(),
    },
  };

  const response = await fetch(`${BRIDGE_URL}/api/gateway/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || body?.gateway?.note || `Bridge returned ${response.status}`);
  }
  return {
    ok: body.ok,
    status: response.status,
    ready: Boolean(body.gateway?.ready || body.heartbeat?.ready),
    note: body.gateway?.note || body.heartbeat?.note || '',
    httpLatencyMs: http.latencyMs,
    wsLatencyMs: websocket.latencyMs,
  };
}

async function main() {
  if (SKILL_STATS || RUN_AUTO_SKILL_LEARNER) {
    try {
      const result = SKILL_STATS ? await getSkillStats() : await runAutoSkillLearnerCommand();
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({
        checkedAt: new Date().toISOString(),
        ok: false,
        error: error?.message || String(error),
      }, null, 2));
      process.exitCode = 1;
    }
    return;
  }
  do {
    try {
      const result = await sendHeartbeat();
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        checkedAt: new Date().toISOString(),
        ok: false,
        error: error?.message || String(error),
      }));
      if (ONCE) process.exitCode = 1;
    }
    if (ONCE) break;
    await delay(INTERVAL_MS);
  } while (true);
}

await main();
