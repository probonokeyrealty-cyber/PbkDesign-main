import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import pg from 'pg';

const exec = promisify(execFile);
const image = 'pgvector/pgvector:0.8.7-pg17';
const leases = new WeakMap();
const loopback = '127.0.0.1';
export const getRetentionPostgresLease = binding => leases.get(binding);

export async function withRetentionPostgres(run) {
  const database = `pbk_retention_${randomUUID().replaceAll('-', '')}`;
  const password = randomBytes(32).toString('hex');
  const marker = randomBytes(16).toString('hex');
  const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
  const prefix = ['--host', host, '--config', join(tmpdir(), database)];
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  const docker = async (...args) => (await exec('docker', [...prefix, ...args], { env, windowsHide: true, timeout: 25_000 })).stdout.trim();
  const binding = Object.freeze({});
  const sockets = new Set();
  const relays = new Set();
  let id, server, pool;
  try {
    id = await docker('create', '--pull', 'never', '--name', database, '--network', 'none',
      '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_USER=${database}`, '-e', `POSTGRES_DB=${database}`,
      '-e', `POSTGRES_PASSWORD=${password}`, image, '-c', `listen_addresses=${loopback}`, '-c', `pbk.fixture_marker=${marker}`);
    if (!/^[a-f0-9]{64}$/u.test(id)) throw new Error('Invalid disposable Postgres container ID');
    await docker('start', id);
    for (let attempt = 0; ; attempt++) {
      if (await docker('exec', id, 'pg_isready', '-h', loopback, '-U', database).then(() => true, () => false)) break;
      if (attempt >= 50) throw new Error('Disposable Postgres failed to start');
      await delay(300);
    }
    server = createServer(socket => {
      sockets.add(socket);
      const relay = spawn('docker', [...prefix, 'exec', '-i', id, '/bin/bash', '-c', `
        exec 3<>/dev/tcp/127.0.0.1/5432 4<&0 || exit 1
        cat <&3 & outbound=$!
        cat <&4 >&3 & inbound=$!
        trap 'kill "$outbound" "$inbound" 2>/dev/null; wait' EXIT
        wait -n "$outbound" "$inbound"
      `], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const done = new Promise(resolve => relay.once('close', resolve));
      relays.add(done);
      void done.then(() => relays.delete(done));
      socket.once('close', () => { sockets.delete(socket); relay.stdin.end(); });
      socket.once('error', () => socket.destroy());
      relay.once('close', () => socket.destroy());
      relay.once('error', () => socket.destroy());
      relay.stdin.on('error', () => socket.destroy());
      socket.pipe(relay.stdin);
      relay.stdout.pipe(socket);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, loopback, resolve);
    });
    const url = `postgresql://${database}:${password}@${loopback}:${server.address().port}/${database}`;
    pool = new pg.Pool({ connectionString: url, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    const check = async client => {
      const { rows } = await client.query("SELECT current_database() AS db, current_setting('pbk.fixture_marker', true) AS marker");
      if (rows[0]?.db !== database || rows[0]?.marker !== marker) throw new Error('Disposable Postgres identity mismatch');
    };
    await check(pool);
    await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
    leases.set(binding, url);
    return await run({ pool, binding, async applyRecordingSchema() {
      const client = await pool.connect();
      try {
        await check(client);
        for (const name of ['20260430001000_pbk_operational_schema.sql', '20260430002000_pbk_brain_workflow_recordings.sql',
          '20261120016000_pbk_recording_retention_approvals.sql']) {
          await client.query(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8'));
        }
      } finally {
        client.release();
      }
    } });
  } finally {
    leases.delete(binding);
    try {
      if (pool) await pool.end();
      if (server) {
        const closed = new Promise(resolve => server.close(resolve));
        for (const socket of sockets) socket.destroy();
        await closed;
      }
    } finally {
      if (id && /^[a-f0-9]{64}$/u.test(id)) await docker('rm', '-f', '-v', id);
      await Promise.all(relays);
    }
  }
}
