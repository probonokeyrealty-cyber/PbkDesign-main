import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['src/app/utils/runtimeBridge.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'import.meta.env': '{}' } });
const bridge = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text + '\n//# sourceURL=property-intelligence-client-fixture.mjs').toString('base64'));
const original = { fetch: globalThis.fetch, window: globalThis.window, setTimeout: globalThis.setTimeout };
let storage, calls;
beforeEach(() => {
  storage = new Map(); calls = [];
  storage.set('pbk:local:openclaw-config', JSON.stringify({ endpoint: 'https://fixture.netlify.app', apiKey: 'fixture-host-authority' }));
  storage.set(bridge.RUNTIME_TEAM_SESSION_KEY, JSON.stringify({ token: 'fixture-team', role: 'team', actor: 'Fixture operator', expiresAt: new Date(Date.now() + 3600000).toISOString() }));
  globalThis.window = { location: new URL('https://fixture.netlify.app'), localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, dispatchEvent() {}, addEventListener() {} };
});
afterEach(() => { Object.assign(globalThis, original); });
const invoke = () => bridge.fetchPropertyIntelligenceRequest({ address: '123 Sample Ave, Example, CA 90210', leadId: 'fixture', expectedPropertyAddress: { street: '123 Sample Ave', city: 'Example', state: 'CA', zip: '90210' } });
test('hosted enrichment uses direct Render team authority and a bounded full-record deadline', async () => {
  let release; const hold = new Promise(resolve => { release = resolve; }); const deadlines = [];
  globalThis.setTimeout = (fn, delay, ...args) => { deadlines.push(delay); return original.setTimeout(fn, delay, ...args); };
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); await hold; return Response.json({ ok: true, saved: true }); };
  const pending = invoke(); await new Promise(resolve => setImmediate(resolve));
  release(); const result = await pending;
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://pbk-openclaw-bridge.onrender.com/api/property-data/enrich');
  assert.equal(calls[0].init.headers.Authorization, undefined); assert.equal(calls[0].init.headers['X-PBK-Team-Token'], 'fixture-team');
  assert.ok(deadlines.includes(210000)); assert.equal(calls[0].init.keepalive, false);
  assert.equal(result.saved, true);
});
test('hosted enrichment cannot substitute a host API key for missing team authority', async () => {
  storage.delete(bridge.RUNTIME_TEAM_SESSION_KEY); globalThis.fetch = async () => { calls.push(1); return Response.json({ ok: true }); };
  await assert.rejects(invoke(), error => error.code === 'missing_team_session'); assert.equal(calls.length, 0);
});
test('failed property POST is never replayed', async () => {
  globalThis.fetch = async () => { calls.push(1); return new Response('Unavailable', { status: 503 }); };
  await assert.rejects(invoke()); assert.equal(calls.length, 1);
});
test('a healthy property response can finish after the old proxy and browser deadlines', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release; const hold = new Promise(resolve => { release = resolve; }); let signal;
  globalThis.fetch = async (_url, init) => { signal = init.signal; await hold; return Response.json({ saved: true }); };
  const pending = invoke(); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(65000); assert.equal(signal.aborted, false);
  release(); assert.equal((await pending).saved, true);
});
for (const replace of [false, true]) test('direct auth rejection preserves session identity; replacement=' + replace, async () => {
  globalThis.fetch = async () => {
    if (replace) storage.set(bridge.RUNTIME_TEAM_SESSION_KEY, JSON.stringify({ token: 'replacement-team', role: 'team', actor: 'Fixture operator', expiresAt: new Date(Date.now()+3600000).toISOString() }));
    return new Response('Unauthorized', { status: 401 });
  };
  await assert.rejects(invoke(), error => error.code === 'invalid_team_session');
  assert.equal(bridge.getRuntimeTeamSession()?.token, replace ? 'replacement-team' : undefined);
});
