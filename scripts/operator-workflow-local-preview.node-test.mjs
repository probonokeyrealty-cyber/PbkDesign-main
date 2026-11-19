import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('legacy fleet proof redirects both build and screenshots without changing defaults', () => {
  const source = readFileSync(new URL('./fleet-context-browser-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /const evidenceDir = process\.env\.PBK_OPERATOR_EVIDENCE_DIR \|\| 'output'/);
  assert.match(source, /resolve\(evidenceDir, 'context-hub-build'\)/);
  assert.match(source, /path: resolve\(evidenceDir, `context-hub-workspace-/);
  assert.match(source, /path: resolve\(evidenceDir, `context-hub-fleet-/);
});

async function withPreview(args, execute) {
  const child = spawn(process.execPath, ['scripts/operator-workflow-local-preview.mjs', ...args], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exited = once(child, 'exit');
  let output = '', stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Preview readiness missing: ${stderr}`)), 15000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${stderr}`)); });
      child.stdout.on('data', data => {
        output += data;
        for (const line of output.split('\n')) {
          try {
            const result = JSON.parse(line);
            if (result.mode === 'synthetic_read_only') { clearTimeout(timer); resolve(result); return; }
          } catch { /* Vite may emit non-JSON startup diagnostics. */ }
        }
      });
    });
    await execute(ready);
    child.send('shutdown');
    const [code] = await exited;
    assert.equal(code, 0, stderr);
    await assert.rejects(fetch(ready.origin), 'CLI shutdown closes its listener');
  } finally {
    if (child.exitCode === null) { child.kill(); await exited; }
  }
}

test('CLI announces loopback synthetic URLs, denies server writes directly, and shuts down', async () => {
  await withPreview(['--port', '0'], async ready => {
    assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(ready.leads, `${ready.origin}/leads`);
    assert.equal(ready.skills, `${ready.origin}/skills`);
    assert.equal((await fetch(ready.leads)).status, 200);
    assert.equal((await fetch(ready.skills)).status, 200);
    const before = await (await fetch(`${ready.origin}/api/leads`)).json();
    const repository = await (await fetch(`${ready.origin}/api/skills/governance/repository`)).json();
    const targets = ['/invoke', '/api/leads', '/api/leads/SYN-WORK-000', '/api/lead/send-message', '/api/contract/send',
      '/api/property-data/attom-preview', '/api/property-data/enrich', '/api/property-data/address-suggestions', '/api/property-data/attom-sales',
      '/api/leads/nurture', '/api/leads/add-note', '/api/leads/batch-review-roster', '/api/contracts/prepare',
      '/api/skills/candidates', '/api/skills/ingest', '/api/skills/outcomes', '/api/v1/skills/outcomes', '/api/skills/versions/SYN-SKILL-000/approve',
      '/api/skills/versions/SYN-SKILL-003/activate', '/api/skills/activations/SYN-ACTIVATION-8/rollback',
      '/api/skills/governance/repository', '/.netlify/functions/runtime-bridge/invoke', '/api/not-allowlisted'];
    let denials = 0;
    for (const target of targets) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      const response = await fetch(ready.origin + target, { method });
      assert.equal(response.status, 403, `${method} ${target}`); denials++;
    }
    for (const target of ['/api/not-allowlisted', '/api/leads/foreign/full', '/api/skills/unplanned']) {
      assert.equal((await fetch(ready.origin + target)).status, 404); denials++;
    }
    assert.equal((await fetch(ready.origin + '/api/leads', { headers: { Origin: 'https://example.invalid' } })).status, 403); denials++;
    assert.deepEqual(await (await fetch(`${ready.origin}/api/leads`)).json(), before);
    assert.deepEqual(await (await fetch(`${ready.origin}/api/skills/governance/repository`)).json(), repository);
    assert.deepEqual(await (await fetch(`${ready.origin}/api/state/stream/session`, { method: 'POST' })).json(), { ok: false });
    console.log(`Direct synthetic server denial assertions: ${denials}; roster and repository unchanged`);
  });
});

test('CLI selects another loopback port when requested port is occupied', async () => {
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try {
    const port = occupied.address().port;
    await withPreview(['--port', String(port)], async ready => {
      assert.notEqual(new URL(ready.origin).port, String(port));
      assert.equal(new URL(ready.origin).hostname, '127.0.0.1');
      assert.equal((await fetch(ready.origin + '/api/leads')).status, 200);
      assert.equal(occupied.listening, true, 'Occupied listener remains untouched');
    });
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});
