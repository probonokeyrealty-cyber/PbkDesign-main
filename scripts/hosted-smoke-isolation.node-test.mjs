import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { createServer } from 'node:http';

const root = resolve(import.meta.dirname, '..');
const entry = resolve(root, 'scripts/openclaw-hosted-smoke.mjs');
function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: {
      ...Object.fromEntries(['SystemRoot', 'WINDIR', 'SystemDrive', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
      ...env,
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Smoke test subprocess exceeded its deadline')); }, 180000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('Hosted workflow contains only secret-free isolated checks, not production probes', async () => {
  const source = await readFile(resolve(root, '.github/workflows/hosted-founder-smoke.yml'), 'utf8');
  const workflow = parse(source);
  assert.equal(workflow.name, 'Hosted Founder Smoke');
  assert.doesNotMatch(source, /secrets\.|onrender\.com|netlify\.app|PBK_BRIDGE_API_KEY|PBK_TEAM_PASSCODE|PBK_HOSTED_BRIDGE_URL/);
  const commands = Object.values(workflow.jobs).flatMap(job => job.steps.map(step => step.run || '')).join('\n');
  assert.match(commands, /test:hosted-isolation/);
  assert.match(commands, /test:hosted/);
  assert.match(commands, /test:hosted-browser/);
  assert.doesNotMatch(commands, /test:mobile-browser-proof(?:\s|$)|netlify deploy|render deploy/);
});

test('Importing the hosted entry is inert even with a hostile hosted target', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pbk-hosted-import-'));
  try {
    const script = `
      import net from 'node:net';
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      let requests = 0, processes = 0;
      globalThis.fetch = async () => { requests++; throw Error('network blocked by import test'); };
      net.Socket.prototype.connect = () => { requests++; throw Error('socket blocked by import test'); };
      childProcess.spawn = () => { processes++; throw Error('process blocked by import test'); };
      syncBuiltinESMExports();
      const module = await import(${JSON.stringify(pathToFileURL(entry).href)});
      const ok = requests === 0 && processes === 0 && typeof module.runHostedFounderSmoke === 'function';
      console.log(JSON.stringify({ requests, processes, inert: ok }));
      process.exit(ok ? 0 : 1);
    `;
    const result = await run(['--input-type=module', '-e', script], {
      HOME: temporary, USERPROFILE: temporary, PBK_HOSTED_BRIDGE_URL: 'https://provider.invalid',
      PBK_BRIDGE_API_KEY: 'ambient-authority-must-not-be-used', PBK_HOSTED_SMOKE_MUTATE: 'true',
    });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout.trim()).inert, true);
  } finally {
    assert.equal(resolve(temporary, '..'), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Hosted CLI ignores ambient working state and provider authority', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'pbk-hosted-canary-'));
  const sentinel = join(temporary, 'openclaw-state.json');
  const working = JSON.stringify({ lead: 'working-sample-lead', draft: 'manual draft', notes: 'manual notes', comps: [{ price: 123456 }] });
  await writeFile(sentinel, working);
  let requests = 0;
  const canary = createServer((_req, res) => { requests++; res.end('must not be contacted'); });
  await new Promise(resolve => canary.listen(0, '127.0.0.1', resolve));
  try {
    const target = `http://127.0.0.1:${canary.address().port}`;
    const result = await run([entry], {
      HOME: temporary, USERPROFILE: temporary, PBK_OPENCLAW_STATE_DIR: temporary,
      PBK_OPENCLAW_PORT: String(canary.address().port), PBK_OPENCLAW_RESET: 'true',
      PBK_HOSTED_BRIDGE_URL: target, PBK_BRIDGE_URL: target, PBK_DATABASE_URL: target,
      PBK_BRIDGE_API_KEY: 'ambient-authority-must-not-be-used',
      PBK_HOSTED_SMOKE_MUTATE: 'true', PBK_MOBILE_PROOF_BASE_URL: target,
      PBK_TELNYX_API_KEY: 'sample-provider-poison', PBK_N8N_APPROVAL_WEBHOOK: target,
      PBK_SLACK_WEBHOOK_URL: target, PBK_CAMPAIGN_WORKER_ENABLED: 'true',
    });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.verificationMode, 'isolated_offline');
    assert.equal(report.providerDeliveryVerified, false);
    assert.equal(report.isolation.state, 'disposable-sample');
    assert.equal(report.isolation.pdfRenderer, 'offline-fixture');
    assert.equal(report.leadReplaySafe, true);
    assert.equal(report.approvalReplaySafe, true);
    assert.equal(await readFile(sentinel, 'utf8'), working);
    assert.equal(requests, 0, 'No request may reach even the loopback provider canary');
  } finally {
    await new Promise(resolve => canary.close(resolve));
    assert.equal(resolve(temporary, '..'), resolve(tmpdir()));
    await rm(temporary, { recursive: true, force: true });
  }
});

test('The browser policy blocks real origins, mutations, redirects and non-static fallthroughs', async () => {
  const { classifyHostedSmokeRequest } = await import('./hosted-founder-browser-smoke.mjs');
  const origin = 'http://127.0.0.1:4174';
  for (const target of ['https://provider.invalid/invoke', 'http://localhost:4174/state', 'http://user:password@127.0.0.1:4174/state']) {
    assert.equal(classifyHostedSmokeRequest('GET', target), 'blocked-external');
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/invoke', '/events', '/reset', '/api/leads/sample', '/assets/module.js', '/api/conversations/not-a-sample/sender-recommendation', '/api/conversations/sample-thread/sender-recommendation?unexpected=1', '/api/communication-identities/sync', '/api/conversations/sample-thread/messages']) {
      assert.equal(classifyHostedSmokeRequest(method, origin + path), 'blocked-write');
    }
  }
  assert.equal(classifyHostedSmokeRequest('POST', origin + '/api/state/stream/session'), 'stream-fixture');
  assert.equal(classifyHostedSmokeRequest('POST', origin + '/api/conversations/sample-thread/sender-recommendation'), 'recommendation-fixture');
  assert.equal(classifyHostedSmokeRequest('PUT', origin + '/api/conversations/sample-thread/sender-recommendation'), 'blocked-write');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/state'), 'fixture');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/brain/state'), 'fixture');
  for (const path of ['/api/anything', '/api/leads-typo', '/api/leads/not-a-sample/full', '/api/conversations/not-a-sample/timeline', '/brain/anything', '/.netlify/functions/unexpected']) {
    assert.equal(classifyHostedSmokeRequest('GET', origin + path), 'blocked-read');
    assert.equal(classifyHostedSmokeRequest('HEAD', origin + path), 'blocked-read');
  }
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/ava-chat'), 'shell');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/assets/App-example.js'), 'static');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/pbk-build-manifest.json'), 'static');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/assets/../package.json'), 'blocked-read');
  assert.equal(classifyHostedSmokeRequest('GET', origin + '/unrecognized'), 'blocked-read');
  const source = await readFile(resolve(root, 'scripts/hosted-founder-browser-smoke.mjs'), 'utf8');
  assert.doesNotMatch(source, /route\.(?:fetch|continue)\s*\(|connectOverCDP|launchPersistentContext|process\.env/);
});

test('Both CLI entries reject target/profile arguments before starting a smoke run', async () => {
  for (const file of ['openclaw-hosted-smoke.mjs', 'hosted-founder-browser-smoke.mjs']) {
    const result = await run([resolve(root, 'scripts', file), '--url=https://provider.invalid']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /accepts no/);
    assert.equal(result.stdout, '');
  }
});

test('Exported smoke rejects overlap before allocating a child and releases ownership on startup failure', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    globalThis.starts = 0;
    const fake = 'data:text/javascript,' + encodeURIComponent(
      'export async function startIsolatedBridge() { globalThis.starts++; if (globalThis.starts === 1) return new Promise((resolve, reject) => { globalThis.rejectStartup = reject; }); throw Error("fixture startup failure"); }'
    );
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === './bridge-smoke-isolation.mjs' && context.parentURL?.endsWith('/openclaw-smoke.mjs')) return { url: fake, shortCircuit: true };
      return next(specifier, context);
    } });
    const { runHostedFounderSmoke } = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const first = runHostedFounderSmoke();
    first.catch(() => {});
    await assert.rejects(runHostedFounderSmoke(), /already running/);
    assert.equal(globalThis.starts, 1);
    globalThis.rejectStartup(Error('fixture startup failure'));
    await assert.rejects(first, /fixture startup failure/);
    await assert.rejects(runHostedFounderSmoke(), /fixture startup failure/);
    assert.equal(globalThis.starts, 2);
    console.log('overlap rejected and failed startup released ownership');
  `;
  const result = await run(['--input-type=module', '-e', script]);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /overlap rejected/);
});
