// Run with node --test; keep separate from Jest's *.test.mjs discovery.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { readdir } from 'node:fs/promises';
import dgram from 'node:dgram';
import { buildSmokeEnv, startIsolatedBridge } from './bridge-smoke-isolation.mjs';

test('only OS necessities and fixture configuration reach the child', () => {
  const stateDir = join(tmpdir(), 'sample-only-state');
  const env = buildSmokeEnv(stateDir, 12345, 'sample-auth', 'sample-nonce', {
    SystemRoot: 'C:\\Windows', PATH: 'sample-path', NODE_OPTIONS: '--import=bad',
    PBK_DATABASE_URL: 'sample-database-poison', PBK_TELNYX_API_KEY: 'sample-provider-poison',
    PBK_BRIDGE_API_KEY: 'sample-working-authority', PBK_OPENCLAW_STATE_DIR: 'working-data',
    PBK_OPENCLAW_PORT: '8788', RENDER: 'true', HTTP_PROXY: 'sample-proxy',
  });
  assert.equal(env.PBK_OPENCLAW_STATE_DIR, stateDir);
  assert.equal(env.PBK_BRIDGE_API_KEY, 'sample-auth');
  assert.equal(env.PBK_OPENCLAW_PORT, '12345');
  for (const key of ['NODE_OPTIONS', 'PBK_DATABASE_URL', 'PBK_TELNYX_API_KEY', 'RENDER', 'HTTP_PROXY']) assert.equal(env[key], undefined);
  assert.equal(env.HOME, stateDir);
  assert.equal(env.USERPROFILE, stateDir);
});

test('sample child cannot write working data, launch processes or contact a canary', async () => {
  const parentDir = await mkdtemp(join(tmpdir(), 'pbk-smoke-safety-test-'));
  const sentinel = join(parentDir, 'working-state.json');
  await writeFile(sentinel, 'working data must remain unchanged');
  let requests = 0;
  let packets = 0;
  const dnsCanary = dgram.createSocket('udp4');
  dnsCanary.on('message', () => { packets++; });
  await new Promise(resolve => dnsCanary.bind(0, '127.0.0.1', resolve));
  const canary = createServer((_req, res) => { requests++; res.end('must never be contacted'); });
  await new Promise(resolve => canary.listen(0, '127.0.0.1', resolve));
  let harness;
  try {
    harness = await startIsolatedBridge({
      entry: fileURLToPath(new URL('./fixtures/bridge-smoke-isolation-probe.mjs', import.meta.url)),
      args: [sentinel, `http://127.0.0.1:${canary.address().port}`, String(dnsCanary.address().port)],
    });
    const report = await harness.fetch(harness.origin + '/report').then(res => res.json());
    assert.ok(report.stateWritten);
    assert.ok(report.userEnvEmpty);
    assert.ok(report.workingWriteBlocked);
    assert.ok(report.symlinkBlocked);
    assert.ok(report.hardlinkBlocked);
    assert.ok(report.processBlocked);
    assert.ok(report.workerBlocked);
    assert.ok(report.sqliteBlocked);
    assert.ok(report.pdfIsFixture);
    assert.ok(report.pdfNavigationBlocked);
    for (const [name, blocked] of Object.entries(report.network)) assert.ok(blocked, `${name} must be blocked`);
    assert.equal(requests, 0);
    assert.equal(packets, 0);
    assert.equal(await readFile(sentinel, 'utf8'), 'working data must remain unchanged');
    await assert.rejects(harness.fetch(`http://127.0.0.1:${canary.address().port}`), /origin/);
    await assert.rejects(harness.fetch(harness.origin + '/redirect'), error => /redirect/i.test(error.cause?.message || error.message));
    assert.equal(requests, 0);
    const root = harness.stateDir;
    await harness.stop();
    await harness.stop();
    await assert.rejects(access(root));
    await assert.rejects(fetch(harness.origin + '/report', { signal: AbortSignal.timeout(1000) }));
  } finally {
    await harness?.stop();
    await new Promise(resolve => canary.close(resolve));
    await new Promise(resolve => dnsCanary.close(resolve));
    await rm(parentDir, { recursive: true, force: true });
  }
});

test('failed child startup cleans up its disposable root without contacting an existing server', async () => {
  const before = (await readdir(tmpdir())).filter(name => name.startsWith('pbk-bridge-smoke-')).sort();
  await assert.rejects(startIsolatedBridge({ entry: fileURLToPath(new URL('./fixtures/does-not-exist.mjs', import.meta.url)) }), /exited|startup/i);
  assert.deepEqual((await readdir(tmpdir())).filter(name => name.startsWith('pbk-bridge-smoke-')).sort(), before);
});

test('bind collision does not send health or reset requests to another listener', async () => {
  let requests = 0;
  const existing = createServer((_req, res) => { requests++; res.end('working bridge sentinel'); });
  await new Promise(resolve => existing.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(startIsolatedBridge({
      entry: fileURLToPath(new URL('./fixtures/bridge-smoke-lifecycle-probe.mjs', import.meta.url)),
      args: [String(existing.address().port)],
    }), /exited.*startup/);
    assert.equal(requests, 0);
    assert.ok(existing.listening);
  } finally { await new Promise(resolve => existing.close(resolve)); }
});

for (const abrupt of [false, true]) test(`${abrupt ? 'abrupt parent death' : 'handled interrupt'} closes the isolated child safely`, async () => {
  const harnessUrl = new URL('./bridge-smoke-isolation.mjs', import.meta.url).href;
  const probePath = fileURLToPath(new URL('./fixtures/bridge-smoke-lifecycle-probe.mjs', import.meta.url));
  const driver = `import { startIsolatedBridge } from ${JSON.stringify(harnessUrl)};
    const h = await startIsolatedBridge({entry:${JSON.stringify(probePath)}});
    console.log(JSON.stringify({stateDir:h.stateDir,origin:h.origin}));
    process.on('message', () => process.emit('SIGINT'));
    setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', driver], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const closed = once(parent, 'close');
  let report;
  try {
    report = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Lifecycle probe did not start')), 10000);
      let text = '';
      parent.stdout.on('data', chunk => {
        text += chunk;
        if (text.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(text.trim())); }
      });
      parent.once('error', error => { clearTimeout(timer); reject(error); });
      parent.once('close', () => { clearTimeout(timer); reject(new Error('Lifecycle driver exited early')); });
    });
    if (abrupt) parent.kill('SIGKILL');
    else parent.send('interrupt');
    await closed;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await access(report.stateDir).then(() => false, () => true)) break;
      await delay(100);
    }
    if (!abrupt) await assert.rejects(access(report.stateDir));
    await assert.rejects(fetch(report.origin, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    await closed;
    // SIGKILL can bypass all finalizers on Windows; only disposable state may remain.
    if (report && await access(report.stateDir).then(() => true, () => false)) {
      assert.equal(path.dirname(path.resolve(report.stateDir)), path.resolve(tmpdir()));
      assert.ok(path.basename(report.stateDir).startsWith('pbk-bridge-smoke-'));
      await rm(report.stateDir, { recursive: true, force: true });
    }
  }
});

test('expired child authority cannot POST to a replacement listener on its old port', async () => {
  const harness = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/bridge-smoke-lifecycle-probe.mjs', import.meta.url)), lifetimeMs: 30,
  });
  let requests = 0;
  const replacement = createServer((_req, res) => { requests++; res.end('working service'); });
  try {
    await delay(250);
    await new Promise((resolve, reject) => {
      replacement.once('error', reject);
      replacement.listen(Number(new URL(harness.origin).port), '127.0.0.1', resolve);
    });
    await assert.rejects(harness.fetch(harness.origin + '/reset', { method: 'POST' }), /stopped/);
    assert.equal(requests, 0);
  } finally {
    await harness.stop();
    await new Promise(resolve => replacement.close(resolve));
  }
});

test('stopping the child aborts an in-flight request', async () => {
  const harness = await startIsolatedBridge({
    entry: fileURLToPath(new URL('./fixtures/bridge-smoke-lifecycle-probe.mjs', import.meta.url)),
  });
  try {
    const rejected = assert.rejects(harness.fetch(harness.origin + '/hang'));
    await delay(30);
    await harness.stop();
    await rejected;
    await assert.rejects(harness.fetch(harness.origin), /stopped/);
  } finally { await harness.stop(); }
});
