import assert from 'node:assert/strict';
import test from 'node:test';
import * as publicMarket from './public-market-connection.mjs';

const { createPublicMarketConnectionCheck } = publicMarket;

const savedJob = {
  id: 'market-fictional-fixture',
  approvalTaskId: 'admin-e2b-market-fictional-fixture',
  provider: 'e2b',
  source: 'public-market-brief',
  market: 'Raleigh, NC',
  status: 'complete',
  consumed: true,
  cleanupConfirmed: true,
  completedAt: '2026-11-20T19:00:00.000Z',
};
const savedApproval = {
  id: savedJob.approvalTaskId,
  provider: 'e2b',
  action: 'public_market_brief',
  status: 'complete',
};

test('the saved Raleigh cleanup note does not change live readiness or enable execution', () => {
  const readiness = Object.freeze({ state: 'connected_unverified', executionEnabled: false, note: 'Read-only checks passed.' });
  const status = publicMarket.withSavedRaleighCleanup(readiness, [savedJob], [savedApproval]);
  assert.deepEqual(status, {
    ...readiness,
    note: 'Saved Raleigh canary: sandbox cleanup confirmed. Execution is disabled.',
  });
  assert.equal(readiness.note, 'Read-only checks passed.');
});

test('only a consumed Raleigh run with confirmed cleanup and a completed matching approval is shown', () => {
  const readiness = { state: 'connection_unverified', executionEnabled: false, note: 'Read-only checks unavailable.' };
  const active = { ...readiness, executionEnabled: true };
  assert.equal(publicMarket.withSavedRaleighCleanup(active, [savedJob], [savedApproval]), active);
  assert.equal(publicMarket.withSavedRaleighCleanup(readiness), readiness);
  for (const override of [
    { market: 'Tampa, FL' }, { status: 'interrupted' }, { provider: 'browseros' },
    { source: 'browseros' }, { consumed: false }, { cleanupConfirmed: 'true' },
    { completedAt: 'invalid' }, { approvalTaskId: 'different-task' },
  ]) {
    assert.equal(publicMarket.withSavedRaleighCleanup(readiness, [{ ...savedJob, ...override }], [savedApproval]), readiness);
  }
  for (const override of [{ provider: 'browseros' }, { action: 'unrelated' }, { status: 'pending' }]) {
    assert.equal(publicMarket.withSavedRaleighCleanup(readiness, [savedJob], [{ ...savedApproval, ...override }]), readiness);
  }
});

const schema = {
  "type": "object",
  "title": "AnswerRequest",
  "required": [
    "query"
  ],
  "properties": {
    "text": {
      "type": "boolean",
      "title": "Text",
      "default": false,
      "description": "Set to `true` to include the full text content of the cited source documents in the `citations` part of the response. Defaults to `false`."
    },
    "model": {
      "enum": [
        "exa",
        "exa-pro"
      ],
      "type": "string",
      "title": "Model",
      "default": "exa",
      "examples": [
        "exa",
        "exa-pro"
      ],
      "description": "Specifies the search model to use. 'exa' uses a single, direct query. 'exa-pro' uses two expanded queries for potentially more comprehensive results. Allowed values are 'exa' or 'exa-pro'. Defaults to 'exa'."
    },
    "query": {
      "type": "string",
      "title": "Query",
      "examples": [
        "What is the latest valuation of SpaceX?"
      ],
      "minLength": 1,
      "description": "The natural language question or search query for which an answer is sought. The query should be specific enough to guide the search effectively. Include concrete entities, dates, locations, or jurisdictions to avoid ambiguous results. For time-sensitive data, include explicit time framing (e.g., 'as of 2024') since results may reflect stale information."
    },
    "stream": {
      "type": "boolean",
      "title": "Stream",
      "default": false,
      "description": "Set to `true` to receive the response as a stream of server-sent events (SSE). This is useful for displaying results incrementally. Defaults to `false`."
    }
  },
  "description": "Request model for generating an answer based on a query."
};
const schemaHash = '216c1a2a2d9c9b653a3a308d5c815478be079ed11d8b20f6530b923ffe20ecaa';
const user = 'pbk-public-market-research-production';
const account = 'ca_production_exa_fixture';
const env = {
  PBK_E2B_MARKET_CONNECTION_CHECK_ENABLED: 'true',
  PBK_E2B_MARKET_WORKER_API_KEY: 'e2b-test-fixture',
  PBK_COMPOSIO_MARKET_SEARCH_API_KEY: 'composio-test-fixture',
  PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID: 'trs_production_fixture',
  PBK_COMPOSIO_MARKET_SEARCH_USER_ID: user,
  PBK_COMPOSIO_MARKET_SEARCH_EXA_ACCOUNT_ID: account,
  PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION: '1',
  PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: schemaHash,
};
const sessionUrl = 'https://backend.composio.dev/api/v3.1/tool_router/session/trs_production_fixture';
const toolUrl = 'https://backend.composio.dev/api/v3.1/tools/EXA_ANSWER';
const toolsUrl = sessionUrl + '/tools?limit=2';
const toolkitsUrl = sessionUrl + '/toolkits?limit=2';
const inventoryUrl = 'https://api.e2b.app/v2/sandboxes?limit=1';
const session = {
  session_id: 'trs_production_fixture',
  config_version: 1,
  mcp: { url: 'https://backend.composio.dev/tool_router/trs_production_fixture/mcp' },
  tool_router_tools: ['EXA_ANSWER'],
  config: {
    user_id: user,
    toolkits: { enabled: ['exa'] },
    tools: { exa: { enabled: ['EXA_ANSWER'] } },
    preload: { tools: ['EXA_ANSWER'] },
    connected_accounts: { exa: [account] },
    auth_configs: {},
    instant: false,
    manage_connections: { enabled: false, enable_wait_for_connections: false, enable_connection_removal: false },
    workbench: { enable: false },
    proxy_execute: { enable: false },
    search: { enable: false },
    multi_account: { enable: false },
    execute: { enable_multi_execute: false },
  },
};
const tool = {
  slug: 'EXA_ANSWER',
  toolkit: { slug: 'exa' },
  no_auth: false,
  is_deprecated: false,
  input_parameters: schema,
};
const scopedTool = { ...tool, toolkit: { slug: 'EXA' } };
const toolkit = { slug: 'exa', enabled: true, connected_account: { id: account, user_id: user, status: 'ACTIVE' } };
const page = (item) => ({ items: [item], total_items: 1, next_cursor: null });

function providerFixture(respond = (url) => {
  if (url === inventoryUrl) return Response.json([{ sandboxID: 'not-for-settings' }]);
  if (url === sessionUrl) return Response.json(session);
  if (url === toolUrl) return Response.json(tool);
  if (url === toolsUrl) return Response.json(page(scopedTool));
  if (url === toolkitsUrl) return Response.json(page(toolkit));
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
  for (const overrides of [
    { PBK_COMPOSIO_MARKET_SEARCH_EXA_ACCOUNT_ID: '' },
    { PBK_COMPOSIO_MARKET_SEARCH_USER_ID: 'pbk-public-market-research-staging' },
    { PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: '0'.repeat(64) },
  ]) assert.equal((await createPublicMarketConnectionCheck({ env: { ...env, ...overrides }, request })()).state, 'configuration_missing');
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
  assert.deepEqual(calls.map(({ url }) => url).sort(), [inventoryUrl, sessionUrl, toolUrl, toolsUrl, toolkitsUrl].sort());
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.equal(options.headers['x-api-key'], url === inventoryUrl
      ? env.PBK_E2B_MARKET_WORKER_API_KEY : env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY);
  }
  assert.doesNotMatch(JSON.stringify(status), /not-for-settings|test-fixture|trs_production/);
});

test('fails closed on revoked keys, Instant, account, scope or schema drift', async () => {
  for (const failure of ['credential', 'scope', 'schema', 'extra-tools', 'instant', 'wrong-account', 'inactive-account', 'account-owner', 'scoped-schema', 'cursor']) {
    const { request } = providerFixture((url) => {
      if (url === inventoryUrl) return failure === 'credential' ? new Response(null, { status: 401 }) : Response.json([]);
      if (url === sessionUrl) return Response.json(failure === 'scope' ? {
        ...session, config: { ...session.config, workbench: { enable: true } },
      } : failure === 'extra-tools' ? {
        ...session, tool_router_tools: ['EXA_ANSWER', 'COMPOSIO_EXECUTE_MULTI'],
      } : failure === 'instant' ? {
        ...session, config: { ...session.config, instant: {} },
      } : failure === 'wrong-account' ? {
        ...session, config: { ...session.config, connected_accounts: { exa: ['ca_wrong'] } },
      } : session);
      if (url === toolUrl) return Response.json(failure === 'schema' ? { ...tool, input_parameters: {} } : tool);
      if (url === toolsUrl) return Response.json(failure === 'cursor' ? { ...page(scopedTool), next_cursor: 'more' }
        : page(failure === 'scoped-schema' ? { ...scopedTool, input_parameters: {} } : scopedTool));
      if (url === toolkitsUrl) return Response.json(page({
        ...toolkit,
        connected_account: {
          ...toolkit.connected_account,
          status: failure === 'inactive-account' ? 'EXPIRED' : 'ACTIVE',
          user_id: failure === 'account-owner' ? 'another-user' : user,
        },
      }));
      throw new Error('Unexpected provider call');
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
    if (url === sessionUrl) return Response.json(session);
    if (url === toolUrl) return Response.json(tool);
    if (url === toolsUrl) return Response.json(page(scopedTool));
    if (url === toolkitsUrl) return Response.json(page(toolkit));
    throw new Error('Unexpected provider call');
  });
  const check = createPublicMarketConnectionCheck({ env, request, now: () => clock });
  assert.equal((await check()).connected, true);
  revoked = true;
  clock = 61000;
  assert.equal((await check()).connected, false);
});
