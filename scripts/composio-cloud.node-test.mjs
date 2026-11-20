import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComposioConnection,
  createComposioCloudConnection,
  routeComposioCloudRead,
  schemaFingerprint,
  verifyComposioSessionScope,
} from './lib/composio-connection.mjs';

const tool = 'E2B_LIST_SANDBOXES';
const schema = { type: 'object', properties: { limit: { type: 'integer' } } };
const env = (extra = {}) => ({
  PBK_COMPOSIO_E2B_ENABLED: 'true',
  PBK_COMPOSIO_E2B_API_KEY: 'synthetic-cloud-project-credential',
  PBK_COMPOSIO_E2B_MCP_URL: 'https://backend.composio.dev/tool_router/trs_cloud/mcp',
  PBK_COMPOSIO_E2B_AUTH_CONFIG_ID: 'cloud-auth',
  PBK_COMPOSIO_E2B_USER_ID: 'cloud-user',
  PBK_COMPOSIO_E2B_ACCOUNT_ID: 'cloud-account',
  PBK_COMPOSIO_E2B_SESSION_ID: 'trs_cloud',
  PBK_COMPOSIO_E2B_SESSION_CONFIG_VERSION: '1',
  PBK_COMPOSIO_E2B_SCHEMA_SHA256: schemaFingerprint(schema),
  ...extra,
});
function fixture(options = {}) {
  const calls = [];
  let connects = 0;
  const client = {
    listTools: async () => ({ tools: [{ name: tool, inputSchema: schema }] }),
    callTool: async (args) => {
      calls.push(args);
      return {
        structuredContent: {
          successful: true,
          data: { sandboxes: [{ sandboxID: 'PRIVATE', metadata: { secret: 'NEVER' } }] },
        },
      };
    },
    close: async () => {},
    ...options,
  };
  return {
    calls,
    client,
    count: () => connects,
    connect: async () => {
      connects++;
      return client;
    },
  };
}
const create = (f, options = {}) =>
  createComposioCloudConnection({
    env: env(),
    verifyScope: async () => true,
    connect: f.connect,
    ...options,
  });

test('cloud is independent, default off and status/configuration never performs I/O', async () => {
  const f = fixture();
  for (const config of [
    {},
    { PBK_COMPOSIO_STAGING_ENABLED: 'true' },
    env({ PBK_COMPOSIO_E2B_API_KEY: '' }),
  ]) {
    const c = create(f, { env: config });
    assert.equal(c.status().ready, false);
    assert.equal((await c.read({ operation: 'cloud-sandboxes', agentId: 'ava' })).ok, false);
  }
  create(f).status();
  assert.equal(f.count(), 0);
});

test('cloud sends only fixed bounded inputs, projects counts and expires evidence', async () => {
  let time = 1000;
  const f = fixture();
  const c = create(f, { now: () => time });
  const r = await c.read({ operation: 'cloud-sandboxes', agentId: 'rex' });
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls, [{ name: tool, arguments: { limit: 100 } }]);
  assert.deepEqual(r.inventory, { returnedCount: 1, hasMore: false, complete: true });
  assert.equal(c.status().ready, true);
  assert.doesNotMatch(
    JSON.stringify([r, c.status(), c.audit()]),
    /PRIVATE|NEVER|synthetic-cloud|cloud-account/
  );
  time += 120001;
  assert.equal(c.status().ready, false);
  await c.close();
});

test('pagination does not claim a total and malformed/oversized/provider-error results fail closed', async () => {
  for (const data of [{ sandboxes: [] }, { sandboxes: [], nextToken: 'PRIVATE-PAGE' }]) {
    const f = fixture({
      callTool: async () => ({ structuredContent: { successful: true, data } }),
    });
    const c = create(f);
    const r = await c.read({ operation: 'cloud-sandboxes', agentId: 'ava' });
    assert.equal(r.ok, true);
    assert.equal(r.inventory.hasMore, Boolean(data.nextToken));
    assert.equal(r.inventory.complete, !data.nextToken);
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE-PAGE/);
    await c.close();
  }
  for (const reply of [
    { successful: false, data: { sandboxes: [] } },
    { data: {} },
    { data: { sandboxes: Array(101).fill({}) } },
    { data: { sandboxes: [], nextToken: {} } },
  ]) {
    const c = create(fixture({ callTool: async () => ({ structuredContent: reply }) }));
    assert.equal((await c.read({ operation: 'cloud-sandboxes', agentId: 'ava' })).ok, false);
    await c.close();
  }
});

test('cloud denies unsupported agent/operation, schema drift and extra tools before execution', async () => {
  const f = fixture();
  const c = create(f);
  for (const request of [
    { operation: 'cloud-sandboxes', agentId: 'hermes' },
    { operation: 'create-sandbox', agentId: 'ava' },
    { operation: 'cloud-sandboxes', agentId: 'ava', arguments: {} },
  ])
    assert.equal((await c.read(request)).ok, false);
  assert.equal(f.count(), 0);
  for (const tools of [
    [{ name: tool, inputSchema: {} }],
    [
      { name: tool, inputSchema: schema },
      { name: 'E2B_CREATE_SANDBOX', inputSchema: schema },
    ],
  ]) {
    const f = fixture({ listTools: async () => ({ tools }) });
    assert.equal(
      (await create(f).read({ operation: 'cloud-sandboxes', agentId: 'ava' })).ok,
      false
    );
    assert.equal(f.calls.length, 0);
  }
});

test('explicit cloud routing is deterministic, disallows nested overrides and never consumes QA commands', async () => {
  const f = fixture();
  const c = create(f);
  assert.equal(
    await routeComposioCloudRead(c, { command: 'rex check the Composio QA contact' }),
    null
  );
  for (const params of [
    { command: 'ava check E2B sandboxes', context: { accountId: 'other' } },
    { cloudOperation: 'create', agentId: 'ava' },
    { command: 'hermes check E2B sandboxes', agentId: 'hermes' },
  ])
    assert.equal((await routeComposioCloudRead(c, params)).ok, false);
  assert.equal(f.calls.length, 0);
  const r = await routeComposioCloudRead(c, { command: 'rex check E2B sandboxes' });
  assert.equal(r.ok, true);
  assert.equal(r.routedTo, 'tool_first:composio_cloud_read');
  assert.match(r.response.answer, /not.*agent deployment/i);
  await c.close();
});

test('cloud runtime metadata rejects account/user/toolkit/session and extra policy drift', async () => {
  const original = globalThis.fetch;
  const config = {
    key: 'synthetic-project',
    authConfigId: 'auth',
    userId: 'user',
    accountId: 'account',
    sessionId: 'session',
    configVersion: 1,
    url: 'https://backend.composio.dev/tool_router/trs_cloud/mcp',
    profile: 'cloud-sandboxes',
  };
  const base = {
    account: {
      id: 'account',
      user_id: 'user',
      auth_config: { id: 'auth', is_disabled: false },
      status: 'ACTIVE',
      is_disabled: false,
      toolkit: { slug: 'e2b' },
    },
    session: {
      session_id: 'session',
      config_version: 1,
      mcp: { url: config.url },
      config: {
        user_id: 'user',
        connected_accounts: { e2b: ['account'] },
        toolkits: { enabled: ['e2b'] },
        tools: { e2b: { enabled: [tool] } },
        preload: { tools: [tool] },
      },
    },
  };
  try {
    for (const mutate of [
      null,
      (b) => (b.account.toolkit.slug = 'highlevel_location'),
      (b) => (b.account.user_id = 'other'),
      (b) => (b.account.auth_config.id = 'other'),
      (b) => b.session.config.connected_accounts.e2b.push('other'),
      (b) => b.session.config.toolkits.enabled.push('outlook'),
      (b) => b.session.config.tools.e2b.enabled.push('E2B_CREATE_SANDBOX'),
      (b) => (b.session.config_version = 2),
      (b) => (b.session.mcp.url = 'https://evil.example'),
    ]) {
      const b = structuredClone(base);
      mutate?.(b);
      globalThis.fetch = async (url) =>
        Response.json(String(url).includes('/connected_accounts/') ? b.account : b.session);
      assert.equal(
        await verifyComposioSessionScope(config, new AbortController().signal),
        mutate === null
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('a paginated tool manifest fails closed before cloud execution', async () => {
  const f = fixture({
    listTools: async () => ({
      tools: [{ name: tool, inputSchema: schema }],
      nextCursor: 'hidden-tool-page',
    }),
  });
  assert.equal((await create(f).read({ operation: 'cloud-sandboxes', agentId: 'ava' })).ok, false);
  assert.equal(f.calls.length, 0);
});

test('mixed QA/cloud configuration preserves independent pins, credentials, clients and evidence', async () => {
  const qaSchema = { type: 'object', properties: { contact_id: { type: 'string' } } };
  const mixed = {
    ...env(),
    PBK_COMPOSIO_STAGING_ENABLED: 'true',
    PBK_COMPOSIO_API_KEY: 'synthetic-qa-project',
    PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/tool_router/trs_qa/mcp',
    PBK_COMPOSIO_AUTH_CONFIG_ID: 'qa-auth',
    PBK_COMPOSIO_USER_ID: 'qa-user',
    PBK_COMPOSIO_ACCOUNT_ID: 'qa-account',
    PBK_COMPOSIO_SESSION_ID: 'trs_qa',
    PBK_COMPOSIO_SESSION_CONFIG_VERSION: '7',
    PBK_COMPOSIO_SANDBOX_LOCATION_ID: 'qa-location',
    PBK_COMPOSIO_QA_CONTACT_ID: 'qa-contact',
    PBK_COMPOSIO_CONTACT_SCHEMA_SHA256: schemaFingerprint(qaSchema),
  };
  const seen = [];
  const cloudFixture = fixture();
  const cloud = createComposioCloudConnection({
    env: mixed,
    verifyScope: async (config) => {
      seen.push(config);
      return true;
    },
    connect: cloudFixture.connect,
  });
  const qa = createComposioConnection({
    env: mixed,
    verifyScope: async (config) => {
      seen.push(config);
      return true;
    },
    connect: async () => ({
      listTools: async () => ({
        tools: [{ name: 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT', inputSchema: qaSchema }],
      }),
      callTool: async () => ({
        structuredContent: {
          contact: {
            id: 'qa-contact',
            locationId: 'qa-location',
            dnd: true,
            tags: ['pbk-qa-no-outreach'],
          },
        },
      }),
      close: async () => {},
    }),
  });
  assert.equal((await cloud.read({ operation: 'cloud-sandboxes', agentId: 'ava' })).ok, true);
  assert.equal(qa.status().ready, false);
  assert.equal((await qa.read({ operation: 'qa-contact', agentId: 'rex' })).ok, true);
  for (const [id, prefix] of [
    ['cloud-sandboxes', 'PBK_COMPOSIO_E2B_'],
    ['qa-contact', 'PBK_COMPOSIO_'],
  ]) {
    const config = seen.find((c) => c.profile === id);
    assert.equal(config.key, mixed[prefix + 'API_KEY']);
    assert.equal(config.accountId, mixed[prefix + 'ACCOUNT_ID']);
    assert.equal(config.sessionId, mixed[prefix + 'SESSION_ID']);
    assert.equal(config.authConfigId, mixed[prefix + 'AUTH_CONFIG_ID']);
    assert.equal(
      config.schemaHash,
      mixed[prefix + (id === 'qa-contact' ? 'CONTACT_SCHEMA_SHA256' : 'SCHEMA_SHA256')]
    );
  }
  const missingCloudKey = createComposioCloudConnection({
    env: { ...mixed, PBK_COMPOSIO_E2B_API_KEY: '' },
    connect: async () => assert.fail('must not inherit QA credential'),
  });
  assert.equal(
    (await missingCloudKey.read({ operation: 'cloud-sandboxes', agentId: 'ava' })).result,
    'configuration_missing'
  );
  await cloud.close();
  assert.equal(qa.status().ready, true);
  await qa.close();
});
