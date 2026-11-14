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
net.Socket.prototype.connect = blocked('tcp');
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
