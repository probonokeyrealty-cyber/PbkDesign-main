import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import vm from 'node:vm';
import ts from 'typescript';
import { validRecordingObjectVersion, validRecordingRetentionStorageKey } from './recording-retention-authorization.mjs';
import { withRetentionPostgres } from './fixtures/recording-retention-postgres.mjs';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import { isRetentionStorageRequest, retentionStorageBucket, retentionStorageFixtureFlag, retentionStorageOrigin }
  from './fixtures/recording-retention-storage-contract.mjs';

const image = 'supabase/storage-api:v1.98.5';
const exec = promisify(execFile);
const storageOrigin = 'http://127.0.0.1:5000';
const bucket = retentionStorageBucket;
const object = `object/${bucket}`;
const encode = key => key.split('/').map(encodeURIComponent).join('/');

test('fixture Storage transport allows only its two synthetic keys and exact versions', () => {
  const request = { url: `${retentionStorageOrigin}/storage/v1/object/${bucket}`, method: 'DELETE' };
  const path = 'fixture/retention-approved.txt';
  const versionId = randomUUID();
  const body = JSON.stringify({ prefixes: [{ path, versionId }] });
  assert.equal(isRetentionStorageRequest({ ...request, body }), true);
  for (const invalid of [{ ...request, body: JSON.stringify({ prefixes: [path] }) },
    { ...request, body: JSON.stringify({ prefixes: [{ path: 'other.txt', versionId }] }) },
    { ...request, body, url: `${request.url}/${path}` },
    { ...request, body, url: request.url.replace(retentionStorageOrigin, 'https://other.invalid') }]) {
    assert.equal(isRetentionStorageRequest(invalid), false);
  }
});

// The fixture has no published ports. Run each HTTP request inside Storage's
// own container and return its real status and body over Docker exec.
const requestScript = `
  const lines = require('node:readline').createInterface({ input: process.stdin });
  (async () => {
    for await (const line of lines) {
      const { id, method, path, body, contentType } = JSON.parse(line);
      try {
        const destination = new URL(path, '${storageOrigin}');
        if (destination.origin !== '${storageOrigin}') throw new Error('not a fixture origin');
        const res = await fetch(destination, {
          method, body, redirect: 'error', signal: AbortSignal.timeout(3500),
          headers: { Authorization: 'Bearer ' + process.env.SERVICE_KEY, 'Content-Type': contentType },
        });
        console.log(JSON.stringify({ id, status: res.status, body: await res.text() }));
      } catch (error) {
        console.log(JSON.stringify({ id, error: error.name }));
      }
    }
  })();
`;

test('real Supabase Storage and Postgres prove recording retention from approval through readback', { timeout: 250_000 }, async () => {
  const name = `pbk-retention-${randomUUID()}`;
  const host = process.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///var/run/docker.sock';
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  const dockerArgs = ['--host', host, '--config', join(tmpdir(), name)];
  const docker = async (...args) => (await exec('docker', [...dockerArgs, ...args],
    { env, windowsHide: true, timeout: 20_000 })).stdout.trim();
  const secret = randomBytes(32).toString('hex');
  const password = randomBytes(24).toString('hex');
  const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const claims = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const token = `${claims}.${createHmac('sha256', secret).update(claims).digest('base64url')}`;
  let network, db, storage, relay, relayClosed;
  try {
    network = await docker('network', 'create', '--internal', name);
    db = await docker('run', '-d', '--pull', 'never', '--name', `${name}-db`, '--network', network, '--network-alias', 'fixture-db',
      '--tmpfs', '/var/lib/postgresql/data', '-e', `POSTGRES_PASSWORD=${password}`, 'postgres:16-alpine');
    for (let attempt = 0; ; attempt++) {
      if (await docker('exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres').then(() => true, () => false)) break;
      assert.ok(attempt < 50, 'disposable Postgres failed to start');
      await delay(300);
    }
    storage = await docker('run', '-d', '--pull', 'never', '--name', `${name}-storage`, '--network', network, '--tmpfs', '/var/lib/storage',
      '-e', 'STORAGE_BACKEND=file', '-e', 'FILE_STORAGE_BACKEND_PATH=/var/lib/storage',
      '-e', 'GLOBAL_S3_BUCKET=retention-fixture', '-e', 'TENANT_ID=retention-fixture',
      '-e', 'REGION=local', '-e', 'FILE_SIZE_LIMIT=1048576', '-e', 'DB_INSTALL_ROLES=true',
      '-e', `AUTH_JWT_SECRET=${secret}`, '-e', `SERVICE_KEY=${token}`,
      '-e', `DATABASE_URL=postgres://postgres:${password}@fixture-db:5432/postgres`, image);
    relay = spawn('docker', [...dockerArgs, 'exec', '-i', storage, 'node', '-e', requestScript],
      { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const pending = new Map();
    const stopRelay = () => { for (const finish of pending.values()) finish({ error: 'closed' }); };
    relay.on('error', stopRelay);
    relay.stdin.on('error', stopRelay);
    relayClosed = new Promise(resolve => relay.once('close', () => { stopRelay(); resolve(); }));
    createInterface({ input: relay.stdout }).on('line', line => {
      const reply = JSON.parse(line);
      pending.get(reply.id)?.(reply);
    });
    const http = (method, path, body, contentType = 'application/json') => new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => finish({ error: 'timeout' }), 5000);
      function finish(response) {
        clearTimeout(timer);
        pending.delete(id);
        if (response.error) reject(new Error(`Disposable Storage request failed: ${response.error}`));
        else resolve(response);
      }
      pending.set(id, finish);
      relay.stdin.write(JSON.stringify({ id, method, path: `/${path}`, body, contentType }) + '\n', error => {
        if (error) finish({ error: 'closed' });
      });
    });
    for (let attempt = 0; ; attempt++) {
      const response = await http('GET', 'status').catch(() => null);
      if (response?.status === 200) break;
      if (attempt === 40) assert.fail(`Storage did not start: ${(await docker('logs', '--tail', '12', storage)).slice(-2400)}`);
      await delay(300);
    }
    const created = await http('POST', 'bucket', JSON.stringify({ id: bucket, name: bucket, public: false }));
    assert.equal(created.status, 200, created.body);
    const put = async (key, bytes, overwrite = false) => {
      const response = await http(overwrite ? 'PUT' : 'POST', `${object}/${encode(key)}`, bytes, 'text/plain');
      assert.equal(response.status, 200, response.body);
    };
    const assertBytes = async (key, expected) => {
      const response = await http('GET', `object/authenticated/${bucket}/${encode(key)}`);
      assert.equal(response.status, 200, response.body);
      assert.equal(response.body, expected);
    };

    const bridge = ts.createSourceFile('bridge.mjs', readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let race, deleteCount = 0, deleteReply, infoReply;
    const context = vm.createContext({
      AbortSignal, SUPABASE_CALL_RECORDINGS_BUCKET: bucket, SUPABASE_URL: storageOrigin,
      validRecordingRetentionStorageKey, validRecordingObjectVersion, encodePathSegments: encode,
      getSupabaseStorageProviderMeta: () => ({ ready: true }), getSupabaseStorageHeaders: () => ({}),
      async fetch(url, options) {
        assert.ok(url.startsWith(`${storageOrigin}/storage/v1/`));
        assert.equal(options.redirect, 'error');
        if (options.method === 'DELETE') {
          deleteCount++;
          await race?.();
        }
        const result = await http(options.method, url.slice(`${storageOrigin}/storage/v1/`.length), options.body);
        if (options.method === 'DELETE') deleteReply = result;
        else infoReply = result;
        return new Response(result.body, { status: result.status });
      },
    });
    for (const name of ['readSupabaseRecordingVersion', 'deleteSupabaseRecordingVersion']) {
      vm.runInContext(bridge.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(bridge), context);
    }
    const versionOf = async key => {
      const value = await context.readSupabaseRecordingVersion(key);
      assert.ok(validRecordingObjectVersion(value?.version), 'provider must expose an actual object version');
      assert.ok(Number.isFinite(value.modifiedAt), 'provider must expose an actual modification time');
      return value.version;
    };

    const key = 'fixture/recording.txt';
    await put(key, 'first synthetic recording');
    const first = await versionOf(key);
    await put(key, 'replacement before execution', true);
    const second = await versionOf(key);
    assert.notEqual(second, first);
    const stale = await context.deleteSupabaseRecordingVersion(key, first);
    assert.equal(stale.reason, 'recording_storage_version_changed');
    assert.equal(deleteCount, 0);
    await assertBytes(key, 'replacement before execution');

    race = () => put(key, 'replacement after preflight', true);
    const raced = await context.deleteSupabaseRecordingVersion(key, second);
    race = undefined;
    assert.equal(raced.tracking, 'pending');
    assert.equal(deleteCount, 1);
    assert.equal(deleteReply.status, 200, deleteReply.body);
    assert.deepEqual(JSON.parse(deleteReply.body), []);
    await assertBytes(key, 'replacement after preflight');
    const third = await versionOf(key);
    assert.notEqual(third, second);

    const control = await context.deleteSupabaseRecordingVersion(key, third);
    assert.equal(control.deleted, true, JSON.stringify({ control, deleteStatus: deleteReply.status, infoReply }));
    assert.equal(deleteCount, 2);
    const missing = await http('GET', `object/authenticated/${bucket}/${encode(key)}`);
    if (missing.status !== 404) {
      assert.equal(missing.status, 400, missing.body);
      const error = JSON.parse(missing.body);
      assert.equal(error.statusCode, '404');
      assert.equal(error.code, 'NoSuchKey');
    }
    console.log(`${image}: stale version rejected, racing replacement survived byte-for-byte, exact version removed`);
    await exerciseRetentionRoute({ http, put, assertBytes, async ageObject(key, timestamp) {
      const count = await docker('exec', db, 'psql', '-Atq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-c',
        `BEGIN; SET LOCAL session_replication_role = replica;
         UPDATE storage.objects SET updated_at = '${timestamp}' WHERE bucket_id = '${bucket}' AND name = '${key}' RETURNING 1;
         COMMIT;`);
      assert.equal(count, '1');
      const info = await http('GET', `object/info/authenticated/${bucket}/${key}`);
      assert.equal(info.status, 200, info.body);
      assert.equal(Date.parse(JSON.parse(info.body).last_modified), Date.parse(timestamp));
    } });
  } finally {
    relay?.stdin.end();
    const removals = await Promise.allSettled([storage, db].filter(Boolean).map(id => docker('rm', '-f', '-v', id)));
    await relayClosed;
    if (network) await docker('network', 'rm', network);
    for (const removal of removals) if (removal.status === 'rejected') throw removal.reason;
  }
});

async function exerciseRetentionRoute({ http, put, assertBytes, ageObject }) {
  const target = { id: 'fixture-retention-approved', key: 'fixture/retention-approved.txt', text: 'recording approved for cleanup' };
  const replacement = { id: 'fixture-retention-race', key: 'fixture/retention-race.txt', text: 'recording about to be replaced' };
  for (const [row, days] of [[target, 90], [replacement, 45]]) {
    row.createdAt = new Date(Date.now() - days * 86_400_000).toISOString();
    await put(row.key, row.text);
    await ageObject(row.key, row.createdAt);
  }
  await withRetentionPostgres(async ({ pool, binding, applyRecordingSchema }) => {
    let injectOverwrite = false;
    const deleted = [];
    const start = () => startIsolatedBridge({
      args: [retentionStorageFixtureFlag], retentionPostgres: binding, startupMs: 55_000,
      async retentionStorage({ url, method, body }) {
        if (method === 'DELETE') {
          const [{ path, versionId }] = JSON.parse(body).prefixes;
          if (injectOverwrite && path === replacement.key) {
            injectOverwrite = false;
            await put(path, 'replacement bytes', true);
          }
          const result = await http(method, url.slice(`${retentionStorageOrigin}/storage/v1/`.length), body);
          deleted.push({ path, versionId, result });
          return result;
        }
        return http(method, url.slice(`${retentionStorageOrigin}/storage/v1/`.length), body);
      },
    });
    const launch = async () => {
      const child = await start();
      try {
        for (let attempt = 0; ; attempt++) {
          const health = await (await child.fetch(new URL('/health', child.origin))).json();
          assert.equal(health.runtime.configuredStateBackend, 'postgres');
          if (health.runtime.stateBootstrap.ready) {
            assert.equal(health.features.stateBackend, 'postgres');
            return child;
          }
          assert.notEqual(health.runtime.stateBootstrap.status, 'state_bootstrap_unavailable', JSON.stringify(health.runtime.stateBootstrap));
          assert.ok(attempt < 90, JSON.stringify(health.runtime.stateBootstrap));
          await delay(300);
        }
      } catch (error) {
        await child.stop();
        throw error;
      }
    };
    const bootstrap = await launch();
    await bootstrap.stop();
    await applyRecordingSchema();
    const messages = [];
    const archive = { key: 'fixture/preserved-archive.wav', bucket: 'fixture-archive' };
    for (const row of [target, replacement]) {
      const message = { id: row.id, channel: 'call', direction: 'recording', status: 'recorded', workspaceId: 'pbk',
        createdAt: row.createdAt, updatedAt: row.createdAt, storagePath: row.key, storageBucket: bucket,
        payload: { storagePath: row.key, s3Archive: archive } };
      messages.push(message);
      await pool.query(`INSERT INTO public.unified_messages
        (id, workspace_id, channel, direction, status, storage_path, storage_bucket, payload, created_at, updated_at)
        VALUES ($1,'pbk','call','recording','recorded',$2,$3,$4,$5,$5)`,
      [row.id, row.key, bucket, message.payload, row.createdAt]);
    }
    await pool.query("UPDATE public.bridge_state SET data = jsonb_set(data, '{messages}', $1) WHERE id = 'singleton'", [JSON.stringify(messages)]);
    const bridge = await launch();
    const retention = '/api/recordings/retention';
    const founder = { authorization: `Bearer ${bridge.apiKey}` };
    const request = async (path, status, body, auth = founder) => {
      const response = await bridge.fetch(new URL(path, bridge.origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...auth }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify({ path, result: data.result, code: data.code, error: data.error }));
      return data;
    };
    const decision = async id => (await pool.query(`SELECT a.status, g.consumed_at FROM public.approvals a
      JOIN public.pbk_recording_retention_approvals g ON g.approval_id = a.id WHERE a.id = $1`, [id])).rows[0];
    const pointer = async id => (await pool.query('SELECT storage_path, payload FROM public.unified_messages WHERE id = $1', [id])).rows[0];
    const run = (status, days, approvalId) => request(`${retention}/run`, status, { dryRun: false, days, approvalId });
    try {
      assert.equal((await request('/health', 200)).features.stateBackend, 'postgres');
      assert.equal((await request(`${retention}/preview?days=60`, 200)).run.candidateCount, 1);
      await request(`${retention}/run`, 401, { dryRun: false, days: 60 }, {});
      const queued = await run(202, 60);
      assert.equal(queued.candidateCount, 1);
      const { approvalId } = queued;
      assert.deepEqual(await decision(approvalId), { status: 'pending', consumed_at: null });
      assert.equal((await run(403, 60, approvalId)).result, 'retention_approval_required');
      assert.equal(deleted.length, 0);
      await assertBytes(target.key, target.text);

      const team = await request('/api/auth/team', 200, { passcode: bridge.teamPasscode, actor: 'Synthetic operator' }, {});
      const approve = `/api/approvals/${approvalId}/approve`;
      await request(approve, 403, {}, { 'x-pbk-team-token': team.token });
      assert.deepEqual(await decision(approvalId), { status: 'pending', consumed_at: null });
      const approved = await request(approve, 200, { actor: 'Synthetic founder' });
      assert.equal(approved.approval.status, 'approved');
      assert.deepEqual(await decision(approvalId), { status: 'approved', consumed_at: null });
      assert.equal(deleted.length, 0, 'approving must not dispatch deletion');
      const complete = await run(200, 60, approvalId);
      assert.equal(complete.run.status, 'complete', JSON.stringify({ deletions: complete.run.deletions,
        providerStatuses: deleted.map(item => item.result.status) }));
      assert.equal(complete.run.deletedCount, 1);
      assert.equal(complete.run.deletions[0].tracking, 'confirmed');
      assert.ok((await decision(approvalId)).consumed_at instanceof Date);
      const durable = await pointer(target.id);
      assert.equal(durable.storage_path, '');
      assert.equal(durable.payload.retentionStatus, 'deleted');
      assert.deepEqual(durable.payload.s3Archive, archive);
      assert.equal(JSON.parse(deleted[0].result.body)[0].version, deleted[0].versionId);
      const missing = await http('GET', `object/info/authenticated/${bucket}/${target.key}`);
      assert.equal(JSON.parse(missing.body).code, 'NoSuchKey');
      assert.equal((await run(409, 60, approvalId)).result, 'retention_approval_consumed');
      assert.equal(deleted.length, 1);

      const racing = await run(202, 30);
      assert.equal(racing.candidateCount, 1);
      await request(`/api/approvals/${racing.approvalId}/approve`, 200, { actor: 'Synthetic founder' });
      injectOverwrite = true;
      const held = await run(200, 30, racing.approvalId);
      assert.equal(held.run.status, 'pending');
      assert.equal(held.run.deletedCount, 0);
      assert.equal(deleted.length, 2);
      assert.deepEqual(JSON.parse(deleted[1].result.body), []);
      await assertBytes(replacement.key, 'replacement bytes');
      assert.equal((await pointer(replacement.id)).storage_path, replacement.key);
      assert.equal((await run(409, 30, racing.approvalId)).result, 'retention_approval_consumed');
      assert.equal(deleted.length, 2);
      console.log('HTTP retention: pending/team blocked; founder approval consumed once; durable row and Storage agree; racing replacement preserved');
    } finally {
      await bridge.stop();
    }
  });
}
