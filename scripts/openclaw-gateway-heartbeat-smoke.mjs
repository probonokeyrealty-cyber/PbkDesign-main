import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const script = fileURLToPath(new URL('./openclaw-gateway-heartbeat.mjs', import.meta.url));
const server = createServer();
const sockets = new Set();
const websocket = new WebSocketServer({ server });
let mode = 'healthy';
let received = 0;
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  received += 1;
  if (req.headers.authorization !== 'Bearer test-only-key') {
    res.writeHead(401).end();
    return;
  }
  if (mode === 'hang') return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (mode === 'stalled-body') {
    res.write('{"ok":');
    return;
  }
  if (mode === 'invalid-json') {
    res.end('not json');
    return;
  }
  res.end(JSON.stringify({ ok: true, gateway: { ready: mode !== 'unhealthy' } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function run(args = ['--once']) {
  const before = received;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        PBK_BRIDGE_URL: base,
        PBK_BRIDGE_API_KEY: 'test-only-key',
        OPENCLAW_GATEWAY_TOKEN: 'test-only-gateway-token',
        OPENCLAW_GATEWAY_WS_URL: base.replace('http:', 'ws:'),
        OPENCLAW_GATEWAY_URL: base.replace('http:', 'ws:'),
        OPENCLAW_GATEWAY_HTTP_URL: base,
        PBK_OPENCLAW_BRIDGE_REQUEST_TIMEOUT_MS: '1000',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, 5000);
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, output, killed }); });
  });
  assert.ok(received > before, 'Probe must reach the fake bridge, not fail before reproducing the bug.');
  assert.equal(result.output.includes('test-only-key'), false, 'Logs must not expose bridge credentials.');
  assert.equal(result.killed, false, `${mode}: heartbeat hung beyond its request deadline`);
  return result;
}

try {
  assert.equal((await run()).code, 0, 'A healthy heartbeat must exit successfully.');
  for (const failure of ['hang', 'stalled-body', 'invalid-json', 'unhealthy']) {
    mode = failure;
    assert.equal((await run()).code, 1, `${failure}: failed heartbeat must not report success.`);
  }
  mode = 'hang';
  assert.equal((await run(['--skill-stats'])).code, 1, 'Diagnostics must also have a request deadline.');
  mode = 'healthy';
  assert.equal((await run()).code, 0, 'The next heartbeat must recover after transient failures.');
  console.log('PASS: gateway heartbeat success, deadlines, stalled bodies, invalid responses, failure exit, and recovery.');
} finally {
  for (const socket of sockets) socket.destroy();
  for (const client of websocket.clients) client.terminate();
  websocket.close();
  await new Promise((resolve) => server.close(resolve));
}
