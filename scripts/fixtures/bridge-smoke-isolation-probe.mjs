import { writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { createServer, get } from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import callbackDns from 'node:dns';
import dgram from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import puppeteer from 'puppeteer-core';

const [sentinel, canary, dnsPort] = process.argv.slice(2);
const localDns = `127.0.0.1:${dnsPort}`;
callbackDns.setServers([localDns]);
dns.setServers([localDns]);
const resolver = new dns.Resolver();
resolver.setServers([localDns]);
const callbackResolver = new callbackDns.Resolver();
callbackResolver.setServers([localDns]);
const attempt = async action => { try { await action(); return false; } catch { return true; } };
writeFileSync(join(process.env.PBK_OPENCLAW_STATE_DIR, 'openclaw-state.json'), '{"sample":true}');
const socket = dgram.createSocket('udp4');
const report = {
  stateWritten: true,
  userEnvEmpty: execFileSync('powershell.exe', ['-Command', 'user env must not be read']) === '{}',
  workingWriteBlocked: await attempt(() => writeFileSync(sentinel, 'must not write')),
  symlinkBlocked: await attempt(() => symlinkSync(sentinel, join(process.env.PBK_OPENCLAW_STATE_DIR, 'alias'))),
  hardlinkBlocked: await attempt(() => linkSync(sentinel, join(process.env.PBK_OPENCLAW_STATE_DIR, 'hardlink'))),
  processBlocked: await attempt(() => execFileSync(process.execPath, ['-e', 'process.exit(0)'])),
  workerBlocked: await attempt(() => new Worker('process.exit(0)', { eval: true })),
  sqliteBlocked: await attempt(async () => {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(join(sentinel, '..', 'outside.sqlite')).close();
  }),
  network: {
    fetch: await attempt(() => fetch(canary)),
    http: await attempt(() => get(canary)),
    https: await attempt(() => https.get(canary.replace('http:', 'https:'))),
    tcp: await attempt(() => net.connect(new URL(canary).port, '127.0.0.1')),
    tls: await attempt(() => tls.connect(Number(new URL(canary).port), '127.0.0.1')),
    http2: await attempt(() => http2.connect(canary.replace('http:', 'https:'))),
    dns: await attempt(() => dns.resolve('example.invalid')),
    dnsResolver: await attempt(() => resolver.resolve4('example.invalid')),
    callbackResolver: await attempt(() => callbackResolver.resolve4('example.invalid', () => {})),
    udp: await attempt(() => socket.send('sample', Number(dnsPort), '127.0.0.1')),
    websocket: await attempt(() => new WebSocket(canary.replace('http:', 'ws:'))),
  },
};
const browser = await puppeteer.launch();
const page = await browser.newPage();
report.pdfIsFixture = (await page.pdf()).subarray(0, 4).toString() === '%PDF';
report.pdfNavigationBlocked = await attempt(() => page.goto(canary));
await browser.close();
socket.close();
createServer((req, res) => {
  if (req.url === '/redirect') { res.writeHead(302, { location: canary }); return res.end(); }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(report));
}).listen(Number(process.env.PBK_OPENCLAW_PORT), '127.0.0.1');
