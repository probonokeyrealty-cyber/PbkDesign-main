import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { closureNativeDockerTarget, validateClosureDockerContext, closureNativeEnvironment,
  validateOwnedClosureContainer, runLocalClosurePostgresProof } from './dead-letter-closure-postgres-local.mjs';

const dockerTargets = [
  { platform: 'win32', env: { PBK_CLOSURE_TEST_ENABLE: '1' },
    context: 'desktop-linux', endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine' },
  { platform: 'linux', env: { PBK_CLOSURE_TEST_ENABLE: '1', CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'Linux' },
    context: 'default', endpoint: 'unix:///var/run/docker.sock' },
];

test('native Docker target preserves Windows desktop and permits only opted-in GitHub Actions Linux', () => {
  for (const { platform, env, context, endpoint } of dockerTargets) {
    assert.deepEqual(closureNativeDockerTarget(platform, env), { context, endpoint });
    for (const optIn of [undefined, '', 'true', '0']) {
      assert.throws(() => closureNativeDockerTarget(platform, { ...env, PBK_CLOSURE_TEST_ENABLE: optIn }), /opt-in/);
    }
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
      assert.throws(() => closureNativeDockerTarget(platform, { ...env, [key]: 'override' }), /override/);
    }
  }
  const linux = dockerTargets[1];
  for (const key of ['CI', 'GITHUB_ACTIONS', 'RUNNER_OS']) {
    for (const value of [undefined, '', 'false', '1', 'Windows']) {
      assert.throws(() => closureNativeDockerTarget('linux', { ...linux.env, [key]: value }), /GitHub Actions/);
    }
  }
  for (const platform of ['darwin', 'freebsd', 'aix', '']) {
    assert.throws(() => closureNativeDockerTarget(platform, linux.env), /platform/);
  }
});

test('native Docker context guard rejects remote, alternate and malformed contexts on both platforms', () => {
  for (const { context, endpoint } of dockerTargets) {
    const info = { Name: context, Endpoints: { docker: { Host: endpoint } } };
    assert.doesNotThrow(() => validateClosureDockerContext([info], { context, endpoint }));
    for (const bad of [[], [info, info], null, {}, [{ ...info, Name: 'remote' }],
      [{ Name: context }], [{ ...info, Endpoints: { docker: { Host: 'tcp://remote.invalid:2375' } } }],
      [{ ...info, Endpoints: { docker: { Host: 'unix:///tmp/docker.sock' } } }],
      [{ ...info, Endpoints: { docker: { Host: `${endpoint}/` } } }]]) {
      assert.throws(() => validateClosureDockerContext(bad, { context, endpoint }));
    }
  }
});

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

async function ambiguousRun(t, { result, target, changeInfo = () => {}, absent = false, changedContext = false }) {
  const calls = [], id = 'b'.repeat(64), imageId = `sha256:${'c'.repeat(64)}`;
  const image = 'pgvector/pgvector@sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd';
  let info, name, token, running = false, stopped = false, contextChecks = 0;
  const mockErrors = [], summaries = [];
  const ok = value => ({ status: 0, stdout: typeof value === 'string' ? value : JSON.stringify(value), stderr: '' });
  const original = childProcess.spawnSync, originalEnv = process.env;
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  t.mock.method(console, 'log', summary => summaries.push(JSON.parse(summary)));
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    try {
      assert.equal(command, 'docker', 'no database/native child may run after ambiguous provisioning');
      assert.deepEqual(args.slice(0, 2), ['--context', target.context]);
      assert.equal(options.timeout, 60000);
      for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
        assert.equal(options.env[key], undefined, 'Docker must not inherit host/context overrides');
      }
      const action = args.slice(2); calls.push(action);
      if (action[0] === 'context') {
        contextChecks++;
        return ok([{ Name: target.context, Endpoints: { docker: { Host: changedContext && contextChecks > 1
          ? 'tcp://remote.invalid:2375' : target.endpoint } } }]);
      }
      if (action[0] === 'info') return ok('29.4.0');
      if (action[0] === 'image') return ok([{ Id: imageId, RepoDigests: [image] }]);
      if (action[0] === 'run') {
        name = action[action.indexOf('--name') + 1];
        token = action[action.indexOf('--label') + 1].split('=')[1];
        assert.match(token, /^[a-f0-9]{32}$/); assert.equal(name, `pbk-closure-${token}`);
        info = { Id: id, Name: `/${name}`, Image: imageId, Config: { Labels: { 'pbk.closure-test': token } },
          HostConfig: { AutoRemove: true, Tmpfs: { '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=256m' } },
          NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '54321' }] } } };
        changeInfo(info); running = !absent;
        return result;
      }
      if (action[0] === 'ps') {
        assert.deepEqual(action, ['ps', '--all', '--no-trunc', '--filter', `name=^/${name}$`,
          '--filter', `label=pbk.closure-test=${token}`, '--format', '{{.ID}}'], 'lookup must not broaden beyond exact generated owner');
        return ok(running ? id : '');
      }
      if (action[0] === 'inspect') {
        assert.deepEqual(action, ['inspect', id]);
        return ok([info]);
      }
      if (action[0] === 'stop') {
        assert.deepEqual(action, ['stop', '--time', '5', id]);
        running = false; stopped = true;
        return ok(id);
      }
      assert.fail('unexpected Docker operation');
    } catch (error) { mockErrors.push(error.message); throw error; }
  });
  syncBuiltinESMExports();
  process.env = { ...target.env };
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: target.platform });
  try {
    await assert.rejects(runLocalClosurePostgresProof());
    assert.deepEqual(mockErrors, [], 'wrapper must not swallow unexpected process operations or unsafe lookup arguments');
    return { calls, running, stopped, contextChecks, summaries };
  } finally {
    childProcess.spawnSync = original; syncBuiltinESMExports();
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', platformDescriptor);
  }
}

for (const target of dockerTargets) {
  test(`${target.platform}: ambiguous run timeout or nonzero status reconciles and stops only the exact owned container`, async t => {
    for (const result of [{ status: null, stdout: '', stderr: '', error: { code: 'ETIMEDOUT' } },
      { status: 1, stdout: '', stderr: 'acknowledgement lost' }]) {
      await t.test(result.status === null ? 'ETIMEDOUT after creation' : 'nonzero after creation', async child => {
        const proof = await ambiguousRun(child, { result, target });
        assert.equal(proof.stopped, true, 'created container must be stopped even when run acknowledgement is lost');
        assert.equal(proof.running, false);
        assert(proof.contextChecks >= 2, 'cleanup must revalidate local context');
        assert(proof.calls.some(call => call[0] === 'inspect'), 'cleanup must verify actual identity before stop');
        assert.deepEqual(proof.summaries, [{ ownedContainerRemoved: true, generatedDatabaseDropped: false,
          unrelatedResourcesTouched: false }]);
      });
    }
  });

  test(`${target.platform}: ambiguous run absence or unverifiable ownership never broadens cleanup`, async t => {
    const result = { status: null, stdout: '', stderr: '', error: { code: 'ETIMEDOUT' } };
    for (const [name, options] of [
      ['absent exact resource', { absent: true }],
      ['changed local context', { changedContext: true }],
      ['wrong ID', { changeInfo: info => { info.Id = 'd'.repeat(64); } }],
      ['wrong exact name', { changeInfo: info => { info.Name = '/unrelated'; } }],
      ['wrong image', { changeInfo: info => { info.Image = 'wrong'; } }],
      ['wrong ownership label', { changeInfo: info => { info.Config.Labels = {}; } }],
      ['not auto-removed', { changeInfo: info => { info.HostConfig.AutoRemove = false; } }],
      ['missing tmpfs', { changeInfo: info => { info.HostConfig.Tmpfs = {}; } }],
      ['nonloopback publication', { changeInfo: info => { info.NetworkSettings.Ports['5432/tcp'][0].HostIp = '0.0.0.0'; } }],
      ['invalid port', { changeInfo: info => { info.NetworkSettings.Ports['5432/tcp'][0].HostPort = '0'; } }],
    ]) {
      await t.test(name, async child => {
        const proof = await ambiguousRun(child, { result, target, ...options });
        assert.equal(proof.stopped, false); assert.deepEqual(proof.summaries, []);
        assert.equal(proof.running, !options.absent);
        assert(proof.contextChecks >= 2, 'reconciliation must revalidate context even without an acknowledged ID');
        assert.equal(proof.calls.some(call => call[0] === 'ps'), !options.changedContext);
        assert.equal(proof.calls.some(call => call[0] === 'inspect'), !options.changedContext && !options.absent);
      });
    }
  });
}
