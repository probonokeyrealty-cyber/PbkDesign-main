import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function getSharedRedisClient()'), source.indexOf('async function redisSetJson('));

function runtime(client) {
  const context = vm.createContext({
    REDIS_ENABLED: true, REDIS_URL: 'redis://test.invalid', REDIS_NAMESPACE: 'test',
    REDIS_INSTANCE_ID: 'test', REDIS_RETRY_COOLDOWN_MS: 1000,
    REDIS_CONNECT_TIMEOUT_MS: 25, REDIS_COMMAND_TIMEOUT_MS: 25,
    REDIS_CALL_STATE_TTL_SECONDS: 60, REDIS_LEASE_TTL_SECONDS: 60,
    sharedRedisClient: null, sharedRedisConnectPromise: null, sharedRedisDisabledUntil: 0,
    sharedRedisLastError: '', sharedRedisLastReadyAt: '',
    createRedisClient: () => client, isoNow: () => new Date().toISOString(), setTimeout, clearTimeout,
    withTimeout: (promise, ms) => {
      let timer;
      return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis connect timed out')), ms);
      })]).finally(() => clearTimeout(timer));
    },
  });
  vm.runInContext(functions, context);
  return context;
}

const unavailable = new EventEmitter();
Object.assign(unavailable, { isOpen: true, isReady: false, connect: () => new Promise(() => {}), destroy() { this.destroyed = true; } });
const failing = runtime(unavailable);
let deadline;
try {
  const result = await Promise.race([
    failing.getSharedRedisClient(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Redis outage left the caller hanging')), 150); }),
  ]);
  assert.equal(result, null);
  assert.equal(unavailable.destroyed, true);
  assert.equal(failing.getRedisProviderMeta().ready, false);
} finally { clearTimeout(deadline); }

const healthy = new EventEmitter();
Object.assign(healthy, { isOpen: false, isReady: false, async connect() { this.isOpen = true; this.isReady = true; this.emit('ready'); } });
const restored = runtime(healthy);
assert.equal(await restored.getSharedRedisClient(), healthy);
assert.equal(restored.getRedisProviderMeta().ready, true);
healthy.isReady = false;
assert.equal(restored.getRedisProviderMeta().ready, false, 'A reconnecting socket must not be reported ready');
console.log('Redis outage timeout and recovery behavior passed.');
