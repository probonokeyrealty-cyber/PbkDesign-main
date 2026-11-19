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
        'HIGHLEVEL_MCP_CONTACTS_GET_CONTACT',
        { inputSchema: { path_contactId: z.string() } },
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
          '/api/v3.1/auth/session/info': {
            project: { nano_id: 'project' },
            api_key: { project_id: 'project' },
          },
          '/api/v3.1/tool_router/session/session': {
            session_id: 'session',
            config_version: 1,
            mcp: { url: 'https://backend.composio.dev/api/v3/mcp/fixture' },
            config: {
              user_id: 'user',
              connected_accounts: { highlevel_mcp: ['account'] },
              toolkits: { enabled: ['highlevel_mcp'] },
              tools: { highlevel_mcp: { enabled: ['HIGHLEVEL_MCP_CONTACTS_GET_CONTACT'] } },
              preload: { tools: ['HIGHLEVEL_MCP_CONTACTS_GET_CONTACT'] },
            },
          },
          '/api/v3.1/connected_accounts/account': {
            status: 'ACTIVE',
            is_disabled: false,
            toolkit: { slug: 'highlevel_mcp' },
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
          PBK_COMPOSIO_PROJECT_ID: 'project',
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
      assert.deepEqual(calls, [{ path_contactId: 'qa-fixture' }]);
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

test('authoritative scope proof rejects identity, policy, URL, version and revoked-account drift', async () => {
  const saved = globalThis.fetch;
  const base = {
    identity: { project: { nano_id: 'project' }, api_key: { project_id: 'project' } },
    session: {
      session_id: 'session',
      config_version: 1,
      mcp: { url: 'https://backend.composio.dev/api/v3/mcp/fixture' },
      config: {
        user_id: 'user',
        connected_accounts: { highlevel_mcp: ['account'] },
        toolkits: { enabled: ['highlevel_mcp'] },
        tools: { highlevel_mcp: { enabled: ['HIGHLEVEL_MCP_CONTACTS_GET_CONTACT'] } },
        preload: { tools: ['HIGHLEVEL_MCP_CONTACTS_GET_CONTACT'] },
      },
    },
    account: { status: 'ACTIVE', is_disabled: false, toolkit: { slug: 'highlevel_mcp' } },
  };
  const mutations = [
    (b) => (b.identity.project.nano_id = 'other'),
    (b) => (b.identity.api_key.project_id = 'other'),
    (b) => (b.session.config.user_id = 'other'),
    (b) => (b.session.config.connected_accounts.highlevel_mcp = ['other']),
    (b) => (b.session.config_version = 2),
    (b) => (b.session.mcp.url = 'https://evil.example/mcp'),
    (b) =>
      b.session.config.tools.highlevel_mcp.enabled.push('HIGHLEVEL_MCP_CONTACTS_UPDATE_CONTACT'),
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
        return Response.json(
          url.endsWith('/info')
            ? fixture.identity
            : url.endsWith('/session/session')
              ? fixture.session
              : fixture.account
        );
      };
      const result = await verifyComposioSessionScope(
        {
          key: 'synthetic-project-fixture',
          projectId: 'project',
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
