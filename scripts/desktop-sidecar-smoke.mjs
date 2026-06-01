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
  buildSidecarStatusPayload,
  redactSensitiveText,
  validateSidecarCommand,
} = sidecarCore.default || sidecarCore;

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
assert.match(bridge, /async sidecarCommand/, 'bridge should expose sidecarCommand as an Ava/Rex tool.');
assert.match(bridge, /pendingSidecarCommands/, 'bridge should correlate sidecar command results.');
assert.match(electronPackage, /"ws"/, 'Electron sidecar should depend on ws for bridge connectivity.');
assert.match(electronMain, /connectDesktopSidecar/, 'Electron main process should connect the desktop sidecar.');
assert.match(electronMain, /isRecoverablePipeError/, 'Electron sidecar should classify broken pipe errors as recoverable.');
assert.match(electronMain, /safeWarn/, 'Electron sidecar should log socket errors without crashing on closed stdio pipes.');
assert.match(electronMain, /installRecoverableProcessErrorGuards/, 'Electron sidecar should install main-process recoverable error guards.');
assert.match(electronMain, /uncaughtException/, 'Electron sidecar should suppress recoverable broken-pipe uncaught exceptions.');
assert.match(electronMain, /sidecarSocket\?\.terminate/, 'Electron sidecar should terminate and reconnect after socket errors.');
assert.match(rootPackage, /test:desktop-sidecar/, 'root package should expose the desktop sidecar smoke test.');

console.log('[desktop-sidecar-smoke] ok', {
  allowedRoot: path.basename(allowedRoot),
  commandValidation: 'safe',
  bridgeRoute: '/ws/sidecar',
});
