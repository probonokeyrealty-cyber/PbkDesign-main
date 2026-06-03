import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createLocalCallbackServer } from './local-callback-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readRepoFile(filePath) {
  return readFileSync(path.join(root, filePath), 'utf8');
}

async function postJson(port, body, token = 'smoke-token') {
  const response = await fetch(`http://127.0.0.1:${port}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-PBK-Local-Callback-Token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

const server = createLocalCallbackServer({
  token: 'smoke-token',
  actions: {
    'smoke:echo': {
      command: process.execPath,
      args: ['-e', "console.log('local callback smoke ok')"],
      description: 'Smoke-test action',
      timeoutMs: 5000,
    },
  },
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const port = server.address().port;

  const health = await fetch(`http://127.0.0.1:${port}/health`).then((res) => res.json());
  assert.equal(health.ok, true, 'health endpoint should be available');
  assert.deepEqual(health.actions, ['smoke:echo'], 'health endpoint should expose action names only');

  const unauthenticated = await postJson(port, { action: 'smoke:echo' }, '');
  assert.equal(unauthenticated.response.status, 401, 'trigger endpoint should require a callback token');

  const unknown = await postJson(port, { action: 'powershell', args: ['whoami'] });
  assert.equal(unknown.response.status, 400, 'unknown actions should be rejected');
  assert.equal(unknown.payload.code, 'unknown_action');

  const legacyRceShape = await postJson(port, { script: 'powershell', args: ['whoami'] });
  assert.equal(legacyRceShape.response.status, 400, 'legacy arbitrary script shape should not execute');

  const dryRun = await postJson(port, { action: 'smoke:echo', dryRun: true });
  assert.equal(dryRun.response.status, 200, 'dry run should succeed');
  assert.equal(dryRun.payload.ok, true);
  assert.equal(dryRun.payload.dryRun, true);
  assert.equal(dryRun.payload.command, process.execPath);
  assert.deepEqual(dryRun.payload.args, ['-e', "console.log('local callback smoke ok')"]);
  assert.equal(dryRun.payload.stdout, undefined, 'dry run should not execute the command');

  const executed = await postJson(port, { action: 'smoke:echo' });
  assert.equal(executed.response.status, 200, 'allowlisted action should execute');
  assert.equal(executed.payload.ok, true);
  assert.match(executed.payload.stdout, /local callback smoke ok/);
  assert.equal(executed.payload.stderr, '');
} finally {
  server.close();
  await once(server, 'close');
}

const bridge = readRepoFile('scripts/openclaw-local-server.mjs');
const envExample = readRepoFile('.env.example');
const pkg = JSON.parse(readRepoFile('package.json'));

assert.match(bridge, /PBK_LOCAL_CALLBACK_URL/, 'bridge should read PBK_LOCAL_CALLBACK_URL.');
assert.match(bridge, /PBK_LOCAL_CALLBACK_TOKEN/, 'bridge should pass PBK_LOCAL_CALLBACK_TOKEN to the local sidecar.');
assert.match(bridge, /invokeLocalCallback/, 'bridge should expose a local callback forwarding helper.');
assert.match(bridge, /\/api\/local-callback\/status/, 'bridge should expose local callback status.');
assert.match(bridge, /\/api\/local-callback\/trigger/, 'bridge should expose a protected trigger endpoint.');
assert.match(bridge, /X-PBK-Local-Callback-Token/, 'bridge CORS/docs should recognize the callback token header.');

assert.match(envExample, /PBK_LOCAL_CALLBACK_URL=/, '.env.example should document PBK_LOCAL_CALLBACK_URL.');
assert.match(envExample, /PBK_LOCAL_CALLBACK_TOKEN=/, '.env.example should document PBK_LOCAL_CALLBACK_TOKEN.');
assert.match(envExample, /PBK_LOCAL_TRIGGER_TOKEN=/, '.env.example should document the local sidecar token.');

assert.equal(pkg.scripts?.['local:callback'], 'node ./scripts/local-callback-server.mjs', 'package.json should expose local:callback.');
assert.equal(pkg.scripts?.['test:local-callback'], 'node ./scripts/local-callback-server-smoke.mjs', 'package.json should expose test:local-callback.');

console.log('[local-callback-server-smoke] ok');
