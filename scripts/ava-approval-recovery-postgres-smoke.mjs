import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildAgentRuntimeSmokeEnv } from './agent-runtime-smoke-isolation.mjs';

const image = 'pgvector/pgvector:0.8.7-pg17';
const apiKey = randomUUID();
const password = randomUUID();
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, windowsHide: true }).trim();

async function listen(server) {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  return server.address().port;
}

async function poll(check, description, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

const root = await realpath(os.tmpdir());
const stateDir = await mkdtemp(path.join(root, 'pbk-ava-pg-smoke-'));
let container, proxy, child;
let bridgeLog = '';
try {
  container = docker('run', '-d', '--rm', '--pull', 'never', '-p', '127.0.0.1::5432',
    '-e', `POSTGRES_PASSWORD=${password}`, image);
  assert.match(container, /^[a-f0-9]{64}$/);
  const published = docker('port', container, '5432/tcp');
  assert.match(published, /^127\.0\.0\.1:\d+$/);
  const databasePort = Number(published.split(':').at(-1));
  await poll(() => {
    docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres');
    return true;
  }, 'disposable Postgres');

  let databaseReachable = true;
  proxy = net.createServer((client) => {
    if (!databaseReachable) {
      client.destroy();
      return;
    }
    const database = net.connect(databasePort, '127.0.0.1');
    client.pipe(database).pipe(client);
    client.on('error', () => database.destroy());
    database.on('error', () => client.destroy());
    client.on('close', () => database.destroy());
    database.on('close', () => client.destroy());
  });
  const proxyPort = await listen(proxy);
  const probe = net.createServer();
  const bridgePort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  // The hosted bridge can only connect to this fixture's database proxy and bind to loopback.
  const guard = `
    import net from 'node:net';
    import childProcess from 'node:child_process';
    import dgram from 'node:dgram';
    import { syncBuiltinESMExports } from 'node:module';
    const denied = () => { throw new Error('Ava Postgres smoke blocked a non-fixture operation'); };
    globalThis.fetch = denied;
    dgram.createSocket = denied;
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0]) ? args[0][0] : args[0];
      const port = typeof options === 'object' ? options?.port : options;
      const host = typeof options === 'object' ? options?.host : args[1];
      if (Number(port) !== ${proxyPort} || host !== '127.0.0.1') return denied();
      return connect.apply(this, args);
    };
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function (port, host, callback) {
      if (port !== ${bridgePort} || host !== '0.0.0.0') return denied();
      return listen.call(this, port, '127.0.0.1', callback);
    };
    for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
      childProcess[name] = denied;
    }
    syncBuiltinESMExports();
  `;
  const startBridge = () => {
    const processHandle = spawn(process.execPath, [
      '--import', `data:text/javascript,${encodeURIComponent(guard)}`, 'scripts/openclaw-local-server.mjs', '--public',
    ], {
      env: {
        ...buildAgentRuntimeSmokeEnv(),
        PORT: String(bridgePort),
        PBK_OPENCLAW_STATE_DIR: stateDir,
        PBK_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${proxyPort}/postgres`,
        PBK_BRIDGE_API_KEY: apiKey,
        PBK_PG_KEEPALIVE_INTERVAL_MS: '5000',
        PBK_PG_CONNECTION_TIMEOUT_MS: '1000',
        PBK_PG_QUERY_RETRY_ATTEMPTS: '1',
        PBK_REDIS_ENABLED: 'false',
        PBK_SUPABASE_ENABLED: '0',
        PBK_VOICE_PREWARM_ENABLED: 'false',
        PBK_RUNTIME_COVERAGE_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    for (const output of [processHandle.stdout, processHandle.stderr]) {
      output.on('data', (chunk) => { bridgeLog = (bridgeLog + chunk).slice(-3500); });
    }
    return processHandle;
  };
  const request = async (target, body, { method = body ? 'POST' : 'GET', stream = false } = {}) => {
    const response = await fetch(`http://127.0.0.1:${bridgePort}${target}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(stream && { Accept: 'text/event-stream' }),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    if (stream && response.ok) {
      assert.match(response.headers.get('content-type') || '', /^text\/event-stream/);
      const events = (await response.text()).split(/\r?\n\r?\n/);
      const done = events.find((item) => item.startsWith('event: done'));
      assert.ok(done, 'Ava must finish the stream with a final result.');
      const data = done.split(/\r?\n/).find((line) => line.startsWith('data: '));
      assert.ok(data, 'The final event must carry the approval receipt.');
      return { status: response.status, data: JSON.parse(data.slice('data: '.length)) };
    }
    return { status: response.status, data: await response.json() };
  };
  const state = async () => {
    const result = await request('/state');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };

  child = startBridge();
  await poll(async () => (await request('/health')).data.components?.stateBootstrap?.ready === true, 'hosted Postgres bootstrap');
  const healthy = await request('/health');
  assert.equal(healthy.data.runtime?.hosted, true);
  assert.equal(healthy.data.features?.stateBackend, 'postgres');
  const lead = await request('/api/leads/import', { leadName: 'Ava Fixture Seller', address: '12 Fixture Lane' });
  assert.equal(lead.status, 200, JSON.stringify(lead.data).slice(0, 500));
  const leadId = lead.data.leadId || lead.data.id;
  assert.ok(leadId);
  const sessionId = randomUUID();
  const scheduledAt = '2099-04-03T21:00:00.000Z';
  const message = 'Schedule a follow-up for this lead on 2099-04-03T14:00:00-07:00.';
  const chat = () => request('/api/assistant/chat', { sessionId, leadId, message, stream: true }, { stream: true });
  const prepared = await chat();
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data).slice(0, 600));
  const approvalId = prepared.data.toolResult?.approval?.id;
  assert.ok(approvalId, JSON.stringify(prepared.data.toolResult));
  const approve = () => request(`/api/approvals/${encodeURIComponent(approvalId)}`,
    { status: 'approved', actor: 'QA operator' }, { method: 'PUT' });
  const appointments = (snapshot) => snapshot.appointments.filter((item) => item.leadId === leadId);
  const queued = await state();
  assert.equal(queued.approvals.find((item) => item.id === approvalId)?.status, 'pending');
  assert.equal(appointments(queued).length, 0);
  const decisions = await Promise.all([approve(), approve()]);
  assert.ok(decisions.some((decision) => decision.status === 200 && decision.data.approval?.status === 'approved'
    && decision.data.providerActionResult?.ok === true),
    JSON.stringify(decisions.map((decision) => decision.data.providerActionResult)));
  const completed = await state();
  assert.equal(appointments(completed).length, 1);
  const [appointment] = appointments(completed);
  assert.equal(appointment.startTime, scheduledAt);

  await stopChild(child);
  databaseReachable = false;
  child = startBridge();
  await poll(async () => (await request('/health')).data.components?.stateBootstrap?.ready === false,
    'liveness while Postgres is unreachable');
  const blocked = await chat();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.result, 'state_bootstrap_unavailable');
  assert.equal((await approve()).status, 503);

  databaseReachable = true;
  await poll(async () => (await request('/health')).data.components?.stateBootstrap?.ready === true,
    'durable state recovery without another restart');
  const recovered = await state();
  assert.equal(appointments(recovered).length, 1);
  assert.equal(appointments(recovered)[0].id, appointment.id);
  assert.equal(appointments(recovered)[0].startTime, scheduledAt);
  const receipt = recovered.approvals.find((item) => item.id === approvalId);
  assert.equal(receipt?.status, 'approved');
  assert.equal(receipt?.metadata?.providerActionResult?.appointmentId, appointment.id);
  assert.equal((await approve()).status, 200);
  assert.equal(appointments(await state()).length, 1);
  console.log('PASS: Ava chat, approval, single execution, Postgres outage, state recovery, and replay.');
} catch (error) {
  console.error(bridgeLog.replaceAll(password, '[fixture password]').replaceAll(apiKey, '[fixture bridge key]'));
  throw error;
} finally {
  try {
    await stopChild(child);
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
  } finally {
    try {
      if (/^[a-f0-9]{64}$/.test(container || '')) docker('stop', container);
    } finally {
      assert.equal(path.dirname(stateDir), root);
      assert.match(path.basename(stateDir), /^pbk-ava-pg-smoke-/);
      await rm(stateDir, { recursive: true, force: true });
    }
  }
}
