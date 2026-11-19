import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredAttomMcpReader } from './attom-mcp-source.mjs';

test('MCP source requires explicit enablement and both credentials before construction', () => {
  for (const env of [{}, { PBK_ATTOM_MCP_ENABLED: 'false', ATTOM_MCP_CLIENT_ID: 'fixture-id', ATTOM_MCP_CLIENT_SECRET: 'fixture-secret' }, { PBK_ATTOM_MCP_ENABLED: 'true', ATTOM_MCP_CLIENT_ID: 'fixture-id' }]) {
    assert.equal(createConfiguredAttomMcpReader({ env, createClient: () => { throw Error('must not construct'); } }), null);
  }
});
test('configured construction is passive and uses the bounded full-record timeout', async () => {
  const env = { PBK_ATTOM_MCP_ENABLED: 'true', ATTOM_MCP_CLIENT_ID: 'fixture-id', ATTOM_MCP_CLIENT_SECRET: 'fixture-secret' };
  let reads = 0, closes = 0;
  const source = createConfiguredAttomMcpReader({ env,
    createClient: options => { assert.equal(options.env, env); assert.equal(options.timeoutMs, 60000); return { close: () => { closes++; } }; },
    createReader: () => async () => { reads++; return { status: 'matched' }; },
  });
  assert.equal(reads, 0); await source({}); assert.equal(reads, 1); await source.close(); assert.equal(closes, 1);
});
