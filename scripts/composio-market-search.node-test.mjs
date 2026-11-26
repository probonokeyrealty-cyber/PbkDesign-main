import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComposioMarketSearch,
  verifyMarketSearchSession,
} from './lib/composio-market-search.mjs';
import { schemaFingerprint } from './lib/public-market-mcp.mjs';
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
const restSchema = {
  type: 'object',
  title: 'SearchRequest',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      title: 'Query',
      examples: ['Coffee'],
      description:
        "The search query for the Composio Exa API. Must be non-empty; using any other parameter name (e.g., 'q') causes an invalid-request error. Include qualifiers (year, region, platform, intent) for better results \u2014 broad queries return generic content; excessive site: or quoted-term filters can return zero results. Add disambiguating terms (city, role, domain) when searching for people or organizations with common names.",
    },
  },
};
function restFallback({
  listCode = -32601,
  changeSession,
  changeCatalog,
  execute = () =>
    Response.json({
      result_type: 'completed',
      error: null,
      data: { answer: 'Public market summary.', citations: [{ url: 'https://example.org/report' }] },
    }),
} = {}) {
  const session = { ...structuredClone(metadata), tool_router_tools: [tool] };
  const catalog = {
    slug: tool,
    toolkit: { slug: 'composio_search' },
    no_auth: true,
    input_parameters: structuredClone(restSchema),
  };
  changeSession?.(session);
  changeCatalog?.(catalog);
  const calls = [];
  let closed = 0;
  const adapter = createComposioMarketSearch({
    env,
    connect: async () => ({
      listTools: async () => { throw Object.assign(Error('RPC failed'), { code: listCode }); },
      callTool: async () => { calls.push(['MCP execution']); },
      close: async () => { closed++; },
    }),
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, 'https://backend.composio.dev');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers['x-api-key'], env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY);
      const path = new URL(url).pathname;
      calls.push([init.method, path, init.body ? JSON.parse(init.body) : null]);
      if (path === '/api/v3.1/tool_router/session/trs_market') return Response.json(session);
      if (path === '/api/v3.1/tools/COMPOSIO_SEARCH_WEB') return Response.json(catalog);
      if (path === '/api/v3.1/tool_router/session/trs_market/execute') return execute();
      assert.fail('Unexpected provider endpoint');
    },
  });
  return { adapter, calls, closes: () => closed };
}
test('missing MCP list supports one exact session execution with the independently pinned catalog schema', async () => {
  const { adapter, calls, closes } = restFallback();
  const r = await adapter.search('Market query');
  assert.equal(r.ok, true);
  assert.deepEqual(r.citations, ['https://example.org/report']);
  assert.deepEqual(calls, [
    ['GET', '/api/v3.1/tool_router/session/trs_market', null],
    ['GET', '/api/v3.1/tools/COMPOSIO_SEARCH_WEB', null],
    ['POST', '/api/v3.1/tool_router/session/trs_market/execute', {
      tool_slug: tool, arguments: { query: 'Market query' },
    }],
  ]);
  assert.equal(closes(), 1);
});
test('REST fallback denies unpinned catalog, extra tools/accounts and unrelated list failures', async () => {
  for (const options of [
    { listCode: -32000 },
    { changeSession: (m) => m.tool_router_tools.push('OTHER') },
    { changeSession: (m) => delete m.tool_router_tools },
    { changeSession: (m) => (m.config.tools.extra = { enabled: ['OTHER'] }) },
    { changeSession: (m) => (m.config.connected_accounts.e2b = ['other']) },
    { changeCatalog: (m) => (m.input_parameters = schema) },
    { changeCatalog: (m) => (m.no_auth = false) },
    { changeCatalog: (m) => (m.toolkit.slug = 'other') },
    { changeCatalog: (m) => (m.slug = 'OTHER') },
  ]) {
    const { adapter, calls } = restFallback(options);
    assert.equal((await adapter.search('Market query')).ok, false);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(([method]) => method === 'GET'));
  }
});
test('REST execution is not retried after HTTP failure, rejection, or incomplete results', async () => {
  for (const execute of [
    () => new Response(null, { status: 502 }),
    () => { throw Error('connection lost'); },
    () => Response.json({ result_type: 'input_required', data: { citations: [] } }),
    () => Response.json({ result_type: 'completed', error: 'failed', data: { citations: [] } }),
  ]) {
    const { adapter, calls } = restFallback({ execute });
    assert.equal((await adapter.search('Market query')).ok, false);
    assert.equal(calls.filter(([method]) => method === 'POST').length, 1);
    assert.equal(calls.some(([method]) => method === 'MCP execution'), false);
  }
});
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

const exaTool = 'EXA_ANSWER';
const exaUser = 'pbk-public-market-research-staging';
const exaAccount = 'ca_staging_exa';
const exaSchema = {
  "type": "object",
  "properties": {
    "text": {
      "type": "boolean",
      "description": "Set to `true` to include the full text content of the cited source documents in the `citations` part of the response. Defaults to `false`.",
      "default": false
    },
    "model": {
      "type": "string",
      "enum": [
        "exa",
        "exa-pro"
      ],
      "description": "Specifies the search model to use. 'exa' uses a single, direct query. 'exa-pro' uses two expanded queries for potentially more comprehensive results. Allowed values are 'exa' or 'exa-pro'. Defaults to 'exa'.\nExamples:\n  \"exa\"\n  \"exa-pro\"",
      "default": "exa"
    },
    "query": {
      "type": "string",
      "minLength": 1,
      "description": "The natural language question or search query for which an answer is sought. The query should be specific enough to guide the search effectively. Include concrete entities, dates, locations, or jurisdictions to avoid ambiguous results. For time-sensitive data, include explicit time framing (e.g., 'as of 2024') since results may reflect stale information.\nExample: \"What is the latest valuation of SpaceX?\""
    },
    "stream": {
      "type": "boolean",
      "description": "Set to `true` to receive the response as a stream of server-sent events (SSE). This is useful for displaying results incrementally. Defaults to `false`.",
      "default": false
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
};
const exaEnv = {
  ...env,
  PBK_COMPOSIO_MARKET_SEARCH_USER_ID: exaUser,
  PBK_COMPOSIO_MARKET_SEARCH_EXA_ACCOUNT_ID: exaAccount,
  PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: schemaFingerprint(exaSchema),
};
const exaSession = {
  ...metadata,
  tool_router_tools: [exaTool],
  config: {
    ...metadata.config,
    user_id: exaUser,
    toolkits: { enabled: ['exa'] },
    tools: { exa: { enabled: [exaTool] } },
    preload: { tools: [exaTool] },
    connected_accounts: { exa: [exaAccount] },
    manage_connections: {
      enabled: false,
      enable_wait_for_connections: false,
      enable_connection_removal: false,
    },
  },
};
function exaFixture(options = {}) {
  const session = structuredClone(exaSession);
  options.changeSession?.(session);
  const calls = [];
  const gets = [];
  const adapter = createComposioMarketSearch({
    env: { ...exaEnv, ...options.env },
    fetchImpl: async (url, init) => {
      gets.push([init.method, new URL(url).pathname]);
      return Response.json(session);
    },
    connect: async () => ({
      listTools: async () => {
        if (options.missingList) throw Object.assign(Error('No listing'), { code: -32601 });
        return options.manifest ?? { tools: [{ name: exaTool, inputSchema: exaSchema }] };
      },
      callTool: async (args) => {
        calls.push(args);
        return {
          structuredContent: {
            successful: true,
            data: { answer: 'Raleigh public market summary.', citations: [{ url: 'https://example.org/source' }] },
          },
        };
      },
      close: async () => {},
    }),
  });
  return { adapter, calls, gets };
}
test('staging Exa invokes one pinned action with the dedicated account and bounded defaults', async () => {
  const { adapter, calls, gets } = exaFixture();
  const result = await adapter.search('Public Raleigh market query');
  assert.equal(result.ok, true);
  assert.deepEqual(result.citations, ['https://example.org/source']);
  assert.deepEqual(gets, [['GET', '/api/v3.1/tool_router/session/trs_market']]);
  assert.deepEqual(calls, [{
    name: exaTool,
    arguments: { query: 'Public Raleigh market query', model: 'exa', stream: false, text: false },
  }]);
});
test('staging Exa fails closed for account, Instant, tool, or schema drift and never falls back', async () => {
  for (const options of [
    { env: { PBK_COMPOSIO_MARKET_SEARCH_EXA_ACCOUNT_ID: '' } },
    { env: { PBK_COMPOSIO_MARKET_SEARCH_USER_ID: 'other-user' } },
    { env: { PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: schemaFingerprint(schema) } },
    { changeSession: (s) => (s.config.connected_accounts = {}) },
    { changeSession: (s) => s.config.connected_accounts.exa.push('ca_other') },
    { changeSession: (s) => (s.config.connected_accounts.exa = ['ca_other']) },
    { changeSession: (s) => (s.config.instant = {}) },
    { changeSession: (s) => (s.config.manage_connections.enable_connection_removal = true) },
    { changeSession: (s) => s.tool_router_tools.push('EXA_CREATE_API_KEY') },
    { changeSession: (s) => (s.config.auth_configs.exa = 'ac_other') },
    { manifest: { tools: [{ name: exaTool, inputSchema: schema }] } },
    { manifest: { tools: [{ name: tool, inputSchema: exaSchema }] } },
    { missingList: true },
  ]) {
    const { adapter, calls, gets } = exaFixture(options);
    assert.equal((await adapter.search('Public Raleigh market query')).ok, false);
    assert.deepEqual(calls, []);
    assert.ok(gets.every(([method]) => method === 'GET'));
  }
});
