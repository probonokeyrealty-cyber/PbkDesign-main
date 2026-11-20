import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComposioMarketSearch,
  verifyMarketSearchSession,
} from './lib/composio-market-search.mjs';
import { schemaFingerprint } from './lib/composio-connection.mjs';
const tool = 'COMPOSIO_SEARCH_WEB',
  schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
const env = {
  PBK_COMPOSIO_MARKET_SEARCH_ENABLED: 'true',
  PBK_COMPOSIO_MARKET_SEARCH_API_KEY: 'synthetic-search-project',
  PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID: 'trs_market',
  PBK_COMPOSIO_MARKET_SEARCH_USER_ID: 'public-user',
  PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION: '1',
  PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: schemaFingerprint(schema),
};
const metadata = {
  session_id: 'trs_market',
  config_version: 1,
  mcp: { url: 'https://backend.composio.dev/tool_router/trs_market/mcp' },
  config: {
    user_id: 'public-user',
    toolkits: { enabled: ['composio_search'] },
    tools: { composio_search: { enabled: [tool] } },
    preload: { tools: [tool] },
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
test('market search is default-off and status never connects', async () => {
  let calls = 0;
  const search = createComposioMarketSearch({
    env: {},
    connect: async () => {
      calls++;
    },
  });
  assert.equal(search.status().enabled, false);
  assert.equal((await search.search('Public market query')).ok, false);
  assert.equal(calls, 0);
});
test('search executes only its pinned tool, exposes bounded public answer/links and closes', async () => {
  const calls = [];
  let closed = 0;
  const client = {
    listTools: async () => ({ tools: [{ name: tool, inputSchema: schema }] }),
    callTool: async (args) => {
      calls.push(args);
      return {
        structuredContent: {
          successful: true,
          data: {
            answer: 'Public market summary.',
            citations: [
              {
                url: 'https://example.org/report',
                title: 'Public report',
                author: 'PRIVATE discarded',
              },
            ],
          },
        },
      };
    },
    close: async () => {
      closed++;
    },
  };
  const search = createComposioMarketSearch({
    env,
    verify: async () => true,
    connect: async () => client,
  });
  const r = await search.search('Public market query');
  assert.equal(r.ok, true);
  assert.equal(r.live, true);
  assert.deepEqual(r.citations, ['https://example.org/report']);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|synthetic/);
  assert.deepEqual(calls, [{ name: tool, arguments: { query: 'Public market query' } }]);
  assert.equal(closed, 1);
});
test('unexpected tools, cursor/schema drift and invalid scope prevent execution', async () => {
  for (const listing of [
    { tools: [{ name: tool, inputSchema: {} }] },
    { tools: [{ name: tool, inputSchema: schema }], nextCursor: 'more' },
    { tools: [{ name: tool, inputSchema: schema }, { name: 'COMPOSIO_MULTI_EXECUTE_TOOL' }] },
  ]) {
    let calls = 0;
    const search = createComposioMarketSearch({
      env,
      verify: async () => true,
      connect: async () => ({
        listTools: async () => listing,
        callTool: async () => {
          calls++;
        },
        close: async () => {},
      }),
    });
    assert.equal((await search.search('Market query')).ok, false);
    assert.equal(calls, 0);
  }
});
test('no-auth session must pin only public search, with every generic execution surface disabled', () => {
  const config = {
    sessionId: 'trs_market',
    version: 1,
    userId: 'public-user',
    url: metadata.mcp.url,
  };
  for (const mutate of [
    null,
    (m) => m.config.toolkits.enabled.push('e2b'),
    (m) => (m.config.connected_accounts.e2b = ['other']),
    (m) => (m.config.workbench.enable = true),
    (m) => (m.config.instant = {}),
    (m) => (m.config_version = 2),
    (m) => m.config.tools.composio_search.enabled.push('OTHER'),
    (m) => (m.config.manage_connections.enabled = true),
  ]) {
    const m = structuredClone(metadata);
    mutate?.(m);
    assert.equal(verifyMarketSearchSession(config, m), mutate === null);
  }
});
