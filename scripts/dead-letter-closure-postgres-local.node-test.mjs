import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { closureNativeEnvironment, validateOwnedClosureContainer } from './dead-letter-closure-postgres-local.mjs';

test('requested native command fails, rather than skipping, without opt-in', () => {
  const result = spawnSync(process.execPath, ['./scripts/dead-letter-closure-postgres-local.mjs'], {
    encoding: 'utf8', timeout: 10000, env: {}, windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Native proof NOT run; this is a verification gap/);
  assert.equal(result.stdout, '');
});

test('native wrapper maps dedicated test fields through strict migration guard without ambient fallback', () => {
  assert.throws(() => closureNativeEnvironment({ DATABASE_URL: 'ambient' }), /opt-in/);
  assert.throws(() => closureNativeEnvironment({ PBK_CLOSURE_TEST_ENABLE: '1', PBK_DATABASE_URL: 'ambient' }));
  const dedicated = { PBK_CLOSURE_TEST_ENABLE: '1', PBK_CLOSURE_TEST_EXPECT_HOST: '127.0.0.1',
    PBK_CLOSURE_TEST_EXPECT_DATABASE: `pbk_closure_test_${'a'.repeat(32)}`,
    PBK_CLOSURE_TEST_EXPECT_ROLE: 'closure_test_owner',
    PBK_CLOSURE_TEST_DATABASE_URL: `postgres://closure_test_owner:fixture-only@127.0.0.1:54321/pbk_closure_test_${'a'.repeat(32)}` };
  assert.equal(closureNativeEnvironment(dedicated).PBK_CLOSURE_MIGRATION_EXPECT_ROLE, 'closure_test_owner');
  for (const changes of [{ PBK_CLOSURE_TEST_EXPECT_HOST: 'localhost' },
    { PBK_CLOSURE_TEST_EXPECT_DATABASE: 'postgres' }, { PBK_CLOSURE_TEST_EXPECT_ROLE: 'postgres' },
    { PBK_CLOSURE_TEST_DATABASE_URL: `${dedicated.PBK_CLOSURE_TEST_DATABASE_URL}?host=remote.invalid` }]) {
    assert.throws(() => closureNativeEnvironment({ ...dedicated, ...changes }));
  }
});

test('cleanup identity requires owned label, exact ID/image, tmpfs and literal loopback publication', () => {
  const token = 'a'.repeat(32), id = 'b'.repeat(64), imageId = `sha256:${'c'.repeat(64)}`;
  const info = { Id: id, Image: imageId, Config: { Labels: { 'pbk.closure-test': token } },
    HostConfig: { AutoRemove: true, Tmpfs: { '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=256m' } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] } } };
  assert.equal(validateOwnedClosureContainer(info, { id, token, imageId }), 54321);
  for (const changed of [{ Id: 'd'.repeat(64) }, { Image: 'wrong' }, { Config: { Labels: {} } },
    { NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '54321' }] } } }]) {
    assert.throws(() => validateOwnedClosureContainer({ ...info, ...changed }, { id, token, imageId }));
  }
});
