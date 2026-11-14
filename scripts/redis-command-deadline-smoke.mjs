import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import vm from 'node:vm';
import { createClient } from 'redis';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function getSharedRedisClient()');
const end = source.indexOf('function buildSharedTelnyxSessionState(');
assert.ok(start >= 0 && end > start, 'Redis runtime section must exist');
const functions = source.slice(start, end);
const commandTimeoutMs = 40;

function runtime(createRedisClient, overrides = {}) {
  const context = vm.createContext({
    REDIS_ENABLED: true, REDIS_URL: 'redis://127.0.0.1', REDIS_NAMESPACE: 'test',
    REDIS_INSTANCE_ID: 'test-instance', REDIS_RETRY_COOLDOWN_MS: 1000,
    REDIS_CONNECT_TIMEOUT_MS: 500, REDIS_COMMAND_TIMEOUT_MS: commandTimeoutMs,
    REDIS_CALL_STATE_TTL_SECONDS: 60, REDIS_LEASE_TTL_SECONDS: 60,
    BRIDGE_READ_CACHE_DEFAULT_TTL_MS: 1000, BRIDGE_READ_CACHE_TTL_MS: {},
    sharedRedisClient: null, sharedRedisConnectPromise: null, sharedRedisDisabledUntil: 0,
    sharedRedisLastError: '', sharedRedisLastReadyAt: '',
    createRedisClient, isoNow: () => new Date().toISOString(),
    redisKey: (...parts) => ['test', ...parts].join(':'), setTimeout, clearTimeout,
    withTimeout: (promise, ms, label) => {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      })]).finally(() => clearTimeout(timer));
    },
    ...overrides,
  });
  vm.runInContext(functions, context);
  return context;
}

async function within(promise, label, ms = 500) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} left the caller hanging`)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

// RESP2 array parser: handles fragmented and pipelined commands from node-redis.
function readCommand(buffer) {
  const headerEnd = buffer.indexOf('\r\n');
  if (headerEnd < 0) return null;
  assert.equal(buffer[0], 42);
  const count = Number(buffer.toString('utf8', 1, headerEnd));
  const args = [];
  let offset = headerEnd + 2;
  for (let index = 0; index < count; index += 1) {
    const lengthEnd = buffer.indexOf('\r\n', offset);
    if (lengthEnd < 0) return null;
    assert.equal(buffer[offset], 36);
    const length = Number(buffer.toString('utf8', offset + 1, lengthEnd));
    const valueStart = lengthEnd + 2;
    if (buffer.length < valueStart + length + 2) return null;
    args.push(buffer.toString('utf8', valueStart, valueStart + length));
    offset = valueStart + length + 2;
  }
  return { args, bytes: offset };
}

async function loopbackRedis() {
  const sockets = new Set();
  const commands = [];
  const values = new Map();
  let stall = false;
  let connections = 0;
  // Avoid Nagle/delayed-ACK stalls between small pipelined replies.
  const server = net.createServer({ noDelay: true }, (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let command;
      while ((command = readCommand(pending))) {
        pending = pending.subarray(command.bytes);
        const [name, ...args] = command.args;
        if (name === 'CLIENT') {
          socket.write('+OK\r\n');
          continue;
        }
        commands.push(command.args);
        const reply = (value) => { if (!stall) socket.write(value); };
        if (name === 'GET') {
          const value = values.get(args[0]);
          reply(value === undefined ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`);
        } else if (name === 'SET') {
          if (args.includes('NX') && values.has(args[0])) reply('$-1\r\n');
          else {
            values.set(args[0], args[1]);
            reply('+OK\r\n');
          }
        } else if (name === 'EVAL') {
          const key = args[2];
          const count = Number(values.get(key) || 0) + 1;
          values.set(key, String(count));
          reply(`:${count}\r\n`);
        } else if (name === 'PING') reply('+PONG\r\n');
        else reply(':1\r\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `redis://127.0.0.1:${server.address().port}`,
    commands,
    values,
    get connections() { return connections; },
    set stall(value) { stall = value; },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const server = await loopbackRedis();
const clients = [];
const context = runtime((options) => {
  assert.equal(options.disableOfflineQueue, true);
  assert.equal(options.socket.reconnectStrategy, false);
  const client = createClient({ ...options, url: server.url });
  clients.push(client);
  return client;
});

async function reconnect() {
  server.stall = false;
  context.sharedRedisDisabledUntil = 0;
  return within(context.getSharedRedisClient(), 'Redis reconnect');
}

try {
  const client = await within(context.getSharedRedisClient(), 'Redis handshake');
  assert.equal(client.isReady, true);
  assert.equal(await client.ping(), 'PONG');
  server.stall = true;
  const started = Date.now();
  const result = await within(context.redisGetJson('stalled'), 'Established Redis GET');
  assert.equal(result, null);
  assert.ok(Date.now() - started < 500);
  assert.equal(server.commands.filter(([name]) => name === 'GET').length, 1);
  assert.equal(client.isOpen, false, 'Deadline must close the stalled socket');
  assert.equal(context.sharedRedisClient, null);
  assert.match(context.getRedisProviderMeta().lastError, /timed out/i);
  assert.equal(await context.getSharedRedisClient(), null, 'Cooldown must prevent reconnect storms');
  assert.equal(server.connections, 1);
  server.stall = false;
  context.sharedRedisDisabledUntil = 0;
  assert.equal((await context.redisSetJson('recovered', { ok: true })).ok, true);
  assert.equal((await context.redisGetJson('recovered')).ok, true);
  assert.equal(context.getRedisProviderMeta().ready, true);
  assert.equal(context.getRedisProviderMeta().lastError, '');
  assert.equal(server.connections, 2);
  console.log('Established Redis command deadline, socket cleanup, cooldown, and recovery passed.');

  const healthy = await context.getSharedRedisClient();
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await within(Promise.all([
      healthy.set(`pipeline:${index}`, 'value'), healthy.get(`pipeline:${index}`),
    ]), 'Healthy pipelined Redis replies'), ['OK', 'value']);
  }
  assert.equal(context.sharedRedisClient, healthy);
  assert.equal(context.getRedisProviderMeta().ready, true);
  console.log('Healthy pipelined Redis replies settle within the unchanged command deadline.');

  const commands = [
    ['get', ['read']],
    ['set', ['ambiguous-write', 'committed']],
    ['eval', ["return redis.call('INCR', KEYS[1])", { keys: ['counter'], arguments: [] }]],
    ['ping', []], ['del', ['remove']], ['sAdd', ['set', 'member']], ['sRem', ['set', 'member']],
    ['sMembers', ['set']], ['expire', ['key', 60]], ['lPush', ['list', 'entry']],
    ['lTrim', ['list', 0, 5]], ['lRange', ['list', 0, 5]], ['sendCommand', [['PING']]],
  ];
  for (const [name, args] of commands) {
    const active = await reconnect();
    const commandCount = server.commands.length;
    server.stall = true;
    await assert.rejects(within(active[name](...args), name), (error) => {
      assert.equal(error.code, 'REDIS_COMMAND_TIMEOUT', name);
      return true;
    });
    assert.equal(active.isOpen, false, `${name} must destroy the stalled client`);
    assert.equal(server.commands.length - commandCount, 1, `${name} must be sent only once`);
    assert.equal(context.sharedRedisClient, null);
  }
  assert.equal(server.values.get('ambiguous-write'), 'committed');
  assert.equal(server.values.get('counter'), '1', 'Ambiguous EVAL must not be retried');
  console.log('All 13 shared Redis command methods are bounded; ambiguous writes are not retried.');

  const active = await reconnect();
  server.stall = true;
  const pending = await within(Promise.allSettled([
    active.get('concurrent'), active.set('concurrent', 'value'),
    active.eval('return 1', { keys: ['concurrent-eval'], arguments: [] }),
  ]), 'Concurrent Redis commands');
  assert.ok(pending.every((result) => result.status === 'rejected'));
  assert.ok(pending.some((result) => result.reason.code === 'REDIS_COMMAND_TIMEOUT'));
  assert.equal(active.isOpen, false);

  await reconnect();
  server.stall = true;
  const countBeforeLease = server.commands.length;
  const lease = await within(context.redisAcquireLease('singleton'), 'Redis lease');
  assert.equal(lease.ok, false);
  assert.equal(lease.result, 'redis_lease_failed');
  assert.equal(lease.owner, 'unknown');
  assert.equal(server.values.get('test:lease:singleton'), 'test-instance', 'The failed SET may have committed');
  assert.equal(server.commands.length - countBeforeLease, 1, 'Do not retry an ambiguous lease SET');
  const unavailableLease = await context.redisAcquireLease('singleton');
  assert.equal(unavailableLease.ok, false);
  assert.equal(unavailableLease.result, 'redis_lease_unavailable');
  assert.equal(server.commands.length - countBeforeLease, 1);
  await reconnect();
  assert.equal((await context.redisAcquireLease('singleton')).ok, false, 'An existing lease must not be reacquired');
  assert.equal((await context.redisAcquireLease('new-singleton')).ok, true);
  assert.equal((await context.redisAcquireLease('')).ok, false);
  console.log('Concurrent commands settle and distributed leases fail closed through timeout/cooldown/recovery.');

  server.stall = true;
  let produced = 0;
  const producer = async () => ({ ok: true, produced: ++produced });
  const fallback = await within(context.getCachedReadResponse('fallback', 1000, producer), 'Cache fallback');
  assert.equal(fallback.ok, true);
  assert.equal(fallback.produced, 1);
  assert.equal(context.getBridgeReadCacheStatus().mode, 'memory_only');
  assert.equal(await context.getCachedReadResponse('fallback', 1000, producer), fallback);
  assert.equal(produced, 1, 'RAM cache must remain available during Redis outage');
  assert.equal(context.getBridgeReadCacheStatus().inflight, 0);
  await reconnect();
  server.stall = true;
  const cacheWrite = await within(context.redisSetCachedReadResponseIfOpen('write', { value: 1 }, 1000), 'Cache SET');
  assert.equal(cacheWrite, undefined);
  assert.equal(context.sharedRedisClient, null);
  const serializationClient = await reconnect();
  server.values.set('test:read-cache:malformed:default', 'not json');
  assert.equal((await context.getCachedReadResponse('malformed', 1000, producer)).ok, true);
  assert.equal(context.getRedisProviderMeta().ready, true, 'Malformed JSON must not retire a healthy socket');
  const circular = {};
  circular.self = circular;
  assert.equal(await context.getCachedReadResponse('circular', 1000, async () => circular), circular);
  assert.equal(context.getRedisProviderMeta().ready, true, 'Serialization errors must not retire a healthy socket');
  assert.equal(context.sharedRedisClient, serializationClient, 'Serialization errors must preserve the same client');
  assert.equal(context.sharedRedisDisabledUntil, 0);
  assert.match(context.getRedisProviderMeta().lastError, /circular/i, 'Serialization must run, not be skipped after a GET timeout');
  assert.deepEqual(server.commands.filter(([, key]) => key === 'test:read-cache:circular:default'), [
    ['GET', 'test:read-cache:circular:default'],
  ], 'A circular value must be rejected before any SET reaches Redis');
  assert.equal(await within(serializationClient.ping(), 'Redis after serialization error'), 'PONG');
  console.log('Read-cache fallback, RAM reuse, write timeout, and serialization failure behavior passed.');
} finally {
  for (const client of clients) if (client.isOpen) client.destroy();
  await server.close();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fakeClient(overrides = {}) {
  return Object.assign(new EventEmitter(), {
    isOpen: false, isReady: false, destroyed: 0,
    async connect() { this.isOpen = true; this.isReady = true; this.emit('ready'); },
    destroy() { this.destroyed += 1; this.isOpen = false; this.isReady = false; },
    async get() { return null; }, async set() { return 'OK'; }, async ping() { return 'PONG'; },
  }, overrides);
}

for (const operation of ['get', 'set', 'lease', 'cache-get', 'cache-set']) {
  const pending = deferred();
  const old = fakeClient({ get: () => pending.promise, set: () => pending.promise });
  const replacement = fakeClient();
  const available = [old, replacement];
  const raced = runtime(() => available.shift());
  await raced.getSharedRedisClient();
  const operationPromise = operation === 'get' ? raced.redisGetJson('late')
    : operation === 'set' ? raced.redisSetJson('late', {})
      : operation === 'lease' ? raced.redisAcquireLease('late')
        : operation === 'cache-get' ? raced.redisGetCachedReadResponseIfOpen('late')
          : raced.redisSetCachedReadResponseIfOpen('late', {}, 1000);
  await new Promise(setImmediate);
  raced.sharedRedisClient = null;
  assert.equal(await raced.getSharedRedisClient(), replacement);
  await within(operationPromise, `${operation} replacement race`);
  assert.equal(old.destroyed, 1);
  assert.equal(replacement.destroyed, 0);
  assert.equal(raced.sharedRedisClient, replacement);
  assert.equal(raced.sharedRedisDisabledUntil, 0, 'A stale timeout must not put a healthy replacement in cooldown');
  assert.equal(raced.sharedRedisLastError, '', 'A stale failure must not overwrite replacement health');
  const readyAt = raced.sharedRedisLastReadyAt;
  raced.sharedRedisLastError = 'replacement diagnostic';
  old.emit('ready');
  old.emit('error', new Error('late old-client error'));
  assert.equal(raced.sharedRedisLastError, 'replacement diagnostic');
  assert.equal(raced.sharedRedisLastReadyAt, readyAt);
  pending.reject(new Error('late command rejection after timeout'));
  await new Promise(setImmediate);
}
console.log('Late command completions and events cannot retire or change health of a replacement client.');

const connectAttempt = deferred();
const connecting = fakeClient({ isOpen: true, connect: () => connectAttempt.promise });
const connectRace = runtime(() => connecting, { REDIS_CONNECT_TIMEOUT_MS: 25 });
const oldConnect = connectRace.getSharedRedisClient();
const newerPromise = Promise.resolve('newer connection');
const newClient = fakeClient({ isOpen: true, isReady: true });
connectRace.sharedRedisClient = newClient;
connectRace.sharedRedisConnectPromise = newerPromise;
assert.equal(await within(oldConnect, 'Old connection timeout'), null);
assert.equal(connecting.destroyed, 1);
assert.equal(connectRace.sharedRedisClient, newClient);
assert.equal(connectRace.sharedRedisConnectPromise, newerPromise);
assert.equal(connectRace.sharedRedisDisabledUntil, 0);
connectAttempt.resolve();
await new Promise(setImmediate);

const disabled = runtime(() => { throw new Error('Disabled Redis must not connect'); }, { REDIS_ENABLED: false });
assert.equal((await disabled.redisAcquireLease('local-only')).owner, 'local');
assert.equal(await disabled.redisGetJson('disabled'), null);
const unavailable = runtime(() => fakeClient({ isOpen: true, connect: () => new Promise(() => {}) }), { REDIS_CONNECT_TIMEOUT_MS: 25 });
assert.equal((await within(unavailable.redisAcquireLease('cannot-connect'), 'Lease connection failure')).ok, false);
console.log('Connection races preserve newer promises; disabled and unavailable Redis modes remain distinct.');
