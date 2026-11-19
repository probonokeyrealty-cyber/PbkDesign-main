import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startIsolatedBridge } from './bridge-smoke-isolation.mjs';

test(
  'isolated PBK bridge routes agent reads, authenticates limited MCP and creates no business work',
  { timeout: 60000 },
  async () => {
    const bridge = await startIsolatedBridge({
      entry: fileURLToPath(new URL('./fixtures/composio-bridge-smoke-entry.mjs', import.meta.url)),
    });
    const headers = {
      Authorization: `Bearer ${bridge.apiKey}`,
      'Content-Type': 'application/json',
    };
    const get = async (path) => (await bridge.fetch(bridge.origin + path, { headers })).json();
    let client;
    try {
      const before = await get('/state');
      const tooling = await get('/api/tooling/status');
      assert.equal(tooling.tooling.composio.outbound.state, 'configuration_missing');
      assert.equal(tooling.tooling.composio.inbound.ready, false);
      for (const agent of ['ava', 'rex']) {
        const r = await bridge.fetch(bridge.origin + '/invoke', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            toolName: 'runAgentCommand',
            params: { agent, command: `${agent} check the Composio QA contact` },
          }),
        });
        const body = await r.json();
        const result = body.result;
        assert.equal(result.routedTo, 'tool_first:composio_read');
        assert.equal(result.ok, false);
        assert.equal(result.response.result, 'configuration_missing');
      }
      // The bridge master credential must not authenticate the limited MCP endpoint.
      assert.equal(
        (
          await bridge.fetch(bridge.origin + '/mcp/pbk-readonly', {
            method: 'POST',
            headers,
            body: '{}',
          })
        ).status,
        401
      );
      client = new Client({ name: 'composio-compatible-fixture', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(bridge.origin + '/mcp/pbk-readonly'), {
          fetch: (url, init) => bridge.fetch(url, init),
          requestInit: { headers: { Authorization: `Bearer ${bridge.apiKey}-readonly-fixture` } },
        })
      );
      const registry = await client.callTool({ name: 'pbk_agent_registry', arguments: {} });
      assert.ok(registry.structuredContent.agents.some((a) => a.name === 'Ava'));
      assert.equal(registry.structuredContent.executionVerified, false);
      const readiness = await get('/api/tooling/status');
      assert.equal(readiness.tooling.composio.inbound.ready, true);
      assert.equal(readiness.tooling.composio.ready, false);
      const after = await get('/state');
      for (const key of [
        'leads',
        'tasks',
        'adminTasks',
        'approvals',
        'calls',
        'messages',
        'contracts',
      ])
        assert.deepEqual(
          after.state?.[key] ?? after[key],
          before.state?.[key] ?? before[key],
          `${key} unchanged`
        );
    } finally {
      await client?.close();
      await bridge.stop();
    }
  }
);

test(
  'Ava and Rex receive a verified QA read through the real bridge and MCP SDK fixture',
  { timeout: 60000 },
  async () => {
    const bridge = await startIsolatedBridge({
      entry: fileURLToPath(new URL('./fixtures/composio-bridge-smoke-entry.mjs', import.meta.url)),
      args: ['--outbound-fixture'],
    });
    const headers = {
      Authorization: `Bearer ${bridge.apiKey}`,
      'Content-Type': 'application/json',
    };
    try {
      const before = await bridge
        .fetch(bridge.origin + '/state', { headers })
        .then((r) => r.json());
      for (const agent of ['ava', 'rex']) {
        const body = await bridge
          .fetch(bridge.origin + '/invoke', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              toolName: 'runAgentCommand',
              params: { agent, command: `${agent} check the Composio QA contact` },
            }),
          })
          .then((r) => r.json());
        assert.equal(body.result.ok, true);
        assert.equal(body.result.routedTo, 'tool_first:composio_read');
        assert.equal(body.result.response.contact.dnd, true);
        assert.equal(body.result.response.contact.qaExcluded, true);
      }
      const tooling = await bridge
        .fetch(bridge.origin + '/api/tooling/status', { headers })
        .then((r) => r.json());
      assert.equal(tooling.tooling.composio.outbound.ready, true);
      const after = await bridge.fetch(bridge.origin + '/state', { headers }).then((r) => r.json());
      for (const key of [
        'leads',
        'tasks',
        'adminTasks',
        'approvals',
        'calls',
        'messages',
        'contracts',
      ])
        assert.deepEqual(after.state?.[key] ?? after[key], before.state?.[key] ?? before[key]);
    } finally {
      await bridge.stop();
    }
  }
);
