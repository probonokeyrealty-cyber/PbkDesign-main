import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicMarketWorker,
  normalizeMarket,
  normalizePublicEvidence,
  evidenceDigest,
} from './lib/public-market-worker.mjs';
import { buildPublicMarketBrief } from './fixtures/public-market-program.mjs';

const evidence = {
  ok: true,
  live: true,
  answer: 'Public market inventory rose. Confirm current source dates before making an offer.',
  citations: ['https://example.org/market-report', 'https://example.org/market-report'],
};
function fixture(patch = {}) {
  const calls = [];
  let payload;
  const sandbox = {
    files: {
      write: async (path, value) => {
        calls.push({ path });
        if (path.endsWith('.json')) payload = JSON.parse(value);
      },
    },
    commands: {
      run: async (command, options) => {
        calls.push({ command, options });
        return { exitCode: 0, stdout: JSON.stringify(buildPublicMarketBrief(payload)) };
      },
    },
    kill: async () => {
      calls.push({ kill: true });
      return true;
    },
    ...patch,
  };
  const createSandbox = async (template, options) => {
    calls.push({ template, options });
    return sandbox;
  };
  return { calls, sandbox, createSandbox };
}
const config = {
  PBK_E2B_MARKET_WORKER_ENABLED: 'true',
  PBK_E2B_MARKET_WORKER_API_KEY: 'synthetic-backend-credential',
};
const request = { jobId: 'market-12345678-1234-4123-8123-123456789abc', market: 'Tampa, FL' };
const canary = {
  ...config,
  RENDER: 'true',
  RENDER_SERVICE_ID: 'srv-dbvk7tv40ujc73e0d8gg',
  PBK_E2B_MARKET_FAST_PATH_PERCENT: '10',
};
const sampled = { ...request, jobId: 'market-12345678-1234-4123-8123-000000000013' };

test('market labels and evidence exclude lead/code/secret input and unsafe citations', () => {
  assert.equal(normalizeMarket(' Tampa, FL '), 'Tampa, FL');
  for (const value of [
    '123 Main Street',
    'Tampa\nrun code',
    'https://example.org',
    'seller@example.org',
    'a'.repeat(81),
  ])
    assert.throws(() => normalizeMarket(value));
  assert.deepEqual(normalizePublicEvidence(evidence).citations, [
    'https://example.org/market-report',
  ]);
  for (const value of [
    { ...evidence, live: false },
    { ...evidence, citations: ['http://example.org'] },
    { ...evidence, citations: ['https://127.0.0.1/report'] },
    { ...evidence, citations: ['https://example.org/?token=private'] },
    { ...evidence, answer: 'sk-' + 'x'.repeat(40) },
  ])
    assert.throws(() => normalizePublicEvidence(value));
});

test('default-off construction/status/preparation performs no search or cloud I/O', async () => {
  let calls = 0;
  const w = createPublicMarketWorker({
    env: {},
    search: async () => {
      calls++;
    },
    createSandbox: async () => {
      calls++;
    },
  });
  assert.equal(w.status().state, 'disabled');
  assert.equal((await w.run(request)).ok, false);
  assert.equal(calls, 0);
});

test('a fixed network-disabled worker returns only bound public evidence and always kills', async () => {
  const f = fixture();
  let query;
  const w = createPublicMarketWorker({
    env: config,
    createSandbox: f.createSandbox,
    search: async (q) => {
      query = q;
      return { ...evidence, lead: { email: 'PRIVATE' } };
    },
  });
  const result = await w.run(request);
  assert.equal(result.ok, true);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(result.executionMetrics.provisioning.sdkState, 'injected');
  assert.equal(result.executionMetrics.provisioning.sdkLoadMs, null);
  assert.ok(Number.isInteger(result.executionMetrics.provisioning.createMs));
  assert.match(query, /Tampa, FL/);
  assert.doesNotMatch(query, /seller|leadId/);
  const create = f.calls.find((x) => x.template);
  assert.equal(create.template, 'base');
  assert.equal(create.options.timeoutMs, 60000);
  assert.equal(create.options.allowInternetAccess, false);
  assert.equal(create.options.network.allowPublicTraffic, false);
  assert.deepEqual(create.options.lifecycle, { onTimeout: 'kill' });
  assert.ok(create.options.idempotencyKey);
  const command = f.calls.find((x) => x.command);
  assert.equal(command.command, 'node /home/user/pbk-public-market-worker.mjs');
  assert.equal(f.calls.at(-1).kill, true);
  assert.equal(w.status().ready, true);
  assert.doesNotMatch(
    JSON.stringify(f.calls.filter((x) => !x.template)),
    /synthetic-backend|PRIVATE/
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|synthetic-backend/);
});

test('invalid caller overrides and absent live public evidence never create a sandbox', async () => {
  const f = fixture();
  const w = createPublicMarketWorker({
    env: config,
    createSandbox: f.createSandbox,
    search: async () => ({ ok: false }),
  });
  for (const patch of [
    { code: 'arbitrary' },
    { sandboxId: 'other' },
    { envVars: { secret: 'value' } },
    { template: 'other' },
  ])
    assert.equal((await w.run({ ...request, ...patch })).ok, false);
  assert.equal((await w.run(request)).ok, false);
  assert.equal(f.calls.length, 0);
});

test('records SDK load and create separately across cold and warm jobs in one worker', async () => {
  const f = fixture();
  let loads = 0;
  const worker = createPublicMarketWorker({
    env: config,
    search: async () => evidence,
    loadSandboxSdk: async () => {
      loads++;
      return { Sandbox: { create: f.createSandbox } };
    },
  });
  worker.status();
  assert.equal(loads, 0);
  const cold = await worker.run(request);
  const warm = await worker.run(sampled);
  assert.equal(cold.ok, true);
  assert.equal(warm.ok, true);
  assert.equal(loads, 1);
  assert.equal(f.calls.filter((call) => call.template).length, 2);
  assert.equal(f.calls.filter((call) => call.kill).length, 2);
  const a = cold.executionMetrics;
  const b = warm.executionMetrics;
  assert.match(a.workerInstanceId, /^[a-f0-9-]{36}$/);
  assert.equal(a.workerInstanceId, b.workerInstanceId);
  assert.equal(a.provisioning.sdkState, 'cold');
  assert.ok(Number.isInteger(a.provisioning.sdkLoadMs));
  assert.ok(Number.isInteger(a.provisioning.createMs));
  assert.equal(b.provisioning.sdkState, 'warm');
  assert.equal(b.provisioning.sdkLoadMs, 0);
  assert.ok(Number.isInteger(b.provisioning.createMs));
});

test('only configured staging preloads once without searching or creating a sandbox', async () => {
  const f = fixture();
  let loads = 0;
  let searches = 0;
  const deps = {
    search: async () => { searches++; return evidence; },
    loadSandboxSdk: async () => { loads++; return { Sandbox: { create: f.createSandbox } }; },
  };
  for (const env of [{}, config, { ...canary, RENDER_SERVICE_ID: 'production' }]) {
    await createPublicMarketWorker({ env, ...deps }).preloadSdk(0);
  }
  assert.equal(loads, 0);
  const worker = createPublicMarketWorker({ env: canary, ...deps });
  await Promise.all([worker.preloadSdk(0), worker.preloadSdk(0)]);
  const startup = worker.status().sdkPreload;
  assert.equal(startup.state, 'ready');
  assert.equal(startup.listenerReadyMs, 0);
  assert.ok(startup.completedAtMs >= startup.startedAtMs);
  assert.ok(startup.durationMs >= 0);
  assert.equal(loads, 1);
  assert.equal(searches, 0);
  assert.deepEqual(f.calls, []);
  const result = await worker.run(request);
  assert.equal(result.ok, true);
  assert.equal(result.executionMetrics.workerInstanceId, startup.workerInstanceId);
  assert.equal(result.executionMetrics.provisioning.sdkState, 'warm');
  assert.equal(result.executionMetrics.provisioning.sdkLoadMs, 0);
  assert.equal(loads, 1);
  assert.equal(f.calls.filter((call) => call.template).length, 1);
});

test('does not create a sandbox if SDK loading outlasts the provisioning deadline', async () => {
  const f = fixture();
  let resolveSdk;
  const worker = createPublicMarketWorker({
    env: config,
    search: async () => evidence,
    loadSandboxSdk: () => new Promise((resolve) => { resolveSdk = resolve; }),
    deadlines: { search: 100, create: 5, command: 10, cleanup: 10 },
  });
  const result = await worker.run(request);
  assert.equal(result.result, 'public_market_creation_unknown');
  assert.deepEqual(result.executionMetrics.provisioning, { sdkState: 'cold', sdkLoadMs: null, createMs: null });
  resolveSdk({ Sandbox: { create: f.createSandbox } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
  assert.equal(result.executionMetrics.provisioning.sdkLoadMs, null);
});

test('a failed startup import does not execute anything or block an approved lazy load', async () => {
  const f = fixture();
  let loads = 0;
  const worker = createPublicMarketWorker({
    env: canary,
    search: async () => evidence,
    loadSandboxSdk: async () => {
      if (++loads === 1) throw Error('synthetic import failure');
      return { Sandbox: { create: f.createSandbox } };
    },
  });
  await worker.preloadSdk(0);
  await worker.preloadSdk(0);
  assert.equal(worker.status().sdkPreload.state, 'failed');
  assert.equal(loads, 1);
  assert.deepEqual(f.calls, []);
  const result = await worker.run(request);
  assert.equal(result.ok, true);
  assert.equal(result.executionMetrics.provisioning.sdkState, 'cold');
  assert.equal(loads, 2);
});

test('the staging canary batches only its stable cohort and keeps the same evidence and cleanup', async () => {
  for (const job of [sampled, request, sampled]) {
    const f = fixture();
    const write = f.sandbox.files.write;
    f.sandbox.files.write = async (files, data) => {
      if (!Array.isArray(files)) return write(files, data);
      assert.equal(files.length, 2);
      assert.equal(data.useOctetStream, false);
      f.calls.push({ batch: files.map((file) => file.path) });
      for (const file of files) await write(file.path, file.data);
    };
    let searches = 0;
    const worker = createPublicMarketWorker({
      env: canary,
      createSandbox: f.createSandbox,
      search: async () => {
        searches++;
        return evidence;
      },
    });
    const result = await worker.run(job);
    const batched = job === sampled;
    assert.equal(result.ok, true);
    assert.equal(result.cleanupConfirmed, true);
    assert.equal(result.businessWrites, 0);
    assert.equal(searches, 1);
    assert.equal(f.calls.filter((call) => call.template).length, 1);
    assert.equal(f.calls.filter((call) => call.batch).length, batched ? 1 : 0);
    assert.equal(result.executionMetrics.arm, batched ? 'batched' : 'standard');
    assert.equal(result.executionMetrics.uploadRequests, batched ? 1 : 2);
    assert.deepEqual(Object.keys(result.executionMetrics.stagesMs), [
      'search',
      'provision',
      'upload',
      'execute',
      'cleanup',
    ]);
    for (const ms of [
      result.executionMetrics.totalMs,
      ...Object.values(result.executionMetrics.stagesMs),
    ]) {
      assert.ok(Number.isInteger(ms) && ms >= 0);
    }
  }
});

test('missing, invalid and non-staging configuration do not select the fast path', async () => {
  for (const env of [
    config,
    { ...canary, RENDER: 'false' },
    { ...canary, RENDER_SERVICE_ID: 'other' },
    ...['0', '11', '0.5', '-1', 'off'].map((value) => ({
      ...canary,
      PBK_E2B_MARKET_FAST_PATH_PERCENT: value,
    })),
  ]) {
    const f = fixture();
    const worker = createPublicMarketWorker({
      env,
      createSandbox: f.createSandbox,
      search: async () => evidence,
    });
    assert.equal(worker.status().fastPathPercent, 0);
    const result = await worker.run(sampled);
    assert.equal(result.ok, true);
    assert.equal(result.executionMetrics.arm, 'standard');
    assert.equal(result.executionMetrics.uploadRequests, 2);
  }
});

test('a failed batch fails the job and cleans up without rerunning or falling back', async () => {
  const f = fixture({
    files: {
      write: async () => {
        throw Error('private provider details');
      },
    },
  });
  let searches = 0;
  const worker = createPublicMarketWorker({
    env: canary,
    createSandbox: f.createSandbox,
    search: async () => {
      searches++;
      return evidence;
    },
  });
  const result = await worker.run(sampled);
  assert.equal(result.ok, false);
  assert.equal(result.brief, undefined);
  assert.equal(result.cleanupConfirmed, true);
  assert.equal(searches, 1);
  assert.equal(result.executionMetrics.uploadRequests, 1);
  assert.equal(f.calls.filter((call) => call.template).length, 1);
  assert.equal(f.calls.filter((call) => call.command).length, 0);
  assert.equal(f.calls.at(-1).kill, true);
  assert.doesNotMatch(JSON.stringify(result), /private provider/);
});

test('worker failure, wrong digest/output and cleanup failure never report a successful brief', async () => {
  for (const mode of ['execution', 'digest', 'cleanup']) {
    const f = fixture();
    if (mode === 'execution')
      f.sandbox.commands.run = async () => {
        throw Error('PRIVATE provider payload');
      };
    if (mode === 'digest')
      f.sandbox.commands.run = async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ market: 'other', evidenceDigest: 'wrong' }),
      });
    if (mode === 'cleanup')
      f.sandbox.kill = async () => {
        throw Error('PRIVATE token');
      };
    const w = createPublicMarketWorker({
      env: config,
      createSandbox: f.createSandbox,
      search: async () => evidence,
    });
    const result = await w.run(request);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    if (mode !== 'cleanup') assert.equal(f.calls.at(-1).kill, true);
  }
});

test('concurrent jobs are refused and input hash binds the exact source manifest', async () => {
  let release;
  const f = fixture();
  const w = createPublicMarketWorker({
    env: config,
    createSandbox: f.createSandbox,
    search: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const first = w.run(request);
  await new Promise((r) => setImmediate(r));
  assert.equal(
    (await w.run({ ...request, jobId: request.jobId.replace('12345678', '22345678') })).result,
    'public_market_worker_busy'
  );
  release(evidence);
  assert.equal((await first).ok, true);
  assert.notEqual(
    evidenceDigest({ market: 'A', answer: 'B', citations: [] }),
    evidenceDigest({ market: 'A', answer: 'C', citations: [] })
  );
});

test('an already-absent sandbox is confirmed cleaned by the SDK not-found response', async () => {
  const f = fixture({ kill: async () => false });
  const w = createPublicMarketWorker({
    env: config,
    createSandbox: f.createSandbox,
    search: async () => evidence,
  });
  assert.equal((await w.run(request)).cleanupConfirmed, true);
});

test('altered limitations and common credential formats cannot cross the public boundary', async () => {
  for (const secret of [
    'xoxb-' + 'x'.repeat(30),
    'ghp_' + 'x'.repeat(36),
    'AKIA' + 'A'.repeat(16),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWxsZXIifQ.' + 'x'.repeat(35),
  ]) {
    assert.throws(() => normalizePublicEvidence({ ...evidence, answer: secret }));
  }
  const f = fixture();
  let payload;
  f.sandbox.files.write = async (p, v) => {
    if (p.endsWith('.json')) payload = JSON.parse(v);
  };
  f.sandbox.commands.run = async () => ({
    exitCode: 0,
    stdout: JSON.stringify({
      ...buildPublicMarketBrief(payload),
      limitations: ['No review needed.', 'Guaranteed offer.'],
    }),
  });
  const w = createPublicMarketWorker({
    env: config,
    search: async () => evidence,
    createSandbox: f.createSandbox,
  });
  assert.equal((await w.run(request)).ok, false);
});

test('timed-out create is quarantined and its late sandbox is cleaned without running commands', async () => {
  let resolveCreate;
  const f = fixture();
  const w = createPublicMarketWorker({
    env: config,
    search: async () => evidence,
    createSandbox: () =>
      new Promise((r) => {
        resolveCreate = r;
      }),
    deadlines: { search: 100, create: 5, command: 10, cleanup: 10 },
  });
  const result = await w.run(request);
  assert.equal(result.result, 'public_market_creation_unknown');
  assert.equal(result.ok, false);
  assert.equal((await w.run(request)).result, 'public_market_worker_busy');
  resolveCreate(f.sandbox);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(f.calls, [{ kill: true }]);
});

test('command and cleanup deadlines fail closed and oversized output is discarded', async () => {
  for (const mode of ['command', 'cleanup', 'oversize']) {
    const f = fixture();
    if (mode === 'command') f.sandbox.commands.run = () => new Promise(() => {});
    if (mode === 'cleanup') f.sandbox.kill = () => new Promise(() => {});
    if (mode === 'oversize')
      f.sandbox.commands.run = async () => ({ exitCode: 0, stdout: 'x'.repeat(16001) });
    const w = createPublicMarketWorker({
      env: config,
      search: async () => evidence,
      createSandbox: f.createSandbox,
      deadlines: { search: 100, create: 100, command: 5, cleanup: 5 },
    });
    const result = await w.run(request);
    assert.equal(result.ok, false);
    assert.equal(result.brief, undefined);
    if (mode === 'cleanup') assert.equal(result.result, 'public_market_cleanup_unconfirmed');
    else assert.equal(f.calls.at(-1).kill, true);
  }
});
