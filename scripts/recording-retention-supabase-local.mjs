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
import { assertRecordingRetentionSchema } from './recording-retention-schema.mjs';
import { hashProviderActionContext } from './provider-action-authorization.mjs';
import { withRetentionPostgres } from './fixtures/recording-retention-postgres.mjs';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';
import { isRetentionStorageRequest, retentionStorageBucket, retentionStorageFixtureFlag, retentionStorageOrigin, retentionWriterFixtureKey }
  from './fixtures/recording-retention-storage-contract.mjs';

const image = 'supabase/storage-api:v1.98.5';
const exec = promisify(execFile);
const storageOrigin = 'http://127.0.0.1:5000';
const bucket = retentionStorageBucket;
const object = `object/${bucket}`;
const encode = key => key.split('/').map(encodeURIComponent).join('/');

test('fixture Storage transport allows only its synthetic keys and exact versions', () => {
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

test('real Supabase Storage and Postgres prove recording retention from approval through readback', { timeout: 420_000 }, async () => {
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
    const storageReadyBy = Date.now() + 60_000;
    for (;;) {
      const response = await http('GET', 'status').catch(() => null);
      if (response?.status === 200) break;
      if (Date.now() >= storageReadyBy) assert.fail(`Storage did not start: ${(await docker('logs', '--tail', '12', storage)).slice(-2400)}`);
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
    let race, deleteCount = 0, deleteReply, infoReply, infoOverride;
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
        if (options.method === 'GET' && infoOverride) return new Response(infoOverride, { status: 404 });
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
    infoOverride = '{}';
    assert.equal(await context.readSupabaseRecordingVersion(key, undefined, true), null,
      'an unclassified 404 cannot release a capture reservation');
    infoOverride = undefined;
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
  const interrupted = { id: 'fixture-retention-interrupted', key: 'fixture/retention-interrupted.txt', text: 'recording with interrupted readback' };
  const later = { id: 'fixture-retention-later', key: 'fixture/retention-later.txt', text: 'independent recording' };
  const rollback = { id: 'fixture-retention-pointer-rollback', key: 'fixture/retention-pointer-rollback.txt', text: 'recording with a rejected pointer update' };
  const unverified = { id: 'fixture-retention-unverified-readback', key: 'fixture/retention-unverified-readback.txt' };
  const fixtures = [[target, 90], [replacement, 45], [interrupted, 15], [later, 5], [rollback, 1.5]];
  for (const [row, days] of fixtures) {
    row.createdAt = new Date(Date.now() - days * 86_400_000).toISOString();
    await put(row.key, row.text);
    await ageObject(row.key, row.createdAt);
  }
  await withRetentionPostgres(async ({ pool, binding, applyRecordingSchema }) => {
    let injectOverwrite = false;
    let overlapProof;
    let overlapError;
    let duringCapture;
    let duringManualDelete;
    let hideUnverifiedReadback = false;
    const deleted = [];
    const start = ({ requireRecordingSchema = false, retentionFounderKeyMode = 'distinct' } = {}) => startIsolatedBridge({
      args: [retentionStorageFixtureFlag], retentionPostgres: binding, startupMs: process.platform === 'win32' ? 90_000 : 55_000,
      requireRecordingSchema, retentionFounderKeyMode,
      async retentionStorage({ url, method, body }) {
        if (url === `${retentionStorageOrigin}/storage/v1/${object}/${retentionWriterFixtureKey}`) {
          if (method === 'PUT') await duringCapture?.();
          if (method === 'DELETE') await duringManualDelete?.();
          return http(method, `${object}/${retentionWriterFixtureKey}`, body, 'text/plain');
        }
        if (method === 'DELETE') {
          const [{ path, versionId }] = JSON.parse(body).prefixes;
          if (path === target.key) {
            try {
              const result = await pool.query('SELECT public.fixture_retention_overlap($1, $2) AS proof',
                [target.id, JSON.stringify({ storage_path: ` \t/${bucket}//${path.replace('/', '//')}/ \n` })]);
              overlapProof = result.rows[0].proof;
            } catch (error) {
              overlapError = error.code || error.message;
              throw error;
            }
          }
          if (injectOverwrite && path === replacement.key) {
            injectOverwrite = false;
            await put(path, 'replacement bytes', true);
          }
          const result = await http(method, url.slice(`${retentionStorageOrigin}/storage/v1/`.length), body);
          deleted.push({ path, versionId, result });
          if (path === unverified.key) hideUnverifiedReadback = true;
          if (path === interrupted.key) return { status: 503, body: '{}' };
          return result;
        }
        if (hideUnverifiedReadback && method === 'GET' && url.endsWith(`/${unverified.key}`)) {
          return { status: 404, body: '{"error":"Route not found"}' };
        }
        return http(method, url.slice(`${retentionStorageOrigin}/storage/v1/`.length), body);
      },
    });
    const launch = async options => {
      const child = await start(options);
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
    await assert.rejects(assertRecordingRetentionSchema(pool), /schema or runtime-role access is incomplete/);
    await assert.rejects(start({ requireRecordingSchema: true }), /Render bridge cannot start until the recording retention migration/);
    await applyRecordingSchema();
    await assertRecordingRetentionSchema(pool);
    const readinessClient = await pool.connect();
    try {
      await readinessClient.query('BEGIN');
      await readinessClient.query('SET LOCAL ROLE anon');
      await assert.rejects(assertRecordingRetentionSchema(readinessClient), /schema or runtime-role access is incomplete/);
      await readinessClient.query('ROLLBACK');
      await readinessClient.query('BEGIN');
      await readinessClient.query('DROP INDEX public.pbk_recording_storage_active_key');
      await assert.rejects(assertRecordingRetentionSchema(readinessClient), /schema or runtime-role access is incomplete/);
    } finally {
      await readinessClient.query('ROLLBACK');
      readinessClient.release();
    }
    const pointerTypes = await pool.query(`SELECT public.pbk_recording_has_untyped_pointer($1::jsonb) AS ambiguous,
      ARRAY(SELECT public.pbk_recording_storage_pointers(NULL, $1::jsonb)) AS pointers`,
    [JSON.stringify({ storagePath: [target.key] })]);
    assert.deepEqual(pointerTypes.rows, [{ ambiguous: true, pointers: [] }]);
    // One disposable DB round trip keeps the lock probes inside the production Storage deadline.
    await pool.query(`CREATE FUNCTION public.fixture_retention_overlap(target_id text, alias_payload jsonb)
      RETURNS jsonb LANGUAGE plpgsql SET lock_timeout = '250ms' AS $$
      DECLARE
        pending jsonb;
        duplicate_write text := 'committed';
        reference_removal text := 'committed';
        table_removal text := 'committed';
        unrelated_write text := 'committed';
      BEGIN
        SELECT jsonb_build_object('outcome', outcome, 'object_version', object_version) INTO pending
        FROM public.pbk_recording_retention_attempts WHERE message_id = target_id;
        BEGIN
          INSERT INTO public.unified_messages (id, workspace_id, channel, direction, payload)
            VALUES ('retention-duplicate-pointer-fixture', 'pbk', 'call', 'recording', alias_payload);
        EXCEPTION WHEN OTHERS THEN duplicate_write := SQLSTATE;
        END;
        BEGIN
          DELETE FROM public.unified_messages WHERE id = target_id;
        EXCEPTION WHEN OTHERS THEN reference_removal := SQLSTATE;
        END;
        BEGIN
          TRUNCATE public.unified_messages;
        EXCEPTION WHEN OTHERS THEN table_removal := SQLSTATE;
        END;
        BEGIN
          INSERT INTO public.unified_messages (id, workspace_id, channel, direction)
            VALUES ('unrelated-retention-fixture', 'pbk', 'sms', 'inbound');
        EXCEPTION WHEN OTHERS THEN unrelated_write := SQLSTATE;
        END;
        RETURN jsonb_build_object('pending', pending, 'duplicateWrite', duplicate_write, 'referenceRemoval', reference_removal,
          'tableRemoval', table_removal, 'unrelatedWrite', unrelated_write);
      END;
      $$`);
    const messages = [];
    const archive = { key: 'fixture/preserved-archive.wav', bucket: 'fixture-archive' };
    for (const [row] of fixtures) {
      const message = { id: row.id, channel: 'call', direction: 'recording', status: 'recorded', workspaceId: 'pbk',
        createdAt: row.createdAt, updatedAt: row.createdAt, storagePath: row.key, storageBucket: bucket,
        payload: { storagePath: row.key, s3Archive: archive } };
      if (row !== target) messages.push(message);
      await pool.query(`INSERT INTO public.unified_messages
        (id, workspace_id, channel, direction, status, storage_path, storage_bucket, payload, created_at, updated_at, recording_url)
        VALUES ($1,'pbk','call','recording','recorded',$2,$3,$4,$5,$5,$6)`,
      [row.id, row.key, bucket, message.payload, row.createdAt, row === rollback ? 'https://recording-fixture.invalid/audio' : '']);
    }
    const staleId = 'fixture-retention-stale-cache';
    const staleKey = 'fixture/retention-stale-cache.txt';
    const ambiguousId = 'fixture-retention-ambiguous-archive';
    const ambiguous = { s3Archive: { key: '/ fixture/ambiguous-archive.wav', bucket: 'fixture-archive' } };
    messages.push({ id: staleId, workspaceId: 'pbk', channel: 'sms', direction: 'inbound', createdAt: new Date().toISOString() });
    messages.push({ id: ambiguousId, workspaceId: 'pbk', channel: 'call', direction: 'recording',
      createdAt: new Date().toISOString(), payload: ambiguous });
    await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, storage_path, storage_bucket)
      VALUES ($1,'pbk','call','recording',$2,$3)`, [staleId, staleKey, bucket]);
    await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, payload)
      VALUES ($1,'pbk','call','recording',$2)`, [ambiguousId, ambiguous]);
    const plainInboxId = 'fixture-plain-inbox';
    messages.push({ id: plainInboxId, workspaceId: 'pbk', channel: 'sms', direction: 'inbound', createdAt: new Date().toISOString() });
    await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction)
      VALUES ($1,'pbk','sms','inbound')`, [plainInboxId]);
    await pool.query("UPDATE public.bridge_state SET data = jsonb_set(data, '{messages}', $1) WHERE id = 'singleton'", [JSON.stringify(messages)]);
    let bridge = await launch();
    const retention = '/api/recordings/retention';
    const request = async (path, status, body, auth, { child = bridge, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const response = await child.fetch(new URL(path, child.origin), {
        method,
        headers: { 'content-type': 'application/json', ...(auth ?? { authorization: `Bearer ${child.apiKey}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify({ path, result: data.result, code: data.code, error: data.error }));
      return data;
    };
    const founderHeader = 'x-pbk-recording-retention-founder-key';
    const founderAuth = (child = bridge, key = child.retentionFounderKey) => ({
      authorization: `Bearer ${child.apiKey}`, [founderHeader]: key,
    });
    const approveRetention = (id, body = {}) => request(`/api/approvals/${id}/approve`, 200, body, founderAuth());
    const decision = async id => (await pool.query(`SELECT a.status, g.consumed_at FROM public.approvals a
      JOIN public.pbk_recording_retention_approvals g ON g.approval_id = a.id WHERE a.id = $1`, [id])).rows[0];
    const pointer = async id => (await pool.query(`SELECT storage_path, storage_bucket, recording_url, payload, updated_at
      FROM public.unified_messages WHERE id = $1`, [id])).rows[0];
    const run = (status, days, approvalId, scanAfter) => request(`${retention}/run`, status, { dryRun: false, days, approvalId, scanAfter });
    const remove = id => bridge.fetch(new URL(`/api/recordings/${id}`, bridge.origin), {
      method: 'DELETE', headers: { authorization: `Bearer ${bridge.apiKey}` },
    });
    const removeInbox = id => bridge.fetch(new URL(`/api/messages/${id}`, bridge.origin), {
      method: 'DELETE', headers: { authorization: `Bearer ${bridge.apiKey}` },
    });
    try {
      assert.equal((await request('/health', 200)).features.stateBackend, 'postgres');
      assert.equal((await remove(staleId)).status, 409, 'a pointerless cache cannot delete a newer durable recording');
      assert.equal((await pointer(staleId)).storage_path, staleKey);
      const staleInbox = await removeInbox(staleId);
      assert.equal(staleInbox.status, 409, 'Inbox deletion must use the durable recording pointer, not the cache');
      assert.equal((await staleInbox.json()).result, 'inbox_recording_requires_guarded_delete');
      assert.equal((await pointer(staleId)).storage_path, staleKey);
      assert.equal((await removeInbox(plainInboxId)).status, 200, 'ordinary messages remain deletable');
      assert.equal(await pointer(plainInboxId), undefined);
      assert.equal((await remove(ambiguousId)).status, 400, 'manual deletion must reject an unstable archive key before I/O');
      assert.deepEqual((await pointer(ambiguousId)).payload, ambiguous);
      assert.equal((await request(`${retention}/preview?days=60`, 200)).run.candidateCount, 0,
        'the old recording is outside the dashboard cache');
      await request(`${retention}/run`, 401, { dryRun: false, days: 60 }, {});
      await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, storage_path)
        VALUES ('retention-legacy-alias', 'pbk', 'call', 'recording', $1)`,
      [`/${bucket}//${target.key.replace('/', '//')}/`]);
      assert.equal((await run(200, 60)).result, 'retention_candidates_pending');
      await pool.query("DELETE FROM public.unified_messages WHERE id = 'retention-legacy-alias'");
      await pool.query(`UPDATE public.unified_messages SET payload = jsonb_set(payload, '{recordingStoragePath}', to_jsonb($2::text))
        WHERE id = $1`, [target.id, replacement.key]);
      assert.equal((await run(200, 60)).result, 'retention_candidates_pending', 'one approval cannot clear distinct pointers on the same row');
      await pool.query("UPDATE public.unified_messages SET payload = payload - 'recordingStoragePath' WHERE id = $1", [target.id]);
      const missingId = 'fixture-retention-missing';
      const missingKey = 'fixture/retention-missing.txt';
      await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, storage_path, storage_bucket, created_at)
        VALUES ($1, 'pbk', 'call', 'recording', $2, $3, $4)`,
      [missingId, missingKey, bucket, new Date(Date.now() - 100 * 86_400_000).toISOString()]);
      await pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, storage_path, storage_bucket, created_at)
        SELECT 'fixture-retention-scan-' || lpad(n::text, 2, '0'), 'pbk', 'call', 'recording',
          'fixture/blocked-' || n::text || '.txt', 'another-fixture-bucket', $1::timestamptz
        FROM generate_series(1, 50) AS n`, [new Date(Date.now() - 110 * 86_400_000).toISOString()]);
      const blockedPage = await run(200, 60);
      assert.equal(blockedPage.result, 'retention_candidates_pending');
      assert.equal(blockedPage.blockedCandidateCount, 50);
      assert.equal(blockedPage.moreCandidates, true);
      assert.equal(blockedPage.nextScanAfter.id, 'fixture-retention-scan-50');
      const queued = await run(202, 60, undefined, blockedPage.nextScanAfter);
      assert.equal(queued.candidateCount, 1, 'retention must find recordings that are not in the dashboard cache');
      assert.deepEqual(queued.blockedCandidates, [{ messageId: missingId, reason: 'storage_object_missing' }]);
      const { approvalId } = queued;
      await run(400, 60, approvalId, blockedPage.nextScanAfter);
      assert.deepEqual(await decision(approvalId), { status: 'pending', consumed_at: null });
      assert.equal((await run(403, 60, approvalId)).result, 'retention_approval_required');
      assert.equal(deleted.length, 0);
      await assertBytes(target.key, target.text);

      const team = await request('/api/auth/team', 200, { passcode: bridge.teamPasscode, actor: 'Synthetic operator' }, {});
      const approve = `/api/approvals/${approvalId}/approve`;
      const updateApproval = `/api/approvals/${approvalId}`;
      const approveBody = { status: 'approved' };
      const putDecision = { method: 'PUT' };
      await request(approve, 403, {}, { 'x-pbk-team-token': team.token, [founderHeader]: bridge.retentionFounderKey });
      await request(approve, 401, {}, { [founderHeader]: bridge.retentionFounderKey });
      assert.equal((await request(approve, 403, {})).result, 'retention_founder_required');
      assert.equal((await request(approve, 403, {}, founderAuth(bridge, randomUUID()))).result, 'retention_founder_required');
      assert.equal((await request(approve, 403, {}, { ...founderAuth(), 'x-pbk-netlify-proxy': '1' })).result,
        'retention_founder_required');
      assert.equal((await request(updateApproval, 403, approveBody, undefined, putDecision)).result, 'retention_founder_required');
      assert.equal((await request(updateApproval, 403, approveBody, founderAuth(bridge, bridge.apiKey), putDecision)).result,
        'retention_founder_required');
      assert.deepEqual(await decision(approvalId), { status: 'pending', consumed_at: null });
      const approved = await approveRetention(approvalId, { actor: 'Synthetic founder' });
      assert.equal(approved.approval.status, 'approved');
      for (const retentionFounderKeyMode of ['missing', 'shared']) {
        const child = await launch({ retentionFounderKeyMode });
        try {
          const denied = await request(approve, 403, {}, founderAuth(child, child.apiKey), { child });
          assert.equal(denied.result, 'retention_founder_required', retentionFounderKeyMode);
          const blocked = await request(`${retention}/run`, 403, { dryRun: false, days: 60, approvalId }, undefined, { child });
          assert.equal(blocked.result, 'retention_approval_required', retentionFounderKeyMode);
        } finally {
          await child.stop();
        }
      }
      assert.deepEqual(await decision(approvalId), { status: 'approved', consumed_at: null });
      assert.equal(deleted.length, 0, 'approving must not dispatch deletion');
      const complete = await run(200, 60, approvalId);
      assert.equal(complete.run.status, 'complete', JSON.stringify({ deletions: complete.run.deletions,
        providerStatuses: deleted.map(item => item.result.status), blockedNetwork: bridge.blockedNetwork, overlapProof, overlapError,
        attempts: (await pool.query('SELECT message_id, outcome FROM public.pbk_recording_retention_attempts')).rows }));
      assert.equal(complete.run.deletedCount, 1);
      assert.deepEqual(complete.run.blockedCandidates, queued.blockedCandidates);
      assert.equal((await pointer(missingId)).storage_path, missingKey);
      assert.equal(deleted.some(item => item.path === missingKey), false);
      await pool.query('DELETE FROM public.unified_messages WHERE id = $1', [missingId]);
      await pool.query("DELETE FROM public.unified_messages WHERE id LIKE 'fixture-retention-scan-%'");
      assert.deepEqual(overlapProof, { unrelatedWrite: 'committed', duplicateWrite: '23514', referenceRemoval: '23514',
        tableRemoval: '23514', pending: { outcome: 'pending', object_version: deleted[0].versionId } });
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
      await assert.rejects(pool.query('UPDATE public.unified_messages SET storage_path = $2 WHERE id = $1', [target.id, target.key]),
        { code: '23514' }, 'a stale pointer must not be restored after confirmed cleanup');

      const racing = await run(202, 30);
      assert.equal(racing.candidateCount, 1);
      await request(`/api/approvals/${racing.approvalId}`, 200, { ...approveBody, actor: 'Synthetic founder' }, founderAuth(), putDecision);
      injectOverwrite = true;
      const held = await run(200, 30, racing.approvalId);
      assert.equal(held.run.status, 'pending');
      assert.equal(held.run.deletedCount, 0);
      assert.equal(deleted.length, 2);
      assert.deepEqual(JSON.parse(deleted[1].result.body), []);
      await assertBytes(replacement.key, 'replacement bytes');
      const blockedFetches = bridge.blockedNetwork.fetch || 0;
      const blockedDelete = await remove(replacement.id);
      assert.equal(blockedDelete.status, 409, await blockedDelete.text());
      const blockedCapture = await request('/api/recordings/capture', 409, {
        messageId: replacement.id, storagePath: replacement.key.replace('/', '//'),
        audioBase64: Buffer.from('must not write this audio').toString('base64'),
      });
      assert.equal(blockedCapture.result, 'recording_storage_busy');
      assert.equal(bridge.blockedNetwork.fetch || 0, blockedFetches, 'blocked write must not reach the Storage transport');
      await assertBytes(replacement.key, 'replacement bytes');
      assert.equal((await pointer(replacement.id)).storage_path, replacement.key);
      assert.equal((await run(409, 30, racing.approvalId)).result, 'retention_approval_consumed');
      assert.equal(deleted.length, 2);
      const { rows: [proof] } = await pool.query(`SELECT plan, founder_approved_at, founder_proof
        FROM public.pbk_recording_retention_approvals WHERE approval_id = $1`, [approvalId]);
      assert.ok(proof.founder_approved_at instanceof Date, 'the decision must leave durable founder proof');
      const expectedProof = createHmac('sha256', bridge.retentionFounderKey).update(JSON.stringify([
        'pbk-recording-retention-founder-v1', approvalId, hashProviderActionContext(proof.plan), proof.founder_approved_at.toISOString(),
      ])).digest('hex');
      assert.ok(proof.founder_proof === expectedProof, 'durable proof must use the separate founder key');

      const cut = await run(202, 10);
      assert.equal(cut.candidateCount, 1);
      await approveRetention(cut.approvalId);
      assert.equal((await run(200, 10, cut.approvalId)).run.status, 'pending');
      assert.equal((await pointer(interrupted.id)).storage_path, interrupted.key);
      const interruptedReadback = await http('GET', `object/info/authenticated/${bucket}/${interrupted.key}`);
      assert.equal(JSON.parse(interruptedReadback.body).code, 'NoSuchKey');
      await bridge.stop();
      bridge = await launch();
      const replay = await run(409, 10, cut.approvalId);
      assert.equal(replay.outcomes[0].outcome, 'pending');
      const unsigned = await run(202, 2);
      const decidedAt = new Date().toISOString();
      await pool.query("UPDATE public.approvals SET status = 'approved', decided_at = $2 WHERE id = $1", [unsigned.approvalId, decidedAt]);
      await pool.query(`UPDATE public.pbk_recording_retention_approvals SET founder_approved_at = $2, founder_proof = $3
        WHERE approval_id = $1`, [unsigned.approvalId, decidedAt, randomBytes(32).toString('hex')]);
      assert.equal((await run(403, 2, unsigned.approvalId)).result, 'retention_approval_required');
      await assertBytes(later.key, later.text);
      const next = await run(202, 2);
      assert.equal(next.candidateCount, 1);
      assert.equal(next.blockedCandidateCount, 2);
      await approveRetention(next.approvalId);
      assert.equal((await run(200, 2, next.approvalId)).run.deletedCount, 1);
      assert.equal(deleted.filter(item => item.path === interrupted.key).length, 1, 'unknown deletion must not replay');

      // A sequence witness survives rollback and proves the fault ran after the in-transaction confirmation.
      await pool.query(`CREATE SEQUENCE public.fixture_retention_pointer_refusals;
        CREATE FUNCTION public.fixture_reject_retention_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM public.pbk_recording_retention_attempts
                     WHERE message_id = OLD.id AND outcome = 'confirmed') THEN
            PERFORM nextval('public.fixture_retention_pointer_refusals');
            RAISE EXCEPTION 'Synthetic pointer update rejection';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER zz_fixture_reject_retention_pointer
          BEFORE UPDATE OF storage_path ON public.unified_messages FOR EACH ROW
          WHEN (OLD.id = 'fixture-retention-pointer-rollback' AND OLD.storage_path <> '' AND NEW.storage_path = '')
          EXECUTE FUNCTION public.fixture_reject_retention_pointer();`);
      const beforePointer = await pointer(rollback.id);
      const queuedRollback = await run(202, 1);
      assert.equal(queuedRollback.candidateCount, 1);
      await approveRetention(queuedRollback.approvalId);
      const rolledBack = await run(200, 1, queuedRollback.approvalId);
      assert.equal(rolledBack.run.status, 'pending');
      assert.equal(rolledBack.run.deletedCount, 0);
      assert.equal(rolledBack.run.deletions[0].messageId, rollback.id);
      const { rows: witnesses } = await pool.query('SELECT last_value::text, is_called FROM public.fixture_retention_pointer_refusals');
      assert.deepEqual(witnesses, [{ last_value: '1', is_called: true }], 'the pointer write failed after the outcome was set to confirmed');
      const rollbackDeletion = deleted.find(item => item.path === rollback.key);
      assert.equal(JSON.parse(rollbackDeletion.result.body)[0].version, rollbackDeletion.versionId);
      const { rows: attempts } = await pool.query(`SELECT bucket, storage_key, object_version, outcome, finished_at
        FROM public.pbk_recording_retention_attempts
        WHERE approval_id = $1 AND message_id = $2`, [queuedRollback.approvalId, rollback.id]);
      assert.deepEqual(attempts, [{ bucket, storage_key: rollback.key, object_version: rollbackDeletion.versionId,
        outcome: 'pending', finished_at: null }]);
      assert.deepEqual(await pointer(rollback.id), beforePointer);
      assert.ok((await decision(queuedRollback.approvalId)).consumed_at instanceof Date);
      const rollbackReadback = await http('GET', `object/info/authenticated/${bucket}/${rollback.key}`);
      assert.equal(JSON.parse(rollbackReadback.body).code, 'NoSuchKey');
      const rollbackReplay = await run(409, 1, queuedRollback.approvalId);
      assert.equal(rollbackReplay.outcomes[0].outcome, 'pending');
      const rollbackBlockedFetches = bridge.blockedNetwork.fetch || 0;
      const rollbackManualDelete = await remove(rollback.id);
      assert.equal(rollbackManualDelete.status, 409);
      assert.equal((await rollbackManualDelete.json()).result, 'recording_storage_busy');
      assert.equal(bridge.blockedNetwork.fetch || 0, rollbackBlockedFetches, 'the pending key must block independent writes before Storage I/O');
      assert.equal(deleted.filter(item => item.path === rollback.key).length, 1, 'a pointer rollback must not replay the confirmed Storage deletion');
      const cachedInboxMessage = async () => (await request('/api/messages', 200)).messages.find(item => item.id === rollback.id);
      const durableInboxMessage = async () => (await pool.query('SELECT * FROM public.unified_messages WHERE id = $1', [rollback.id])).rows[0];
      const savedInboxMessage = async () => (await pool.query(`SELECT message FROM public.bridge_state,
        jsonb_array_elements(data->'messages') AS items(message)
        WHERE id = 'singleton' AND message->>'id' = $1`, [rollback.id])).rows[0]?.message;
      const cachedBefore = await cachedInboxMessage();
      const durableBefore = await durableInboxMessage();
      const savedBefore = await savedInboxMessage();
      assert.equal(cachedBefore.status, 'recorded');
      assert.equal(durableBefore.status, 'recorded');
      assert.equal(savedBefore.status, 'recorded');
      for (const [method, suffix, flag] of [['PATCH', '/archive', 'archived'], ['DELETE', '', 'deleted']]) {
        const inboxResponse = await bridge.fetch(new URL(`/api/messages/${rollback.id}${suffix}`, bridge.origin), {
          method, headers: { authorization: `Bearer ${bridge.apiKey}`, 'content-type': 'application/json' },
          body: method === 'PATCH' ? '{}' : undefined,
        });
        const inboxResult = await inboxResponse.json();
        assert.deepEqual({ status: inboxResponse.status, ok: inboxResult.ok, changed: inboxResult[flag],
          durable: await durableInboxMessage(), cached: await cachedInboxMessage(), saved: await savedInboxMessage() },
        { status: 409, ok: false, changed: false, durable: durableBefore, cached: cachedBefore, saved: savedBefore },
        `generic Inbox ${method} must leave both records and the cache unchanged when retention is pending`);
      }
      const fenceProbe = await pool.connect();
      try {
        await fenceProbe.query('BEGIN');
        // Different approval and message IDs leave the key as the only conflict.
        const tryReservation = (sourceApproval, sourceMessage, newKey = null) => fenceProbe.query(`
          INSERT INTO public.pbk_recording_retention_attempts
            (approval_id, message_id, bucket, storage_key, object_version, row_version)
          SELECT $1, $2, bucket, COALESCE($3::text, storage_key), object_version, row_version
          FROM public.pbk_recording_retention_attempts WHERE approval_id = $4 AND message_id = $5
          ON CONFLICT DO NOTHING RETURNING storage_key`,
        [next.approvalId, 'fixture-retention-cross-message', newKey, sourceApproval, sourceMessage]);
        assert.equal((await tryReservation(queuedRollback.approvalId, rollback.id)).rowCount, 0, 'a pending key must be fenced across messages');
        assert.equal((await tryReservation(approvalId, target.id)).rowCount, 0, 'a confirmed key must be fenced across messages');
        const distinctKey = 'fixture/retention-pointer-rollback-other.txt';
        assert.deepEqual((await tryReservation(queuedRollback.approvalId, rollback.id, distinctKey)).rows,
          [{ storage_key: distinctKey }], 'an otherwise identical reservation must succeed for an unfenced key');
      } finally {
        try { await fenceProbe.query('ROLLBACK'); } finally { fenceProbe.release(); }
      }

      await put(unverified.key, 'synthetic unverified readback');
      const unverifiedCreatedAt = new Date(Date.now() - 1.25 * 86_400_000).toISOString();
      await ageObject(unverified.key, unverifiedCreatedAt);
      await pool.query(`INSERT INTO public.unified_messages
        (id, workspace_id, channel, direction, storage_path, storage_bucket, created_at)
        VALUES ($1,'pbk','call','recording',$2,$3,$4)`, [unverified.id, unverified.key, bucket, unverifiedCreatedAt]);
      const unverifiedBefore = await pointer(unverified.id);
      const queuedUnverified = await run(202, 1);
      assert.equal(queuedUnverified.candidateCount, 1);
      await approveRetention(queuedUnverified.approvalId);
      const unverifiedRun = await run(200, 1, queuedUnverified.approvalId);
      assert.equal(unverifiedRun.run.status, 'pending');
      assert.equal(unverifiedRun.run.deletedCount, 0);
      assert.deepEqual(await pointer(unverified.id), unverifiedBefore, 'an unclassified 404 cannot clear the recording pointer');
      const unverifiedDelete = deleted.find(item => item.path === unverified.key);
      assert.equal(JSON.parse(unverifiedDelete.result.body)[0].version, unverifiedDelete.versionId);
      assert.equal((await run(409, 1, queuedUnverified.approvalId)).outcomes[0].outcome, 'pending');

      const writerId = 'fixture-retention-writer';
      await put(retentionWriterFixtureKey, 'synthetic seed bytes');
      const capture = (status, bytes) => request('/api/recordings/capture', status, {
        messageId: writerId, storagePath: `//${bucket}//${retentionWriterFixtureKey.replace('/', '///')}/`,
        contentType: 'text/plain', audioBase64: Buffer.from(bytes).toString('base64'),
      });
      const writerLease = async () => (await pool.query(`SELECT storage_key, operation
        FROM public.pbk_recording_storage_writes WHERE message_id = $1 AND rejected_at IS NULL`, [writerId])).rows[0];
      const firstCapture = await capture(200, 'synthetic writer first');
      assert.equal(firstCapture.storagePath, retentionWriterFixtureKey);
      assert.equal((await pointer(writerId)).storage_path, retentionWriterFixtureKey);
      assert.equal(await writerLease(), undefined);
      const inboxWriter = await removeInbox(writerId);
      assert.equal(inboxWriter.status, 409, 'an unfenced recording needs the guarded recording-delete route');
      assert.equal((await inboxWriter.json()).result, 'inbox_recording_requires_guarded_delete');
      assert.equal((await pointer(writerId)).storage_path, retentionWriterFixtureKey);
      await assertBytes(retentionWriterFixtureKey, 'synthetic writer first');
      duringCapture = async () => { throw new Error('Invalid pointer request reached Storage'); };
      for (const malformed of [{ storage_path: 0 }, { payload: { s3Archive: { key: false } } }]) {
        await request('/api/recordings/capture', 400, {
          messageId: writerId, storagePath: retentionWriterFixtureKey, contentType: 'text/plain',
          audioBase64: Buffer.from('synthetic writer second').toString('base64'), ...malformed,
        });
      }
      duringCapture = undefined;
      assert.equal(await writerLease(), undefined);
      const setMimeTypes = async types => {
        const result = await http('PUT', `bucket/${bucket}`, JSON.stringify({ allowed_mime_types: types }));
        assert.equal(result.status, 200, result.body);
      };
      await setMimeTypes(['audio/wav']);
      const denied = await capture(415, 'synthetic writer second');
      assert.equal(denied.result, 'recording_storage_upload_rejected');
      assert.equal(await writerLease(), undefined, 'a proven rejection must release the active reservation');
      assert.equal((await pool.query(`SELECT rejection_code FROM public.pbk_recording_storage_writes
        WHERE message_id = $1 AND rejected_at IS NOT NULL`, [writerId])).rows[0]?.rejection_code, 'InvalidMimeType');
      await assertBytes(retentionWriterFixtureKey, 'synthetic writer first');
      await setMimeTypes(['text/plain']);
      await pool.query("UPDATE public.unified_messages SET storage_bucket = 'other-fixture-bucket' WHERE id = $1", [writerId]);
      assert.equal((await remove(writerId)).status, 409, 'a stale configured bucket cannot authorize deletion');
      await assertBytes(retentionWriterFixtureKey, 'synthetic writer first');
      await pool.query('UPDATE public.unified_messages SET storage_bucket = $2 WHERE id = $1', [writerId, bucket]);
      let captureOverlap;
      duringCapture = async () => {
        const meta = await request('/api/recordings', 503, { messageId: writerId, storagePath: retentionWriterFixtureKey });
        captureOverlap = { ...await writerLease(), deleteStatus: (await remove(writerId)).status, metaResult: meta.result };
      };
      await capture(200, 'synthetic writer second');
      duringCapture = undefined;
      assert.deepEqual(captureOverlap, { storage_key: retentionWriterFixtureKey, operation: 'capture',
        deleteStatus: 409, metaResult: 'recording_storage_write_pending' });
      await assertBytes(retentionWriterFixtureKey, 'synthetic writer second');
      let deleteOverlap;
      duringManualDelete = async () => {
        deleteOverlap = { ...await writerLease(), captureResult: (await capture(409, 'synthetic writer first')).result };
      };
      const removed = await remove(writerId);
      assert.equal(removed.status, 200, await removed.text());
      assert.deepEqual(deleteOverlap, { storage_key: retentionWriterFixtureKey, operation: 'delete', captureResult: 'recording_storage_busy' });
      assert.equal(await pointer(writerId), undefined);
      assert.equal(await writerLease(), undefined);
      const missingWriter = await http('GET', `object/info/authenticated/${bucket}/${retentionWriterFixtureKey}`);
      assert.equal(JSON.parse(missingWriter.body).code, 'NoSuchKey');
      duringCapture = async () => { throw new Error('Synthetic transport interruption'); };
      assert.equal((await capture(503, 'synthetic writer first')).result, 'recording_storage_write_pending');
      duringCapture = undefined;
      assert.equal((await capture(409, 'synthetic writer second')).result, 'recording_storage_busy');
      assert.deepEqual(await writerLease(), { storage_key: retentionWriterFixtureKey, operation: 'capture' });
      const archiveGuard = randomUUID();
      await pool.query(`INSERT INTO public.pbk_recording_storage_writes
        (token, message_id, bucket, archive_bucket, archive_key, operation)
        VALUES ($1, 'fixture-archive-owner', $2, 'fixture-archive', 'fixture/isolated-archive.wav', 'delete')`, [archiveGuard, bucket]);
      try {
        await assert.rejects(pool.query(`INSERT INTO public.unified_messages (id, workspace_id, channel, direction, payload)
          VALUES ('fixture-archive-alias', 'pbk', 'call', 'recording', $1)`,
        [JSON.stringify({ s3Archive: { key: '/fixture//isolated-archive.wav' } })]), { code: '23514' });
      } finally {
        await pool.query('DELETE FROM public.pbk_recording_storage_writes WHERE token = $1', [archiveGuard]);
      }
      console.log('HTTP retention: pending/team blocked; founder approval consumed once; durable row and Storage agree; racing replacement preserved');
    } finally {
      await bridge.stop();
    }
  });
}
