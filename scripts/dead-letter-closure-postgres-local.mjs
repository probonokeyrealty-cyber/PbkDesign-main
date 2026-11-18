import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { validateClosureMigrationConfig } from './dead-letter-closure-migration.mjs';

const IMAGE = 'pgvector/pgvector@sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd';
const CONTEXT = 'desktop-linux';
const ENDPOINT = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const generated = value => /^pbk_closure_test_[a-f0-9]{32}$/.test(value);

// Mapping is for this test child only, never the runtime's ambient pool selector.
export function closureNativeEnvironment(env) {
  if (env.PBK_CLOSURE_TEST_ENABLE !== '1') throw new Error('Explicit PBK_CLOSURE_TEST_ENABLE=1 opt-in required');
  const mapped = { PBK_CLOSURE_PG_TEST_ENABLE: '1', PBK_CLOSURE_MIGRATION_TARGET: 'local' };
  for (const suffix of ['DATABASE_URL', 'EXPECT_HOST', 'EXPECT_DATABASE', 'EXPECT_ROLE']) {
    mapped[`PBK_CLOSURE_MIGRATION_${suffix}`] = env[`PBK_CLOSURE_TEST_${suffix}`];
  }
  const config = validateClosureMigrationConfig(mapped);
  assert.equal(config.host, '127.0.0.1', 'literal loopback required');
  assert(generated(config.expectedDatabase), 'generated disposable database required');
  assert.match(config.expectedRole, /^closure_test_owner_[a-f0-9]{32}$|^closure_test_owner$/);
  return mapped;
}

export function validateOwnedClosureContainer(info, { id, token, imageId }) {
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.match(token, /^[a-f0-9]{32}$/);
  assert.equal(info.Id, id);
  assert.equal(info.Image, imageId);
  assert.equal(info.Config.Labels['pbk.closure-test'], token);
  assert.equal(info.HostConfig.AutoRemove, true);
  assert(info.HostConfig.Tmpfs['/var/lib/postgresql/data'], 'ephemeral data required');
  const bindings = info.NetworkSettings.Ports['5432/tcp'];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, '127.0.0.1');
  const port = Number(bindings[0].HostPort);
  assert(Number.isInteger(port) && port > 0 && port <= 65535);
  return port;
}

function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|HOME)$/i.test(key)));
}

export async function runLocalClosurePostgresProof() {
  if (process.env.PBK_CLOSURE_TEST_ENABLE !== '1') throw new Error('Explicit PBK_CLOSURE_TEST_ENABLE=1 opt-in required; native proof NOT run');
  const env = cleanEnvironment();
  const docker = (args, extraEnv = {}) => {
    const result = spawnSync('docker', ['--context', CONTEXT, ...args], {
      env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error(`Local Docker ${args[0]} failed (output withheld)`);
    return result.stdout.trim();
  };
  const checkContext = () => {
    const context = JSON.parse(docker(['context', 'inspect', CONTEXT]));
    assert.equal(context[0].Endpoints.docker.Host, ENDPOINT);
  };
  checkContext();
  const version = docker(['info', '--format', '{{.ServerVersion}}']);
  const image = JSON.parse(docker(['image', 'inspect', IMAGE]))[0];
  assert(image.RepoDigests.includes(IMAGE), 'approved pinned image required; no pull fallback');
  const token = randomBytes(16).toString('hex');
  const database = `pbk_closure_test_${token}`, owner = `closure_test_owner_${token}`;
  const adminPassword = randomBytes(32).toString('hex'), password = randomBytes(32).toString('hex');
  const owned = { id: null, token, imageId: image.Id };
  let admin, databaseCreated = false, emptyVerified = false, databaseDropped = false;
  const inspect = () => JSON.parse(docker(['inspect', owned.id]))[0];
  const redact = value => String(value).replaceAll(adminPassword, '[redacted]').replaceAll(password, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted-db-url]');
  try {
    owned.id = docker(['run', '--detach', '--rm', '--pull=never', '--name', `pbk-closure-${token}`,
      '--label', `pbk.closure-test=${token}`, '--publish', '127.0.0.1::5432',
      '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=256m',
      '--env', 'POSTGRES_PASSWORD', IMAGE], { POSTGRES_PASSWORD: adminPassword });
    const port = validateOwnedClosureContainer(inspect(), owned);
    const connection = { host: '127.0.0.1', port, ssl: false, connectionTimeoutMillis: 2000,
      query_timeout: 2000, application_name: 'pbk-closure-disposable-bootstrap' };
    for (let attempt = 0; attempt < 40; attempt++) {
      admin = new pg.Client({ ...connection, database: 'postgres', user: 'postgres', password: adminPassword });
      try { await admin.connect(); break; }
      catch { await admin.end(); admin = null; await new Promise(r => setTimeout(r, 500)); }
    }
    assert(admin, 'owned local PostgreSQL did not become ready');
    assert.equal((await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0].role, 'postgres');
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount, 0);
    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await admin.query(`GRANT SET ON PARAMETER session_replication_role TO ${owner}`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0`);
    databaseCreated = true;
    const verifier = new pg.Client({ ...connection, database, user: owner, password });
    try {
      await verifier.connect();
      const identity = (await verifier.query(`SELECT current_database() AS db,current_user AS role,
        (SELECT rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname=current_user) AS privileged,
        (SELECT count(*) FROM pg_depend d JOIN pg_namespace n ON d.refclassid='pg_namespace'::regclass AND d.refobjid=n.oid
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema')::int AS objects,
        (SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql')::int AS extensions`)).rows[0];
      assert.deepEqual(identity, { db: database, role: owner, privileged: false, objects: 0, extensions: 0 });
      emptyVerified = true;
    } finally { await verifier.end(); }
    const dedicated = { PBK_CLOSURE_TEST_ENABLE: '1', PBK_CLOSURE_TEST_EXPECT_HOST: '127.0.0.1',
      PBK_CLOSURE_TEST_EXPECT_DATABASE: database, PBK_CLOSURE_TEST_EXPECT_ROLE: owner,
      PBK_CLOSURE_TEST_DATABASE_URL: `postgres://${owner}:${password}@127.0.0.1:${port}/${database}` };
    const childEnv = { ...env, ...dedicated, ...closureNativeEnvironment(dedicated),
      PBK_CLOSURE_TEST_VECTOR_ADMIN_PASSWORD: adminPassword };
    const proof = spawnSync(process.execPath, ['--test', '--experimental-test-isolation=none', './scripts/dead-letter-closure-postgres.node-test.mjs'], {
      env: childEnv, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    });
    process.stdout.write(redact(proof.stdout || ''));
    process.stderr.write(redact(proof.stderr || ''));
    assert.equal(proof.status, 0, 'Native proof failed; not a successful skip');
    console.log(JSON.stringify({ result: 'isolated_native_closure_proof_passed', engine: version,
      image: IMAGE, emptyVerified, leastPrivilegedOwner: true, loopbackOnly: true }));
  } finally {
    try {
      if (admin && databaseCreated && emptyVerified) {
        checkContext();
        validateOwnedClosureContainer(inspect(), owned);
        assert(generated(database));
        const db = (await admin.query(`SELECT datname,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1`, [database])).rows;
        assert.deepEqual(db, [{ datname: database, owner }]);
        await admin.query(`DROP DATABASE ${database}`);
        databaseDropped = true;
      }
    } finally {
      try { if (admin) await admin.end(); }
      finally {
        if (owned.id) {
          checkContext();
          validateOwnedClosureContainer(inspect(), owned);
          docker(['stop', '--time', '5', owned.id]);
          assert.equal(docker(['ps', '--all', '--filter', `label=pbk.closure-test=${token}`, '--format', '{{.ID}}']), '');
          console.log(JSON.stringify({ ownedContainerRemoved: true, generatedDatabaseDropped: databaseDropped,
            unrelatedResourcesTouched: false }));
        }
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalClosurePostgresProof().catch(() => {
    console.error(process.env.PBK_CLOSURE_TEST_ENABLE !== '1'
      ? 'Explicit PBK_CLOSURE_TEST_ENABLE=1 required. Native proof NOT run; this is a verification gap.'
      : 'Isolated native closure proof failed; inspect redacted test assertions above. No native pass claimed.');
    process.exitCode = 1;
  });
}
