import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('./attom-mcp-client.mjs');
const env = { ATTOM_MCP_CLIENT_ID: 'fixture-client', ATTOM_MCP_CLIENT_SECRET: 'fixture-secret' };
function harness({ tokenStatus = 200, toolStatus = 200, tokenBody, toolResult, expiresIn = 120, sse = false } = {}) {
  const calls = [];
  let time = 1_000_000;
  const request = async (url, init = {}) => {
    const target = String(url), headers = new Headers(init.headers);
    const body = init.body ? String(init.body) : '';
    calls.push({ target, method: init.method, headers, body, redirect: init.redirect, signal: init.signal });
    assert.equal(new URL(target).origin, 'https://mcp.intelligence.attomdata.com');
    if (target.endsWith('/token')) return Response.json(tokenBody ?? { access_token: 'fixture-access', token_type: 'Bearer', expires_in: expiresIn }, { status: tokenStatus });
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(body);
    if (!('id' in message)) return new Response(null, { status: 202 });
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    else {
      assert.equal(headers.get('mcp-session-id'), 'fixture-session');
      if (toolStatus !== 200) return Response.json({ error: 'fixture-secret fixture-access' }, { status: toolStatus });
      result = message.method === 'tools/list' ? { tools: [{ name: 'get_property_data', inputSchema: { type: 'object' } }] } : toolResult ?? { content: [], structuredContent: { fixture: true } };
    }
    const envelope = { jsonrpc: '2.0', id: message.id, result };
    return sse && message.method === 'tools/call'
      ? new Response(`data: ${JSON.stringify(envelope)}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
      : Response.json(envelope, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
  };
  return { request, calls, now: () => time, advance: n => { time += n; }, methods: () => calls.filter(c => c.target.endsWith('/') && c.body).map(c => JSON.parse(c.body).method) };
}

test('creation is lazy; missing credentials cannot perform network I/O', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env: {}, request: h.request });
  assert.equal(h.calls.length, 0);
  await assert.rejects(client.listTools(), { code: 'attom_mcp_not_configured' });
  assert.equal(h.calls.length, 0);
});

test('metadata discovery reuses initialized session and concurrent token exchange', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env, request: h.request, now: h.now });
  const results = await Promise.all([client.listTools(), client.listTools()]);
  assert.equal(results[0].tools[0].name, 'get_property_data');
  assert.equal(h.calls.filter(c => c.target.endsWith('/token')).length, 1);
  assert.equal(h.methods().filter(m => m === 'initialize').length, 1);
  const exchange = h.calls.find(c => c.target.endsWith('/token'));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(exchange.body)), { grant_type: 'client_credentials', client_id: 'fixture-client', client_secret: 'fixture-secret' });
  assert.ok(h.calls.every(c => c.redirect === 'error' && c.signal instanceof AbortSignal));
  await client.close();
});

test('only fixed property tool is callable; supplied object is forwarded without invented fields', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env, request: h.request, now: h.now });
  const args = { verifiedSchemaFixture: 'one-property' };
  assert.deepEqual((await client.getPropertyData(args)).structuredContent, { fixture: true });
  const message = h.calls.map(c => { try { return JSON.parse(c.body); } catch { return null; } }).find(m => m?.method === 'tools/call');
  assert.deepEqual(message.params, { name: 'get_property_data', arguments: args });
  assert.equal(client.callTool, undefined);
  await client.close();
});

test('expired tokens refresh once before concurrent reads without replaying data calls', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env, request: h.request, now: h.now });
  await client.listTools();
  h.advance(100_000);
  await Promise.all([client.getPropertyData({ a: 1 }), client.getPropertyData({ a: 2 })]);
  assert.equal(h.calls.filter(c => c.target.endsWith('/token')).length, 2);
  assert.equal(h.methods().filter(m => m === 'tools/call').length, 2);
  await client.close();
});

test('authorization errors are redacted and never retried', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness({ toolStatus: 401 }), client = createAttomMcpClient({ env, request: h.request });
  await assert.rejects(client.getPropertyData({}), error => error.code === 'attom_mcp_authorization_failed' && !/fixture|Bearer/.test(String(error)));
  assert.equal(h.methods().filter(m => m === 'tools/call').length, 1);
  await client.close();
});

test('invalid token response and tool errors do not expose upstream content', async () => {
  const { createAttomMcpClient } = await load();
  for (const tokenBody of [{ access_token: 'fixture-access' }, { access_token: 'fixture-access', expires_in: -1 }, { access_token: 'fixture-access', expires_in: 120, token_type: 'Basic' }]) {
    const h = harness({ tokenBody }), client = createAttomMcpClient({ env, request: h.request });
    await assert.rejects(client.listTools(), { code: 'attom_mcp_authorization_failed' });
    assert.equal(h.methods().length, 0);
  }
  const h = harness({ toolResult: { isError: true, content: [{ type: 'text', text: 'fixture-secret' }] } });
  const client = createAttomMcpClient({ env, request: h.request });
  await assert.rejects(client.getPropertyData({}), error => error.code === 'attom_mcp_tool_failed' && !String(error).includes('fixture'));
  await client.close();
});

test('invalid or unbounded arguments are rejected before any network access', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env, request: h.request });
  for (const args of [null, [], 'text', { large: 'x'.repeat(70_000) }]) await assert.rejects(client.getPropertyData(args), { code: 'attom_mcp_invalid_arguments' });
  assert.equal(h.calls.length, 0);
});

test('closed clients cannot obtain credentials or make a request', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness(), client = createAttomMcpClient({ env, request: h.request });
  await client.close();
  await assert.rejects(client.listTools(), { code: 'attom_mcp_closed' });
  assert.equal(h.calls.length, 0);
});

test('rate limiting and session loss never retry a property call', async () => {
  const { createAttomMcpClient } = await load();
  for (const toolStatus of [429, 404, 500]) {
    const h = harness({ toolStatus }), client = createAttomMcpClient({ env, request: h.request });
    await assert.rejects(client.getPropertyData({}), error => error.code === (toolStatus === 429 ? 'attom_mcp_rate_limited' : 'attom_mcp_unavailable'));
    assert.equal(h.methods().filter(m => m === 'tools/call').length, 1);
    await client.close();
  }
});

test('token I/O timeout is bounded and redacted', async () => {
  const { createAttomMcpClient } = await load();
  const client = createAttomMcpClient({ env, timeoutMs: 1000, request: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('fixture-secret timeout')), { once: true });
  }) });
  // Keep one referenced test timer: AbortSignal.timeout intentionally uses an
  // unreferenced timer in Node, while native network sockets normally keep I/O alive.
  const guard = setTimeout(() => {}, 2500);
  try { await assert.rejects(client.listTools(), { code: 'attom_mcp_timed_out' }); }
  finally { clearTimeout(guard); await client.close(); }
});

test('oversized MCP JSON cannot enter the property evidence pipeline', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness({ toolResult: { content: [{ type: 'text', text: 'x'.repeat(2_100_000) }] } });
  const client = createAttomMcpClient({ env, request: h.request });
  await assert.rejects(client.getPropertyData({}), { code: 'attom_mcp_response_too_large' });
  assert.equal(h.methods().filter(m => m === 'tools/call').length, 1);
  await client.close();
});

test('MCP SSE results pass through the bounded protocol stream', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness({ sse: true }), client = createAttomMcpClient({ env, request: h.request });
  assert.deepEqual((await client.getPropertyData({})).structuredContent, { fixture: true });
  await client.close();
});

test('default deadline allows full records and configured deadlines cap at sixty seconds', async () => {
  const { createAttomMcpClient } = await load();
  const originalTimeout = AbortSignal.timeout;
  const durations = [];
  AbortSignal.timeout = milliseconds => {
    durations.push(milliseconds);
    return originalTimeout(milliseconds);
  };
  try {
    for (const [options, expected] of [[{}, 30_000], [{ timeoutMs: 45_000 }, 45_000], [{ timeoutMs: 90_000 }, 60_000], [{ timeoutMs: NaN }, 30_000]]) {
      durations.length = 0;
      const h = harness(), client = createAttomMcpClient({ env, request: h.request, ...options });
      await client.getPropertyData({});
      assert.ok(durations.length > 0);
      assert.ok(durations.every(value => value === expected), `Expected every network deadline to be ${expected}ms; got ${durations}`);
      assert.equal(h.methods().filter(method => method === 'tools/call').length, 1);
      await client.close();
    }
  } finally { AbortSignal.timeout = originalTimeout; }
});

test('closing during a pending token exchange forbids all delayed authenticated requests', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness();
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { started = resolve; });
  let tokenSignal;
  const client = createAttomMcpClient({ env, request: async (url, init) => {
    if (String(url).endsWith('/token')) { tokenSignal = init.signal; started(); await gate; }
    return h.request(url, init);
  } });
  const pending = client.listTools();
  const rejection = assert.rejects(pending, { code: 'attom_mcp_closed' });
  await seen;
  await client.close();
  const countAtClose = h.calls.length;
  release();
  await rejection;
  assert.equal(tokenSignal.aborted, true);
  assert.equal(h.calls.length, countAtClose + 1); // Only the already-started token response completes.
  assert.equal(h.methods().length, 0);
});

test('one failed read cannot close a different pending read session', async () => {
  const { createAttomMcpClient } = await load();
  const h = harness();
  const client = createAttomMcpClient({ env, request: async (url, init) => {
    let message;
    try { message = JSON.parse(init.body); } catch { /* token request */ }
    if (message?.method === 'tools/call') {
      if (message.params.arguments.fail) return Response.json({}, { status: 429 });
      await new Promise(resolve => setImmediate(resolve));
    }
    return h.request(url, init);
  } });
  const [failed, successful] = await Promise.allSettled([client.getPropertyData({ fail: true }), client.getPropertyData({ keep: true })]);
  assert.equal(failed.status, 'rejected');
  assert.equal(failed.reason.code, 'attom_mcp_rate_limited');
  assert.equal(successful.status, 'fulfilled');
  assert.deepEqual(successful.value.structuredContent, { fixture: true });
  await client.close();
});
