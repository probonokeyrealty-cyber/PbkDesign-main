import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import {
  createComposioConnection,
  schemaFingerprint,
  verifyComposioSessionScope,
} from './lib/composio-connection.mjs';

test('project-key scope proof uses pinned resources without the user-only identity endpoint', async () => {
  const saved = globalThis.fetch;
  const paths = [];
  const config = {
    key: 'synthetic-project-fixture',
    authConfigId: 'auth-config',
    userId: 'user',
    accountId: 'account',
    sessionId: 'session',
    configVersion: 1,
    url: 'https://backend.composio.dev/api/v3/mcp/fixture',
  };
  try {
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      paths.push(path);
      assert.equal(init.headers['x-api-key'], config.key);
      if (path === '/api/v3.1/auth/session/info')
        return Response.json(
          { error: { code: 908, message: 'Project API key is not allowed for this endpoint' } },
          { status: 403 }
        );
      if (path === '/api/v3.1/connected_accounts/account')
        return Response.json({
          id: 'account',
          user_id: 'user',
          auth_config: { id: 'auth-config', is_disabled: false },
          status: 'ACTIVE',
          is_disabled: false,
          toolkit: { slug: 'highlevel_location' },
        });
      if (path === '/api/v3.1/tool_router/session/session')
        return Response.json({
          session_id: 'session',
          config_version: 1,
          mcp: { url: config.url },
          config: {
            user_id: 'user',
            connected_accounts: { highlevel_location: ['account'] },
            toolkits: { enabled: ['highlevel_location'] },
            tools: { highlevel_location: { enabled: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] } },
            preload: { tools: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] },
          },
        });
      throw Error('Unexpected metadata endpoint');
    };
    assert.equal(await verifyComposioSessionScope(config, new AbortController().signal), true);
    assert.equal(paths.includes('/api/v3.1/auth/session/info'), false);
    assert.deepEqual(
      new Set(paths),
      new Set(['/api/v3.1/connected_accounts/account', '/api/v3.1/tool_router/session/session'])
    );
  } finally {
    globalThis.fetch = saved;
  }
});

test('a project key denied access to pinned resources fails closed without fallback', async () => {
  const saved = globalThis.fetch;
  try {
    for (const status of [401, 403, 404]) {
      const paths = [];
      globalThis.fetch = async (url) => {
        paths.push(new URL(url).pathname);
        return Response.json({ error: { code: status } }, { status });
      };
      await assert.rejects(
        verifyComposioSessionScope(
          {
            key: 'synthetic-project-fixture',
            accountId: 'account',
            authConfigId: 'auth-config',
            userId: 'user',
            sessionId: 'session',
          },
          new AbortController().signal
        ),
        /scope_unavailable/
      );
      assert.deepEqual(paths, ['/api/v3.1/connected_accounts/account']);
    }
  } finally {
    globalThis.fetch = saved;
  }
});

for (const json of [true, false]) {
  test(`outbound SDK protocol supports ${json ? 'JSON' : 'SSE'} MCP replies and empty notifications`, async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const http = createServer(async (req, res) => {
      if (req.headers['x-api-key'] !== 'synthetic-project-fixture') {
        res.writeHead(401);
        res.end();
        return;
      }
      const server = new McpServer({ name: 'composio-fixture', version: '1' });
      server.registerTool(
        'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT',
        { inputSchema: { contact_id: z.string() } },
        async (args) => {
          calls.push(args);
          const result = {
            contact: {
              id: 'qa-fixture',
              locationId: 'sandbox-fixture',
              dnd: true,
              tags: ['pbk-qa-no-outreach'],
              privateData: 'MUST NOT LEAK',
            },
          };
          return {
            structuredContent: result,
            content: [{ type: 'text', text: JSON.stringify(result) }],
          };
        }
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: json,
      });
      res.once('close', () => {
        void server.close();
      });
      await server.connect(transport);
      try {
        await transport.handleRequest(req, res);
      } catch {
        if (!res.writableEnded) {
          res.writeHead(400);
          res.end();
        }
      }
    });
    await new Promise((r) => http.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${http.address().port}`;
    let connection;
    try {
      const inspector = new Client({ name: 'schema-fixture', version: '1' });
      await inspector.connect(
        new StreamableHTTPClientTransport(new URL(origin + '/api/v3/mcp/fixture'), {
          requestInit: { headers: { 'x-api-key': 'synthetic-project-fixture' } },
        })
      );
      const schema = (await inspector.listTools()).tools[0].inputSchema;
      await inspector.close();
      let forwarded = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const metadata = {
          '/api/v3.1/tool_router/session/session': {
            session_id: 'session',
            config_version: 1,
            mcp: { url: 'https://backend.composio.dev/api/v3/mcp/fixture' },
            config: {
              user_id: 'user',
              connected_accounts: { highlevel_location: ['account'] },
              toolkits: { enabled: ['highlevel_location'] },
              tools: {
                highlevel_location: { enabled: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] },
              },
              preload: { tools: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] },
            },
          },
          '/api/v3.1/connected_accounts/account': {
            id: 'account',
            user_id: 'user',
            auth_config: { id: 'auth-config', is_disabled: false },
            status: 'ACTIVE',
            is_disabled: false,
            toolkit: { slug: 'highlevel_location' },
          },
        };
        if (metadata[url.pathname]) {
          assert.equal(url.origin, 'https://backend.composio.dev');
          assert.equal(init.redirect, 'error');
          return Response.json(metadata[url.pathname]);
        }
        assert.equal(url.href, 'https://backend.composio.dev/api/v3/mcp/fixture');
        forwarded++;
        return originalFetch(origin + url.pathname, init);
      };
      connection = createComposioConnection({
        env: {
          PBK_COMPOSIO_STAGING_ENABLED: 'true',
          PBK_COMPOSIO_MCP_URL: 'https://backend.composio.dev/api/v3/mcp/fixture',
          PBK_COMPOSIO_API_KEY: 'synthetic-project-fixture',
          PBK_COMPOSIO_AUTH_CONFIG_ID: 'auth-config',
          PBK_COMPOSIO_USER_ID: 'user',
          PBK_COMPOSIO_ACCOUNT_ID: 'account',
          PBK_COMPOSIO_SESSION_ID: 'session',
          PBK_COMPOSIO_SESSION_CONFIG_VERSION: '1',
          PBK_COMPOSIO_SANDBOX_LOCATION_ID: 'sandbox-fixture',
          PBK_COMPOSIO_QA_CONTACT_ID: 'qa-fixture',
          PBK_COMPOSIO_CONTACT_SCHEMA_SHA256: schemaFingerprint(schema),
        },
      });
      const result = await connection.read({ operation: 'qa-contact', agentId: 'ava' });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(connection.status().ready, true);
      assert.deepEqual(calls, [{ contact_id: 'qa-fixture' }]);
      assert.ok(forwarded >= 3);
      assert.doesNotMatch(JSON.stringify(result), /MUST NOT LEAK/);
    } finally {
      await connection?.close();
      globalThis.fetch = originalFetch;
      http.closeAllConnections();
      await new Promise((r) => http.close(r));
    }
  });
}

test('authenticated pinned-resource proof rejects identity, policy, URL, version and revoked-account drift', async () => {
  const saved = globalThis.fetch;
  const base = {
    session: {
      session_id: 'session',
      config_version: 1,
      mcp: { url: 'https://backend.composio.dev/api/v3/mcp/fixture' },
      config: {
        user_id: 'user',
        connected_accounts: { highlevel_location: ['account'] },
        toolkits: { enabled: ['highlevel_location'] },
        tools: { highlevel_location: { enabled: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] } },
        preload: { tools: ['HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT'] },
      },
    },
    account: {
      id: 'account',
      user_id: 'user',
      auth_config: { id: 'auth-config', is_disabled: false },
      status: 'ACTIVE',
      is_disabled: false,
      toolkit: { slug: 'highlevel_location' },
    },
  };
  const mutations = [
    (b) => (b.account.id = 'other'),
    (b) => (b.account.user_id = 'other'),
    (b) => (b.account.auth_config.id = 'other'),
    (b) => (b.account.auth_config.is_disabled = true),
    (b) => (b.session.config.user_id = 'other'),
    (b) => (b.session.config.connected_accounts.highlevel_location = ['other']),
    (b) => (b.session.config_version = 2),
    (b) => (b.session.mcp.url = 'https://evil.example/mcp'),
    (b) =>
      b.session.config.tools.highlevel_location.enabled.push(
        'HIGHLEVEL_LOCATION_CONTACTS_UPDATE_CONTACT'
      ),
    (b) => (b.account.status = 'REVOKED'),
    (b) => (b.account.is_disabled = true),
  ];
  try {
    for (const mutate of [null, ...mutations]) {
      const fixture = structuredClone(base);
      mutate?.(fixture);
      globalThis.fetch = async (url, init) => {
        assert.equal(new URL(url).origin, 'https://backend.composio.dev');
        assert.equal(init.redirect, 'error');
        return Response.json(url.endsWith('/session/session') ? fixture.session : fixture.account);
      };
      const result = await verifyComposioSessionScope(
        {
          key: 'synthetic-project-fixture',
          authConfigId: 'auth-config',
          userId: 'user',
          accountId: 'account',
          sessionId: 'session',
          configVersion: 1,
          url: base.session.mcp.url,
        },
        new AbortController().signal
      );
      assert.equal(result, mutate === null);
    }
  } finally {
    globalThis.fetch = saved;
  }
});
