import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createPbkReadOnlyMcpEndpoint,
  createPbkReadOnlyMcpServer,
} from '../mcp-server/runtime/pbk-readonly-mcp.mjs';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
const token = 'synthetic-inbound-fixture-credential';
async function fixture(t, patch = {}) {
  let calls = 0;
  const env = {
    PBK_COMPOSIO_STAGING_ENABLED: 'true',
    PBK_COMPOSIO_INBOUND_ENABLED: 'true',
    PBK_COMPOSIO_INBOUND_TOKEN: token,
    ...patch,
  };
  let endpoint;
  const server = createServer((req, res) => endpoint.handle(req, res));
  server.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp/pbk-readonly`;
  env.PBK_COMPOSIO_INBOUND_URL = url;
  endpoint = createPbkReadOnlyMcpEndpoint({
    env,
    allowLoopback: true,
    readStatus: async (kind) => {
      calls++;
      return kind === 'health'
        ? {
            ok: true,
            features: { authRequired: true, stateBackend: 'postgres' },
            secret: 'PRIVATE',
            state: { leads: ['PRIVATE'] },
          }
        : kind === 'registry'
          ? {
              registry: {
                agents: [
                  { name: 'Ava', endpoint: 'PRIVATE' },
                  { name: 'Rex' },
                  { name: 'INJECTED_PRIVATE_NAME' },
                ],
              },
            }
          : {
              outbound: { ready: false, state: 'configuration_missing', key: 'PRIVATE' },
              inbound: { ready: false },
            };
    },
  });
  t.after(async () => {
    await endpoint.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  async function client() {
    const c = new Client({ name: 'composio-compatible-fixture', version: '1' });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      })
    );
    t.after(() => c.close());
    return c;
  }
  return { url, endpoint, client, calls: () => calls };
}
test('real MCP client sees only permitted tools and receives selected metadata', async (t) => {
  const f = await fixture(t);
  assert.equal(f.endpoint.status().ready, false);
  const c = await f.client();
  assert.deepEqual((await c.listTools()).tools.map((t) => t.name).sort(), [
    'pbk_agent_registry',
    'pbk_connection_readiness',
    'pbk_health',
  ]);
  for (const name of ['pbk_health', 'pbk_agent_registry', 'pbk_connection_readiness']) {
    const result = await c.callTool({ name, arguments: {} });
    assert.ok(!result.isError);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|synthetic-inbound|endpoint|leads/);
  }
  assert.equal(f.endpoint.status().ready, true);
  assert.equal(f.calls(), 3);
});
test('missing/invalid authentication, Host/Origin changes and non-POST requests are denied', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    {},
    { Authorization: 'Bearer wrong' },
    { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' },
  ]) {
    const r = await fetch(f.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
    });
    assert.ok(
      [401, 403].includes(r.status),
      `Expected denial for ${Object.keys(headers).join(',')}; got ${r.status}`
    );
  }
  // Node fetch normalizes Host, so exercise the wire-level header using http.request.
  const badHost = await new Promise((resolve, reject) => {
    const r = request(
      f.url,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, Host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    r.on('error', reject);
    r.end();
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(f.url, { headers: { Authorization: `Bearer ${token}` } })).status, 405);
  assert.equal(f.calls(), 0);
});
test('unknown write tools, nested arguments and approval overrides cannot execute', async (t) => {
  const f = await fixture(t);
  const c = await f.client();
  for (const name of [
    'pbk_send_sms',
    'pbk_create_approval',
    'pbk_approve',
    'callMcpTool',
    'updateCRM',
  ]) {
    await assert.rejects(c.callTool({ name, arguments: { approvalId: 'approved' } }));
  }
  await assert.rejects(
    c.callTool({ name: 'pbk_health', arguments: { url: 'https://evil.example' } })
  );
  assert.equal(f.calls(), 0);
});
test('disabled endpoint and reused master key cannot activate', async (t) => {
  for (const patch of [
    { PBK_COMPOSIO_STAGING_ENABLED: 'false' },
    { PBK_COMPOSIO_INBOUND_ENABLED: 'false' },
    { PBK_COMPOSIO_INBOUND_TOKEN: '' },
    { PBK_BRIDGE_API_KEY: token },
  ]) {
    const f = await fixture(t, patch);
    assert.equal(f.endpoint.status().ready, false);
    assert.ok([404, 503].includes((await fetch(f.url, { method: 'POST' })).status));
  }
});
test('body limit applies before MCP parsing, with no backend reads', async (t) => {
  const f = await fixture(t);
  const r = await fetch(f.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ large: 'x'.repeat(66000) }),
  });
  assert.equal(r.status, 413);
  assert.equal(f.calls(), 0);
});
test('shared restricted factory also rejects extra arguments without relying on HTTP filtering', async () => {
  let calls = 0;
  const server = createPbkReadOnlyMcpServer({
    readStatus: async () => {
      calls++;
      return { ok: true };
    },
  });
  const c = new Client({ name: 'local-profile-fixture', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await c.connect(b);
    const result = await c.callTool({
      name: 'pbk_health',
      arguments: { url: 'https://evil.example' },
    });
    assert.equal(result.isError, true);
    assert.equal(calls, 0);
  } finally {
    await c.close();
    await server.close();
  }
});
test('optional omitted zero-input arguments work and policy audit records safe decisions', async (t) => {
  const f = await fixture(t);
  const c = await f.client();
  const result = await c.callTool({ name: 'pbk_health' });
  assert.ok(!result.isError);
  await assert.rejects(c.callTool({ name: 'send_email' }));
  const events = f.endpoint.audit();
  assert.ok(events.some((e) => e.decision === 'allowed'));
  assert.ok(events.some((e) => e.decision === 'denied'));
  assert.doesNotMatch(JSON.stringify(events), /synthetic|send_email/);
});
test('invalid credentials do not exhaust authenticated request capacity', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 65; i++) await fetch(f.url, { method: 'POST' });
  const c = await f.client();
  assert.ok(!(await c.callTool({ name: 'pbk_health', arguments: {} })).isError);
});
