import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = 33517;
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_BODY_LIMIT_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function npmScriptInvocation(scriptName) {
  const cliPath = process.platform === 'win32' ? npmCliPath() : null;
  if (cliPath) {
    return {
      command: process.execPath,
      args: [cliPath, 'run', scriptName],
    };
  }
  return {
    command: npmCommand(),
    args: ['run', scriptName],
  };
}

function scriptAction(scriptName, description, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const invocation = npmScriptInvocation(scriptName);
  return {
    command: invocation.command,
    args: invocation.args,
    description,
    timeoutMs,
  };
}

export function buildDefaultLocalCallbackActions() {
  return {
    build: scriptAction('build', 'Build the PBK dashboard bundle.', 10 * 60 * 1000),
    'test:bridge': scriptAction('test:bridge', 'Run the OpenClaw bridge smoke test.', 10 * 60 * 1000),
    'test:mcp': scriptAction('test:mcp', 'Run the MCP server typecheck.', 5 * 60 * 1000),
    'test:ui-actions': scriptAction('test:ui-actions', 'Run UI action wiring smoke checks.', 5 * 60 * 1000),
    'test:founder': scriptAction('test:founder', 'Run the full founder release gate.', 45 * 60 * 1000),
    'openclaw:heartbeat:once': scriptAction('openclaw:heartbeat:once', 'Send one OpenClaw gateway heartbeat.', 2 * 60 * 1000),
    'ava:memory:worker': scriptAction('ava:memory:worker', 'Run one Ava memory worker pass.', 10 * 60 * 1000),
  };
}

function loadJsonEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error?.message || error}`);
  }
}

function sanitizeActionName(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_.-]/g, '')
    .slice(0, 120);
}

function normalizeStringArray(value, maxItems = 24) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => String(item ?? '').slice(0, 500));
}

function validateActionConfig(actionName, action = {}) {
  const command = String(action.command || '').trim();
  if (!actionName || !command) return null;
  const args = normalizeStringArray(action.args || []);
  const timeoutMs = Math.max(1000, Math.min(60 * 60 * 1000, Number(action.timeoutMs || DEFAULT_TIMEOUT_MS)));
  const outputLimitBytes = Math.max(1024, Math.min(1024 * 1024, Number(action.outputLimitBytes || DEFAULT_OUTPUT_LIMIT_BYTES)));
  const cwd = action.cwd ? path.resolve(ROOT_DIR, String(action.cwd || '')) : ROOT_DIR;
  if (!cwd.startsWith(ROOT_DIR) || !existsSync(cwd)) {
    throw new Error(`Local callback action "${actionName}" has an invalid cwd.`);
  }
  return {
    command,
    args,
    cwd,
    timeoutMs,
    outputLimitBytes,
    description: String(action.description || '').slice(0, 240),
    allowExtraArgs: Boolean(action.allowExtraArgs),
  };
}

export function buildLocalCallbackActions() {
  const defaults = buildDefaultLocalCallbackActions();
  const custom = loadJsonEnv('PBK_LOCAL_TRIGGER_ACTIONS_JSON') || {};
  const merged = { ...defaults, ...(custom && typeof custom === 'object' ? custom : {}) };
  const allowedRaw = String(process.env.PBK_LOCAL_TRIGGER_ALLOWED_ACTIONS || '')
    .split(',')
    .map(sanitizeActionName)
    .filter(Boolean);
  const allowed = allowedRaw.length ? new Set(allowedRaw) : null;
  const actions = {};
  for (const [rawName, config] of Object.entries(merged)) {
    const actionName = sanitizeActionName(rawName);
    if (!actionName || (allowed && !allowed.has(actionName))) continue;
    const normalized = validateActionConfig(actionName, config);
    if (normalized) actions[actionName] = normalized;
  }
  return actions;
}

function jsonResponse(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request, limitBytes = DEFAULT_BODY_LIMIT_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      const error = new Error('Request body is too large.');
      error.code = 'body_too_large';
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    const wrapped = new Error(`Request body must be JSON: ${error?.message || error}`);
    wrapped.code = 'invalid_json';
    throw wrapped;
  }
}

function getRequestToken(request) {
  const headerToken = String(request.headers['x-pbk-local-callback-token'] || request.headers['x-pbk-trigger-token'] || '').trim();
  if (headerToken) return headerToken;
  const auth = String(request.headers.authorization || '').trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function appendLimited(buffer, chunk, limitBytes) {
  if (buffer.length >= limitBytes) return buffer;
  const available = limitBytes - buffer.length;
  return Buffer.concat([buffer, chunk.slice(0, available)]);
}

export function resolveLocalCallbackAction(actions, body = {}) {
  const actionName = sanitizeActionName(body.action || body.name || '');
  if (!actionName) {
    return {
      ok: false,
      statusCode: 400,
      code: 'action_required',
      error: 'Provide an allowlisted action name in the request body.',
    };
  }
  const action = actions[actionName];
  if (!action) {
    return {
      ok: false,
      statusCode: 400,
      code: 'unknown_action',
      error: `Local callback action "${actionName}" is not allowlisted.`,
      allowedActions: Object.keys(actions).sort(),
    };
  }
  const extraArgs = normalizeStringArray(body.args || []);
  if (extraArgs.length && !action.allowExtraArgs) {
    return {
      ok: false,
      statusCode: 400,
      code: 'extra_args_not_allowed',
      error: `Local callback action "${actionName}" does not accept request-provided args.`,
    };
  }
  if (extraArgs.some((arg) => /\0|\r|\n/.test(arg))) {
    return {
      ok: false,
      statusCode: 400,
      code: 'invalid_args',
      error: 'Request-provided args cannot contain null bytes or newlines.',
    };
  }
  return {
    ok: true,
    actionName,
    action: {
      ...action,
      args: [...action.args, ...extraArgs],
    },
  };
}

export async function runLocalCallbackAction(actionName, action = {}) {
  const startedAt = Date.now();
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(action.command, action.args, {
        cwd: action.cwd || ROOT_DIR,
        env: process.env,
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        ok: false,
        action: actionName,
        code: 'spawn_failed',
        error: error?.message || String(error),
        exitCode: null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        action: actionName,
        code: 'action_timeout',
        exitCode: null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    }, action.timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout = appendLimited(stdout, Buffer.from(chunk), action.outputLimitBytes || DEFAULT_OUTPUT_LIMIT_BYTES);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendLimited(stderr, Buffer.from(chunk), action.outputLimitBytes || DEFAULT_OUTPUT_LIMIT_BYTES);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        action: actionName,
        code: 'spawn_failed',
        error: error?.message || String(error),
        exitCode: null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: exitCode === 0,
        action: actionName,
        code: exitCode === 0 ? 'ok' : 'action_failed',
        exitCode,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export function createLocalCallbackServer(options = {}) {
  const token = String(options.token || process.env.PBK_LOCAL_TRIGGER_TOKEN || process.env.PBK_LOCAL_CALLBACK_TOKEN || '').trim();
  const actions = options.actions || buildLocalCallbackActions();
  const bodyLimitBytes = Number(options.bodyLimitBytes || DEFAULT_BODY_LIMIT_BYTES);
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname.replace(/\/+$/g, '') || '/';

    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      jsonResponse(response, 200, {
        ok: true,
        service: 'pbk-local-callback',
        actions: Object.keys(actions).sort(),
      });
      return;
    }

    if (request.method !== 'POST' || pathname !== '/trigger') {
      jsonResponse(response, 404, {
        ok: false,
        error: `No route for ${request.method} ${pathname}`,
        available: ['GET /health', 'POST /trigger'],
      });
      return;
    }

    if (!token || getRequestToken(request) !== token) {
      jsonResponse(response, 401, {
        ok: false,
        code: 'unauthorized',
        error: 'Missing or invalid X-PBK-Local-Callback-Token.',
      });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request, bodyLimitBytes);
    } catch (error) {
      jsonResponse(response, error?.code === 'body_too_large' ? 413 : 400, {
        ok: false,
        code: error?.code || 'invalid_request_body',
        error: error?.message || String(error),
      });
      return;
    }

    const resolved = resolveLocalCallbackAction(actions, body);
    if (!resolved.ok) {
      jsonResponse(response, resolved.statusCode || 400, resolved);
      return;
    }

    if (body.dryRun) {
      jsonResponse(response, 200, {
        ok: true,
        dryRun: true,
        action: resolved.actionName,
        command: resolved.action.command,
        args: resolved.action.args,
        cwd: path.relative(ROOT_DIR, resolved.action.cwd || ROOT_DIR) || '.',
        description: resolved.action.description,
      });
      return;
    }

    const result = await runLocalCallbackAction(resolved.actionName, resolved.action);
    jsonResponse(response, result.ok ? 200 : result.code === 'action_timeout' ? 504 : 500, result);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const token = String(process.env.PBK_LOCAL_TRIGGER_TOKEN || process.env.PBK_LOCAL_CALLBACK_TOKEN || '').trim();
  if (!token) {
    console.error('[pbk-local-callback] PBK_LOCAL_TRIGGER_TOKEN is required before exposing this server through ngrok.');
    process.exit(1);
  }
  const host = String(process.env.PBK_LOCAL_TRIGGER_HOST || '127.0.0.1').trim();
  const port = Number(process.env.PBK_LOCAL_TRIGGER_PORT || DEFAULT_PORT);
  const server = createLocalCallbackServer({ token });
  server.listen(port, host, () => {
    const actions = Object.keys(buildLocalCallbackActions()).sort();
    console.log(`[pbk-local-callback] listening on http://${host}:${port}`);
    console.log(`[pbk-local-callback] actions: ${actions.join(', ') || '(none)'}`);
  });
}
