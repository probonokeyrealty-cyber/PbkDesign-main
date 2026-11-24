import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createCommandCenterPreview } from './fixtures/command-center-polish-preview.mjs';

const root = await mkdtemp(join(tmpdir(), 'pbk-polish-sample-'));
await writeFile(join(root, 'index.shell.html'), '<html><head></head><body>Sample shell</body></html>');
const { server, origin } = await createCommandCenterPreview({ root });
after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });

test('preview binds only loopback and serves only fictional lead state', async () => {
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  const state = await (await fetch(origin + '/state')).json();
  assert.ok(state.leadImports.length > 0);
  assert.ok(state.leadImports.every(lead => lead.id.startsWith('SYN-')));
  assert.equal(state.approvals[0].status, 'pending');
});

test('preview rejects business mutations without changing sample state', async () => {
  const before = await (await fetch(origin + '/state')).text();
  for (const [method, path] of [['POST', '/api/messages/send'], ['PATCH', '/api/leads/SYN-L-2291'],
    ['DELETE', '/api/leads/SYN-L-2291'], ['POST', '/invoke'], ['POST', '/api/approvals/approve']]) {
    assert.equal((await fetch(origin + path, { method })).status, 403, `${method} ${path}`);
  }
  const stream = await fetch(origin + '/api/state/stream/session', { method: 'POST' });
  assert.deepEqual(await stream.json(), { ok: false });
  assert.equal(await (await fetch(origin + '/state')).text(), before);
});

test('preview confines browser connections and form submissions to sample-only behavior', async () => {
  const response = await fetch(origin + '/command-center');
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'none'/);
  const html = await response.text();
  assert.match(html, /endpoint:location.origin/);
  assert.doesNotMatch(html, /onrender\.com|netlify\.app/);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('preview refuses encoded paths outside its built asset directory', async () => {
  const response = await fetch(origin + '/..%2foutside-sample.txt');
  assert.equal(response.status, 404);
});
