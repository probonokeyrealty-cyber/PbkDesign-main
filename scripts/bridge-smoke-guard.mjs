import childProcess from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isRetentionStorageRequest, retentionStorageBucket, retentionStorageFixtureFlag, retentionStorageOrigin }
  from './fixtures/recording-retention-storage-contract.mjs';

const root = process.env.PBK_OPENCLAW_STATE_DIR;
const nonce = process.env.PBK_SMOKE_ISOLATION_NONCE;
if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith('pbk-bridge-smoke-')
    || !nonce || !process.send || !process.permission?.has('fs.write', root)
    || process.permission.has('fs.write', path.dirname(root))
    || process.permission.has('child') || process.permission.has('worker') || process.permission.has('addons')) {
  throw new Error('Smoke isolation permissions are missing; refusing to start');
}
const parentPid = process.ppid;
const exitOrphan = () => {
  try {
    process.chdir(path.dirname(root));
    fs.rmSync(root, { recursive: true, force: true });
  } finally { process.exit(1); }
};
process.once('disconnect', exitOrphan);
// Windows can keep an inherited IPC pipe alive briefly after parent termination.
setInterval(() => {
  try { process.kill(parentPid, 0); } catch { exitOrphan(); }
}, 250).unref();
for (const name of ['link', 'linkSync', 'symlink', 'symlinkSync']) {
  fs[name] = () => { throw new Error('Smoke isolation blocked filesystem links'); };
}
for (const name of ['link', 'symlink']) {
  fsPromises[name] = async () => { throw new Error('Smoke isolation blocked filesystem links'); };
}
const blocked = api => () => {
  if (process.connected) process.send({ type: 'smoke-network-blocked', api, nonce });
  const error = new Error(`Smoke isolation blocked ${api}`);
  error.code = 'PBK_SMOKE_NETWORK_BLOCKED';
  throw error;
};
globalThis.fetch = async () => blocked('fetch')();
const originalConnect = net.Socket.prototype.connect;
const blockedTcp = blocked('tcp');
net.Socket.prototype.connect = blockedTcp;
tls.connect = blocked('tls');
http.request = blocked('http');
http.get = blocked('http');
https.request = blocked('https');
https.get = blocked('https');
http2.connect = blocked('http2');
dgram.Socket.prototype.send = blocked('udp');
dgram.Socket.prototype.connect = blocked('udp');
const originalLookup = dns.lookup;
dns.lookup = (host, ...args) => host === '127.0.0.1' || host === '::1'
  ? originalLookup(host, ...args) : blocked('dns')();
for (const name of Object.keys(dns)) {
  if (/^(resolve|reverse|lookupService)/.test(name) && typeof dns[name] === 'function') dns[name] = blocked('dns');
}
for (const name of Object.keys(dnsPromises)) {
  if (/^(lookup|resolve|reverse)/.test(name) && typeof dnsPromises[name] === 'function') dnsPromises[name] = async () => blocked('dns')();
}
for (const Resolver of [dns.Resolver, dnsPromises.Resolver]) {
  let prototype = Resolver.prototype;
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (/^(resolve|reverse)/.test(name) && typeof prototype[name] === 'function') prototype[name] = blocked('dns-resolver');
    }
    prototype = Object.getPrototypeOf(prototype);
  }
}
for (const name of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork']) {
  childProcess[name] = (file) => {
    if (name === 'execFileSync' && String(file).toLowerCase() === 'powershell.exe') return '{}';
    throw new Error('Smoke isolation blocked subprocess');
  };
}
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (args[0] !== Number(process.env.PBK_OPENCLAW_PORT) || args[1] !== '127.0.0.1') {
    throw new Error('Smoke bridge must bind only its allocated loopback port');
  }
  this.once('listening', () => {
    const address = this.address();
    process.send({ type: 'smoke-listening', host: address.address, port: address.port, nonce });
  });
  return originalListen.apply(this, args);
};
nodeModule.syncBuiltinESMExports();

// PDF route integration uses an offline renderer, never a browser subprocess.
const pdfFixture = new URL('./fixtures/bridge-smoke-pdf-fixture.mjs', import.meta.url).href;
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    return ['puppeteer-core', '@sparticuz/chromium'].includes(specifier)
      ? { url: pdfFixture, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const args = process.argv.slice(2);
const retentionFixture = args.includes(retentionStorageFixtureFlag);
if (retentionFixture) {
  const entry = fileURLToPath(new URL('./openclaw-local-server.mjs', import.meta.url));
  if (process.argv[1] !== entry || args.length !== 1 || !process.env.PBK_TEAM_PASSCODE) {
    throw new Error('Recording retention requires the isolated bridge entrypoint');
  }
  const pgTarget = await new Promise((resolve, reject) => {
    process.once('message', message => {
      if (message?.type !== 'smoke-postgres-target' || message.nonce !== nonce || typeof message.url !== 'string') {
        reject(new Error('Invalid disposable Postgres smoke lease'));
      } else resolve(message.url);
    });
    process.send({ type: 'smoke-request-postgres', nonce }, error => { if (error) reject(error); });
  });
  const match = /^postgresql:\/\/(pbk_retention_[a-f0-9]{32}):[a-f0-9]{64}@127\.0\.0\.1:([1-9][0-9]{0,4})\/\1$/.exec(pgTarget ?? '');
  const port = Number(match?.[2]);
  if (!match || match[0] !== pgTarget || port > 65535 || port === Number(process.env.PBK_OPENCLAW_PORT)) {
    throw new Error('Invalid disposable Postgres smoke configuration');
  }
  // Only the real, non-TLS pg connection's synchronous connect call may use this socket.
  const { Connection } = nodeModule.createRequire(import.meta.url)('pg');
  const pgConnect = Connection.prototype.connect;
  const pgSockets = new WeakSet();
  net.Socket.prototype.connect = function (...values) {
    if (!pgSockets.has(this) || values.length !== 2 || values[0] !== port || values[1] !== '127.0.0.1') {
      return blockedTcp();
    }
    return originalConnect.apply(this, values);
  };
  Connection.prototype.connect = function (...values) {
    if (this.ssl !== false || Object.getPrototypeOf(this.stream) !== net.Socket.prototype) return blockedTcp();
    pgSockets.add(this.stream);
    try {
      return pgConnect.apply(this, values);
    } finally {
      pgSockets.delete(this.stream);
    }
  };
  process.env.DATABASE_URL = pgTarget;
}

if (retentionFixture) {
  process.env.PBK_SUPABASE_URL = retentionStorageOrigin;
  process.env.PBK_SUPABASE_SERVICE_ROLE_KEY = randomUUID();
  process.env.PBK_CALL_RECORDINGS_BUCKET = retentionStorageBucket;
  process.env.PBK_TEAM_CAN_APPROVE_PROVIDER_ACTIONS = 'false';
  process.env.PBK_AGENT_REGISTRY_HEALTH_ENABLED = 'false';
  process.env.PBK_EMOTIONAL_LEARNING_AUTO_IMPROVE = 'false';
  const rejectFetch = globalThis.fetch;
  globalThis.fetch = async (target, options = {}) => {
    const request = { url: String(target), method: options.method, body: options.body };
    if (options.redirect !== 'error' || !isRetentionStorageRequest(request)) return rejectFetch();
    const signal = options.signal ?? AbortSignal.timeout(4_000);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      function finish(error, result) {
        process.off('message', onMessage);
        signal.removeEventListener('abort', onAbort);
        if (error || !result) reject(error || new Error('Disposable Storage transport failed'));
        else resolve(new Response(result.body, { status: result.status }));
      }
      function onAbort() { finish(signal.reason); }
      function onMessage(message) {
        if (message?.type === 'smoke-retention-storage-result' && message.nonce === nonce && message.id === id) finish(null, message.result);
      }
      process.on('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
      process.send({ type: 'smoke-retention-storage', nonce, id, ...request }, error => { if (error) finish(error); });
    });
  };
}
