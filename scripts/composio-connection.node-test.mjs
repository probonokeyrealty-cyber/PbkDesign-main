import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComposioConnection as createConnection,
  schemaFingerprint,
  routeComposioAgentRead,
} from './lib/composio-connection.mjs';
const createComposioConnection = (options) =>
  createConnection({ verifyScope: async () => true, ...options });

const schema = {
  type: 'object',
  properties: { contact_id: { type: 'string' } },
  required: ['contact_id'],
};
const secret = 'synthetic-fixture-credential';
function config(extra = {}) {
  return {
    PBK_COMPOSIO_STAGING_ENABLED: 'true',
    PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/api/v3/mcp/fixture',
    PBK_COMPOSIO_API_KEY: secret,
    PBK_COMPOSIO_AUTH_CONFIG_ID: 'fixture-auth-config',
    PBK_COMPOSIO_USER_ID: 'fixture-user',
    PBK_COMPOSIO_ACCOUNT_ID: 'fixture-account',
    PBK_COMPOSIO_SESSION_ID: 'fixture-session',
    PBK_COMPOSIO_SESSION_CONFIG_VERSION: '1',
    PBK_COMPOSIO_SANDBOX_LOCATION_ID: 'fixture-location',
    PBK_COMPOSIO_QA_CONTACT_ID: 'fixture-contact',
    PBK_COMPOSIO_CONTACT_SCHEMA_SHA256: schemaFingerprint(schema),
    ...extra,
  };
}
function fixture(extra = {}) {
  const calls = [];
  let connections = 0;
  const client = {
    listTools: async () => ({
      tools: [{ name: 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT', inputSchema: schema }],
    }),
    callTool: async (input) => {
      calls.push(input);
      return {
        structuredContent: {
          data: {
            contact: {
              id: 'fixture-contact',
              locationId: 'fixture-location',
              dnd: true,
              tags: ['pbk-qa-no-outreach'],
              firstName: 'PRIVATE FIELD MUST NOT LEAK',
              email: 'private@example.invalid',
            },
          },
        },
      };
    },
    close: async () => {},
    ...extra,
  };
  return {
    calls,
    client,
    connect: async () => {
      connections++;
      return client;
    },
    count: () => connections,
  };
}
test('default disabled performs no connection and contains no secrets', async () => {
  const f = fixture();
  const c = createComposioConnection({ env: {}, connect: f.connect });
  assert.equal(c.status().state, 'disabled');
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
  assert.equal(f.count(), 0);
});
test('configuration alone is not connected, concurrent reads initialize once and project safe QA evidence only', async () => {
  const f = fixture();
  const c = createComposioConnection({ env: config(), connect: f.connect });
  assert.equal(c.status().ready, false);
  const reads = await Promise.all([
    c.read({ operation: 'qa-contact', agentId: 'ava' }),
    c.read({ operation: 'qa-contact', agentId: 'rex' }),
  ]);
  assert.equal(f.count(), 1);
  assert.ok(reads.every((r) => r.ok && r.contact.dnd && r.contact.qaExcluded));
  assert.deepEqual(f.calls[0], {
    name: 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT',
    arguments: { contact_id: 'fixture-contact' },
  });
  assert.equal(c.status().ready, true);
  assert.doesNotMatch(
    JSON.stringify([reads, c.status()]),
    /PRIVATE|private@example|synthetic-fixture|backend.composio/
  );
  await c.close();
  assert.equal(c.status().ready, false);
});
test('caller cannot override bound inputs, execute arbitrary tools or use an approval id', async () => {
  const f = fixture();
  const c = createComposioConnection({ env: config(), connect: f.connect });
  for (const request of [
    { operation: 'qa-contact', agentId: 'ava', arguments: { locationId: 'production' } },
    { operation: 'send-email', agentId: 'ava' },
    { operation: 'qa-contact', agentId: 'hermes' },
    { operation: 'qa-contact', agentId: 'ava', approvalId: 'unrelated' },
  ])
    assert.equal((await c.read(request)).ok, false);
  assert.equal(f.count(), 0);
});
test('invalid destinations and incomplete configuration fail before any connection', async () => {
  for (const patch of [
    { PBK_COMPOSIO_MCP_URL: 'http://backend.composio.dev/mcp' },
    { PBK_COMPOSIO_MCP_URL: 'https://evil.example/mcp' },
    { PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/mcp?key=secret' },
    { PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/api/v3/mcp/pbk-readonly' },
    { PBK_COMPOSIO_ACCOUNT_ID: '' },
    { PBK_COMPOSIO_AUTH_CONFIG_ID: '' },
    { PBK_COMPOSIO_API_KEY: '' },
  ]) {
    const f = fixture();
    const c = createComposioConnection({ env: config(patch), connect: f.connect });
    assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
    assert.equal(f.count(), 0);
  }
});

test('the current Composio session MCP path is accepted without loosening destination guards', async () => {
  const f = fixture();
  const c = createComposioConnection({
    env: config({
      PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/tool_router/trs_fixture-session/mcp',
    }),
    connect: f.connect,
  });
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, true);
  assert.equal(f.count(), 1);
  await c.close();
  for (const url of [
    'https://backend.composio.dev/tool_router/not-a-session/mcp',
    'https://backend.composio.dev/tool_router/trs_fixture-session/proxy',
    'https://backend.composio.dev/tool_router/trs_fixture-session/mcp?key=secret',
    'https://evil.example/tool_router/trs_fixture-session/mcp',
  ]) {
    const blocked = fixture();
    const connection = createComposioConnection({
      env: config({ PBK_COMPOSIO_MCP_URL: url }), connect: blocked.connect,
    });
    assert.equal((await connection.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
    assert.equal(blocked.count(), 0);
  }
});
test('changed tool schema or missing exact tool fails before execution', async () => {
  for (const tools of [
    [],
    [{ name: 'COMPOSIO_MULTI_EXECUTE_TOOL', inputSchema: schema }],
    [{ name: 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT', inputSchema: { type: 'object' } }],
  ]) {
    const f = fixture({ listTools: async () => ({ tools }) });
    const c = createComposioConnection({ env: config(), connect: f.connect });
    assert.equal((await c.read({ operation: 'qa-contact', agentId: 'rex' })).ok, false);
    assert.equal(f.calls.length, 0);
  }
});
test('cross-location, wrong record and missing QA/DND proof never leave the adapter', async () => {
  for (const patch of [
    { locationId: 'production' },
    { id: 'other-record' },
    { dnd: false },
    { tags: [] },
  ]) {
    const f = fixture({
      callTool: async () => ({
        structuredContent: {
          contact: {
            id: 'fixture-contact',
            locationId: 'fixture-location',
            dnd: true,
            tags: ['pbk-qa-no-outreach'],
            ...patch,
          },
        },
      }),
    });
    const c = createComposioConnection({ env: config(), connect: f.connect });
    const result = await c.read({ operation: 'qa-contact', agentId: 'ava' });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /production|other-record/);
  }
});
test('provider errors are redacted, retry is bounded and stale success expires', async () => {
  let now = 1000;
  const f = fixture();
  const c = createComposioConnection({ env: config(), connect: f.connect, now: () => now });
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, true);
  now += 120001;
  assert.equal(c.status().ready, false);
  f.client.callTool = async () => {
    throw new Error(secret + ' private record');
  };
  const result = await c.read({ operation: 'qa-contact', agentId: 'ava' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify([result, c.status()]), /synthetic|private record/);
  await c.read({ operation: 'qa-contact', agentId: 'ava' });
  assert.equal(f.count(), 1);
});
test('agent routing is explicit, tool first and keeps ordinary commands unchanged', async () => {
  const c = createComposioConnection({ env: config(), connect: fixture().connect });
  assert.equal(await routeComposioAgentRead(c, { command: 'hello' }), null);
  const r = await routeComposioAgentRead(c, {
    command: 'Rex check the Composio QA contact',
    agent: 'rex',
  });
  assert.equal(r.routedTo, 'tool_first:composio_read');
  assert.equal(r.ok, true);
  assert.match(r.response.answer, /DND/);
  assert.equal(
    (
      await routeComposioAgentRead(c, {
        command: 'send an email',
        composioOperation: 'send-email',
        agent: 'ava',
      })
    ).ok,
    false
  );
});
test('hung initialization times out and a late client is closed without becoming ready', async () => {
  let release;
  let closed = 0;
  const f = fixture();
  f.client.close = async () => {
    closed++;
  };
  const c = createComposioConnection({
    env: config(),
    timeoutMs: 15,
    connect: () =>
      new Promise((resolve) => {
        release = () => resolve(f.client);
      }),
  });
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(closed, 1);
  assert.equal(c.status().ready, false);
});
test('a dropped transport clears readiness and a later read reconnects', async () => {
  let now = 1000;
  const f = fixture();
  const c = createComposioConnection({ env: config(), connect: f.connect, now: () => now });
  await c.read({ operation: 'qa-contact', agentId: 'ava' });
  assert.equal(c.status().ready, true);
  f.client.onclose?.();
  assert.equal(c.status().ready, false);
  now += 6000;
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'rex' })).ok, true);
  assert.equal(f.count(), 2);
});
test('scope must be authoritatively verified before an MCP client is connected', async () => {
  const f = fixture();
  const c = createComposioConnection({
    env: config(),
    connect: f.connect,
    verifyScope: async () => false,
  });
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
  assert.equal(f.count(), 0);
});
test('normalized outbound credential collisions are rejected without network access', async () => {
  for (const extra of [
    { PBK_BRIDGE_API_KEY: ` ${secret} ` },
    { PBK_COMPOSIO_INBOUND_TOKEN: ` ${secret} ` },
  ]) {
    const f = fixture();
    const c = createComposioConnection({ env: config(extra), connect: f.connect });
    assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
    assert.equal(f.count(), 0);
  }
});
test('schema is rechecked before a cached client dispatches another read', async () => {
  const f = fixture();
  const c = createComposioConnection({ env: config(), connect: f.connect });
  await c.read({ operation: 'qa-contact', agentId: 'ava' });
  f.client.listTools = async () => ({ tools: [] });
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'ava' })).ok, false);
  assert.equal(f.calls.length, 1);
});
test('nested overrides on text commands are rejected without a read', async () => {
  let calls = 0;
  const c = {
    read: async () => {
      calls++;
      return { ok: true };
    },
  };
  const r = await routeComposioAgentRead(c, {
    command: 'Ava check the Composio QA contact',
    context: { options: { accountId: 'production' } },
  });
  assert.equal(r.ok, false);
  assert.equal(calls, 0);
});
test('stale old failure cannot close a replacement client or erase its evidence', async () => {
  let now = 1000,
    rejectOld,
    oldClosed = 0,
    newClosed = 0;
  const first = fixture({
    callTool: () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
    close: async () => {
      oldClosed++;
    },
  }).client;
  const next = fixture({
    close: async () => {
      newClosed++;
    },
  }).client;
  let connections = 0;
  const c = createComposioConnection({
    env: config(),
    now: () => now,
    connect: async () => (++connections === 1 ? first : next),
  });
  const oldRead = c.read({ operation: 'qa-contact', agentId: 'ava' });
  while (!rejectOld) await new Promise((r) => setTimeout(r, 1));
  first.onclose();
  now += 6000;
  assert.equal((await c.read({ operation: 'qa-contact', agentId: 'rex' })).ok, true);
  rejectOld(Error('late old failure'));
  await oldRead;
  assert.equal(newClosed, 0);
  assert.equal(c.status().ready, true);
  await c.close();
});
test('policy audit is bounded, correlated and contains no arguments or credentials', async () => {
  const c = createComposioConnection({ env: config(), connect: fixture().connect });
  await c.read({ operation: 'qa-contact', agentId: 'ava' });
  await c.read({ operation: 'send-email', agentId: 'ava' });
  const events = c.audit();
  assert.ok(events.some((e) => e.decision === 'allowed'));
  assert.ok(events.some((e) => e.decision === 'denied'));
  assert.ok(events.every((e) => e.direction === 'outbound' && e.correlationId && e.at));
  assert.doesNotMatch(JSON.stringify(events), /synthetic-fixture|fixture-contact|send-email/);
});
