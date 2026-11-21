import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPublicMarketConnectionCheck } from './public-market-connection.mjs';

const schema = { properties: { query: { type: 'string' } }, required: ['query'], type: 'object' };
const env = {
  PBK_E2B_MARKET_CONNECTION_CHECK_ENABLED: 'true',
  PBK_E2B_MARKET_WORKER_API_KEY: 'e2b-test-fixture',
  PBK_COMPOSIO_MARKET_SEARCH_API_KEY: 'composio-test-fixture',
  PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID: 'trs_production_fixture',
  PBK_COMPOSIO_MARKET_SEARCH_USER_ID: 'pbk-production-public-market',
  PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION: '1',
  PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: createHash('sha256').update(JSON.stringify(schema)).digest('hex'),
};
const sessionUrl = 'https://backend.composio.dev/api/v3.1/tool_router/session/trs_production_fixture';
const inventoryUrl = 'https://api.e2b.app/v2/sandboxes?limit=1';
const session = {
  session_id: 'trs_production_fixture',
  config_version: 1,
  mcp: { url: 'https://backend.composio.dev/tool_router/trs_production_fixture/mcp' },
  config: {
    user_id: 'pbk-production-public-market',
    toolkits: { enabled: ['composio_search'] },
    tools: { composio_search: { enabled: ['COMPOSIO_SEARCH_WEB'] } },
    preload: { tools: ['COMPOSIO_SEARCH_WEB'] },
    connected_accounts: {},
    auth_configs: {},
    instant: false,
    manage_connections: { enabled: false },
    workbench: { enable: false },
    proxy_execute: { enable: false },
    search: { enable: false },
    multi_account: { enable: false },
    execute: { enable_multi_execute: false },
  },
};
const listing = {
  items: [{
    slug: 'COMPOSIO_SEARCH_WEB',
    toolkit: { slug: 'composio_search' },
    no_auth: true,
    input_parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  }],
  next_cursor: null,
  total_items: 1,
};

function providerFixture(respond = (url) => {
  if (url === inventoryUrl) return Response.json([{ sandboxID: 'not-for-settings' }]);
  if (url === sessionUrl) return Response.json(session);
  if (url === `${sessionUrl}/tools?limit=2`) return Response.json(listing);
  throw new Error('Unexpected provider call');
}) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      return respond(url);
    },
  };
}

test('disabled and incomplete configurations make no requests', async () => {
  const { calls, request } = providerFixture();
  assert.equal((await createPublicMarketConnectionCheck({ env: {}, request })()).state, 'disabled');
  const incomplete = { ...env, PBK_E2B_MARKET_WORKER_API_KEY: '' };
  assert.equal((await createPublicMarketConnectionCheck({ env: incomplete, request })()).state, 'configuration_missing');
  assert.equal((await createPublicMarketConnectionCheck({ env: { ...env, PBK_BRIDGE_API_KEY: env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY }, request })()).state, 'configuration_missing');
  assert.deepEqual(calls, []);
});

test('only reads provider metadata, coalesces refreshes, and never claims execution readiness', async () => {
  const { calls, request } = providerFixture();
  const check = createPublicMarketConnectionCheck({ env, request });
  assert.deepEqual(calls, []);
  const [status, concurrent] = await Promise.all([check(), check()]);
  assert.deepEqual(concurrent, status);
  assert.deepEqual(await check(), status);
  assert.equal(status.state, 'connected_unverified');
  assert.equal(status.connected, true);
  assert.equal(status.ready, false);
  assert.equal(status.executionEnabled, false);
  assert.equal(status.lastSuccessAt, null);
  assert.deepEqual(calls.map(({ url }) => url).sort(), [inventoryUrl, sessionUrl, `${sessionUrl}/tools?limit=2`].sort());
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['x-api-key'], url === inventoryUrl
      ? env.PBK_E2B_MARKET_WORKER_API_KEY : env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY);
  }
  assert.doesNotMatch(JSON.stringify(status), /not-for-settings|test-fixture|trs_production/);
});

test('fails closed on revoked keys, scope drift, or schema drift', async () => {
  for (const failure of ['credential', 'scope', 'schema', 'extra-tools']) {
    const { request } = providerFixture((url) => {
      if (url === inventoryUrl) return failure === 'credential' ? new Response(null, { status: 401 }) : Response.json([]);
      if (url === sessionUrl) return Response.json(failure === 'scope' ? {
        ...session, config: { ...session.config, workbench: { enable: true } },
      } : session);
      return Response.json(failure === 'schema' ? {
        ...listing, items: [{ ...listing.items[0], input_parameters: {} }],
      } : failure === 'extra-tools' ? { ...listing, next_cursor: 'extra' } : listing);
    });
    const result = await createPublicMarketConnectionCheck({ env, request })();
    assert.equal(result.state, 'connection_unverified', failure);
    assert.equal(result.connected, false, failure);
  }
});

test('expires older connection proof instead of masking a later failure', async () => {
  let clock = 0;
  let revoked = false;
  const { request } = providerFixture((url) => {
    if (url === inventoryUrl) return new Response(null, { status: revoked ? 401 : 200 });
    return Response.json(url === sessionUrl ? session : listing);
  });
  const check = createPublicMarketConnectionCheck({ env, request, now: () => clock });
  assert.equal((await check()).connected, true);
  revoked = true;
  clock = 61000;
  assert.equal((await check()).connected, false);
});
