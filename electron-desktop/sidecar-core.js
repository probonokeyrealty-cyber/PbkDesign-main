const path = require('node:path');

const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const DEFAULT_SCREENSHOT_WIDTH = 1280;
const DEFAULT_SCREENSHOT_HEIGHT = 720;
const MIN_SCREENSHOT_WIDTH = 320;
const MIN_SCREENSHOT_HEIGHT = 180;
const MAX_SCREENSHOT_WIDTH = 1920;
const MAX_SCREENSHOT_HEIGHT = 1080;
const DEFAULT_ALLOWED_ACTIONS = new Set([
  'ping',
  'status',
  'read_file',
  'list_dir',
  'screenshot',
  'screenshot_ocr',
  'type_text',
  'llm_query',
  'watch_folder',
]);

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function buildBridgeSidecarUrl(input = '') {
  const raw = String(input || '').trim() || 'https://pbk-openclaw-bridge.onrender.com';
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!url.pathname || url.pathname === '/') url.pathname = '/ws/sidecar';
  return url.toString().replace(/\/$/, '');
}

function normalizeScreenshotDimension(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const dimension = Number(value);
  if (!Number.isFinite(dimension)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(dimension)));
}

function normalizeScreenshotDimensions(input = {}) {
  return {
    width: normalizeScreenshotDimension(
      input.width,
      DEFAULT_SCREENSHOT_WIDTH,
      MIN_SCREENSHOT_WIDTH,
      MAX_SCREENSHOT_WIDTH,
    ),
    height: normalizeScreenshotDimension(
      input.height,
      DEFAULT_SCREENSHOT_HEIGHT,
      MIN_SCREENSHOT_HEIGHT,
      MAX_SCREENSHOT_HEIGHT,
    ),
  };
}

function normalizeAllowedRoots(rawRoots = '', fallbackRoots = []) {
  const candidates = Array.isArray(rawRoots)
    ? rawRoots
    : String(rawRoots || '').split(/[;\n]/);
  return [...candidates, ...fallbackRoots]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((item) => path.resolve(item))
    .filter((item, index, all) => all.indexOf(item) === index);
}

function isPathInsideRoot(candidatePath = '', rootPath = '') {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveAllowedPath(candidatePath = '', allowedRoots = []) {
  const resolvedPath = path.resolve(String(candidatePath || '').trim());
  const normalizedRoots = normalizeAllowedRoots(allowedRoots);
  const allowed = normalizedRoots.some((root) => isPathInsideRoot(resolvedPath, root));
  return {
    ok: allowed,
    path: resolvedPath,
    reason: allowed ? 'allowed' : 'path_not_allowed',
    allowedRoot: normalizedRoots.find((root) => isPathInsideRoot(resolvedPath, root)) || '',
  };
}

function redactSensitiveText(value = '') {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-api-key]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
}

function limitText(value = '', maxBytes = DEFAULT_MAX_TEXT_BYTES) {
  const text = redactSensitiveText(String(value || ''));
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return `${buffer.subarray(0, maxBytes).toString('utf8')}\n[truncated:${buffer.length - maxBytes} bytes]`;
}

function normalizeCommand(raw = {}) {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  return {
    ...payload,
    id: String(payload.id || raw.id || `sidecar-command-${Date.now()}`),
    action: String(payload.action || '').trim().toLowerCase(),
  };
}

function validateSidecarCommand(raw = {}, config = {}) {
  const command = normalizeCommand(raw);
  if (!command.action || !DEFAULT_ALLOWED_ACTIONS.has(command.action)) {
    return { ok: false, reason: 'unsupported_action', command };
  }

  if (['read_file', 'list_dir', 'watch_folder'].includes(command.action)) {
    const resolved = resolveAllowedPath(command.path || command.folder || command.root || '', config.allowedRoots || []);
    if (!resolved.ok) return { ok: false, reason: resolved.reason, command: { ...command, path: resolved.path } };
    return { ok: true, command: { ...command, path: resolved.path, allowedRoot: resolved.allowedRoot } };
  }

  if (['type_text'].includes(command.action) && !config.automationEnabled) {
    return { ok: false, reason: 'automation_disabled', command };
  }

  if (['screenshot', 'screenshot_ocr'].includes(command.action) && !config.screenEnabled) {
    return { ok: false, reason: 'screen_observation_disabled', command };
  }

  if (command.action === 'llm_query' && !config.localLlmEnabled) {
    return { ok: false, reason: 'local_llm_disabled', command };
  }

  return { ok: true, command };
}

function buildSidecarStatusPayload(config = {}) {
  const allowedRoots = normalizeAllowedRoots(config.allowedRoots || []);
  return {
    ok: true,
    connected: Boolean(config.connected),
    sidecarId: config.sidecarId || '',
    machineName: config.machineName || '',
    startedAt: config.startedAt || '',
    lastBridgeMessageAt: config.lastBridgeMessageAt || '',
    allowedRootLabels: allowedRoots.map((root) => path.basename(root) || root),
    capabilities: {
      readFile: allowedRoots.length > 0,
      listDir: allowedRoots.length > 0,
      watchFolder: allowedRoots.length > 0,
      screenObserve: Boolean(config.screenEnabled),
      typeText: Boolean(config.automationEnabled),
      localLlm: Boolean(config.localLlmEnabled),
    },
  };
}

function buildSidecarHeartbeatPayload(config = {}) {
  const status = config.status && typeof config.status === 'object' ? config.status : {};
  return {
    type: config.type || 'sidecar.heartbeat',
    sidecarId: config.sidecarId || status.sidecarId || '',
    status,
  };
}

function buildCommandResult(command = {}, result = {}) {
  return {
    type: 'sidecar.command.result',
    commandId: command.id || '',
    action: command.action || '',
    ok: result.ok !== false,
    result: result.result || 'complete',
    payload: result.payload || {},
    error: result.error || '',
    at: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_MAX_TEXT_BYTES,
  buildBridgeSidecarUrl,
  buildCommandResult,
  buildSidecarHeartbeatPayload,
  buildSidecarStatusPayload,
  isTruthy,
  limitText,
  normalizeAllowedRoots,
  normalizeCommand,
  normalizeScreenshotDimensions,
  redactSensitiveText,
  resolveAllowedPath,
  validateSidecarCommand,
};
