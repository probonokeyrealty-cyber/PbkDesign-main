import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sidecarCorePath = path.resolve('electron-desktop/sidecar-core.js');
assert.equal(existsSync(sidecarCorePath), true, 'desktop sidecar core module should exist.');

const sidecarCore = await import(pathToFileURL(sidecarCorePath).href);
const {
  buildBridgeSidecarUrl,
  buildSidecarHeartbeatPayload,
  buildSidecarStatusPayload,
  normalizeScreenshotDimensions,
  redactSensitiveText,
  validateSidecarCommand,
} = sidecarCore.default || sidecarCore;

assert.equal(typeof normalizeScreenshotDimensions, 'function', 'sidecar core should export screenshot dimension normalization.');
assert.equal(typeof buildSidecarHeartbeatPayload, 'function', 'sidecar core should export heartbeat payload construction.');

assert.equal(
  buildBridgeSidecarUrl('https://pbk-openclaw-bridge.onrender.com'),
  'wss://pbk-openclaw-bridge.onrender.com/ws/sidecar',
  'bridge HTTPS URL should normalize to secure sidecar WebSocket URL.',
);
assert.equal(
  buildBridgeSidecarUrl('http://localhost:8787/custom-sidecar'),
  'ws://localhost:8787/custom-sidecar',
  'explicit local sidecar URL should keep its path and use ws protocol.',
);

assert.deepEqual(
  normalizeScreenshotDimensions({}),
  { width: 1280, height: 720 },
  'screenshots should use bounded desktop-friendly default dimensions.',
);
assert.deepEqual(
  normalizeScreenshotDimensions({ width: 1, height: 120 }),
  { width: 320, height: 180 },
  'screenshots should enforce minimum dimensions.',
);
assert.deepEqual(
  normalizeScreenshotDimensions({ width: 4000, height: 3000 }),
  { width: 1920, height: 1080 },
  'screenshots should enforce maximum dimensions.',
);
assert.deepEqual(
  normalizeScreenshotDimensions({ width: 'invalid', height: null }),
  { width: 1280, height: 720 },
  'invalid screenshot dimensions should fall back to defaults.',
);

const workspace = path.join(tmpdir(), `pbk-sidecar-smoke-${Date.now()}`);
const allowedRoot = path.join(workspace, 'allowed');
const blockedRoot = path.join(workspace, 'blocked');
mkdirSync(allowedRoot, { recursive: true });
mkdirSync(blockedRoot, { recursive: true });
const allowedFile = path.join(allowedRoot, 'deal-memo.txt');
const blockedFile = path.join(blockedRoot, 'private.txt');
writeFileSync(allowedFile, 'seller wants speed and certainty');
writeFileSync(blockedFile, 'do not read');

try {
  const allowedRead = validateSidecarCommand({
    action: 'read_file',
    path: allowedFile,
  }, {
    allowedRoots: [allowedRoot],
    automationEnabled: false,
    screenEnabled: false,
    localLlmEnabled: false,
  });
  assert.equal(allowedRead.ok, true, 'read_file should allow files under configured roots.');
  assert.equal(allowedRead.command.path, path.resolve(allowedFile));

  const blockedRead = validateSidecarCommand({
    action: 'read_file',
    path: blockedFile,
  }, {
    allowedRoots: [allowedRoot],
    automationEnabled: false,
    screenEnabled: false,
    localLlmEnabled: false,
  });
  assert.equal(blockedRead.ok, false, 'read_file should reject files outside configured roots.');
  assert.equal(blockedRead.reason, 'path_not_allowed');

  const automationBlocked = validateSidecarCommand({ action: 'type_text', text: 'hello' }, {
    allowedRoots: [allowedRoot],
    automationEnabled: false,
  });
  assert.equal(automationBlocked.ok, false, 'desktop automation should be disabled unless explicitly enabled.');
  assert.equal(automationBlocked.reason, 'automation_disabled');

  const status = buildSidecarStatusPayload({
    connected: true,
    sidecarId: 'sidecar-local',
    allowedRoots: [allowedRoot],
    automationEnabled: false,
    screenEnabled: true,
    localLlmEnabled: true,
  });
  assert.equal(status.connected, true);
  assert.equal(status.capabilities.readFile, true);
  assert.equal(status.capabilities.typeText, false);
  assert.equal(status.capabilities.screenObserve, true);
  assert.equal(status.capabilities.localLlm, true);
  assert.deepEqual(status.allowedRootLabels, [path.basename(allowedRoot)]);

  assert.deepEqual(
    buildSidecarHeartbeatPayload({
      sidecarId: 'sidecar-local',
      status,
    }),
    {
      type: 'sidecar.heartbeat',
      sidecarId: 'sidecar-local',
      status,
    },
    'heartbeat payloads should identify the sidecar and include its current status.',
  );
  assert.deepEqual(
    buildSidecarHeartbeatPayload({
      type: 'sidecar.pong',
      sidecarId: 'sidecar-local',
      status,
    }),
    {
      type: 'sidecar.pong',
      sidecarId: 'sidecar-local',
      status,
    },
    'bridge ping responses should reuse the bounded presence payload shape.',
  );

  const redacted = redactSensitiveText('api key sk-live-abc123 and token=secret-value');
  assert(!redacted.includes('sk-live-abc123'), 'sidecar outbound payloads should redact API-looking secrets.');
  assert(!redacted.includes('secret-value'), 'sidecar outbound payloads should redact token values.');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

const bridge = readFileSync(path.resolve('scripts/openclaw-local-server.mjs'), 'utf8');
const electronPackage = readFileSync(path.resolve('electron-desktop/package.json'), 'utf8');
const electronMain = readFileSync(path.resolve('electron-desktop/main.js'), 'utf8');
const rootPackage = readFileSync(path.resolve('package.json'), 'utf8');

assert.match(bridge, /desktopSidecarWss/, 'bridge should define a dedicated desktop sidecar WebSocket server.');
assert.match(bridge, /\/ws\/sidecar/, 'bridge should expose WS /ws/sidecar.');
assert.match(bridge, /PBK_SIDECAR_TOKEN/, 'bridge should support a dedicated PBK_SIDECAR_TOKEN secret.');
assert.match(bridge, /requiredSidecarToken/, 'bridge should authenticate sidecar sockets with the dedicated sidecar token when configured.');
assert.match(bridge, /\/api\/desktop-sidecar\/status/, 'bridge should expose a desktop sidecar status endpoint.');
assert.match(bridge, /\/api\/desktop-sidecar\/command/, 'bridge should expose a desktop sidecar command endpoint.');
assert.match(bridge, /const desktopSidecarStatus = buildDesktopSidecarStatus\(\)/, 'tooling status should read live desktop sidecar status.');
assert.match(bridge, /const desktopCopilotReady = Boolean\(desktopCopilotEndpointConfigured \|\| desktopSidecarConnected\)/, 'Desktop Copilot should become ready when the sidecar connects.');
assert.match(bridge, /async sidecarCommand/, 'bridge should expose sidecarCommand as an Ava/Rex tool.');
assert.match(bridge, /pendingSidecarCommands/, 'bridge should correlate sidecar command results.');
assert.match(electronPackage, /"ws"/, 'Electron sidecar should depend on ws for bridge connectivity.');
assert.match(electronMain, /connectDesktopSidecar/, 'Electron main process should connect the desktop sidecar.');
assert.match(electronMain, /isRecoverablePipeError/, 'Electron sidecar should classify broken pipe errors as recoverable.');
assert.match(electronMain, /safeWarn/, 'Electron sidecar should log socket errors without crashing on closed stdio pipes.');
assert.match(electronMain, /installRecoverableProcessErrorGuards/, 'Electron sidecar should install main-process recoverable error guards.');
assert.match(electronMain, /uncaughtException/, 'Electron sidecar should suppress recoverable broken-pipe uncaught exceptions.');
assert.match(electronMain, /sidecarSocket\?\.terminate/, 'Electron sidecar should terminate and reconnect after socket errors.');
assert.match(electronMain, /SIDECAR_HEARTBEAT_INTERVAL_MS\s*=\s*15\s*\*\s*1000/, 'Electron sidecar heartbeat should use a bounded 15 second interval.');
assert.match(electronMain, /startSidecarHeartbeat/, 'Electron sidecar should start an application heartbeat after connecting.');
assert.match(electronMain, /stopSidecarHeartbeat/, 'Electron sidecar should clean up heartbeat timers on disconnect and quit.');
assert.match(electronMain, /socket\.on\(['"]close['"][\s\S]*stopSidecarHeartbeat\(\)[\s\S]*scheduleSidecarReconnect\(\)/, 'Electron sidecar should stop heartbeat delivery before reconnecting a closed socket.');
assert.match(electronMain, /app\.on\(['"]will-quit['"][\s\S]*app\.isQuitting\s*=\s*true[\s\S]*stopSidecarHeartbeat\(\)/, 'Electron sidecar shutdown should suppress reconnects and stop heartbeat delivery.');
assert.match(electronMain, /message\.type\s*===\s*['"]sidecar\.ping['"]/, 'Electron sidecar should handle bridge sidecar.ping messages.');
assert.match(electronMain, /type:\s*['"]sidecar\.pong['"]/, 'Electron sidecar should answer bridge pings with sidecar.pong.');
assert.match(electronMain, /normalizeScreenshotDimensions\(command\)/, 'Electron screenshot capture should normalize requested dimensions server-side.');
assert.match(electronMain, /width:\s*imageSize\.width/, 'Electron screenshot results should include captured image width metadata.');
assert.match(electronMain, /height:\s*imageSize\.height/, 'Electron screenshot results should include captured image height metadata.');
assert.match(electronMain, /mediaType:\s*['"]image\/png['"]/, 'Electron screenshot results should identify PNG media.');
assert.match(electronMain, /byteLength/, 'Electron screenshot results should include image byte length metadata.');
assert.match(rootPackage, /test:desktop-sidecar/, 'root package should expose the desktop sidecar smoke test.');

console.log('[desktop-sidecar-smoke] ok', {
  allowedRoot: path.basename(allowedRoot),
  commandValidation: 'safe',
  bridgeRoute: '/ws/sidecar',
});
