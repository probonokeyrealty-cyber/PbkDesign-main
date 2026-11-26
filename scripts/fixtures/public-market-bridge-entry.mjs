import { registerHooks } from 'node:module';
import { schemaFingerprint } from '../lib/public-market-mcp.mjs';
process.env.RENDER_SERVICE_ID = process.argv.includes('--nonstaging') ? 'not-staging' : 'srv-dbvk7tv40ujc73e0d8gg';
if (process.argv.includes('--canary')) process.env.PBK_E2B_MARKET_FAST_PATH_PERCENT = '10';
if (process.argv.includes('--enabled')) {
  process.env.PBK_E2B_MARKET_WORKER_ENABLED = 'true';
  process.env.PBK_E2B_MARKET_WORKER_API_KEY = 'synthetic-cloud-worker';
  const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
  Object.assign(process.env, {
    PBK_COMPOSIO_MARKET_SEARCH_ENABLED: 'true',
    PBK_COMPOSIO_MARKET_SEARCH_API_KEY: 'synthetic-public-search',
    PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID: 'trs_market',
    PBK_COMPOSIO_MARKET_SEARCH_USER_ID: 'public-user',
    PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION: '1',
    PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256: schemaFingerprint(schema),
  });
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'e2b')
        return {
          url: new URL('./public-market-sdk-fixture.mjs', import.meta.url).href,
          shortCircuit: true,
        };
      return next(specifier, context);
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://backend.composio.dev/api/v3.1/tool_router/session/trs_market')
      return Response.json({
        session_id: 'trs_market',
        config_version: 1,
        mcp: { url: 'https://backend.composio.dev/tool_router/trs_market/mcp' },
        config: {
          user_id: 'public-user',
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
      });
    if (url === 'https://backend.composio.dev/tool_router/trs_market/mcp') {
      if (init.method === 'DELETE') return new Response(null, { status: 200 });
      if (init.method === 'GET') return new Response(null, { status: 405 });
      const req = JSON.parse(init.body);
      if (req.id === undefined) return new Response(null, { status: 202 });
      let result;
      if (req.method === 'initialize')
        result = {
          protocolVersion: req.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'public-search-fixture', version: '1' },
        };
      else if (req.method === 'tools/list')
        result = { tools: [{ name: 'COMPOSIO_SEARCH_WEB', inputSchema: schema }] };
      else if (req.method === 'tools/call' && req.params.name === 'COMPOSIO_SEARCH_WEB')
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                successful: true,
                data: {
                  answer:
                    'Public inventory report for Tampa. Review publication dates before an offer.',
                  citations: [{ url: 'https://example.org/market-report' }],
                },
              }),
            },
          ],
        };
      else throw Error('Unexpected public search method');
      return Response.json({ jsonrpc: '2.0', id: req.id, result });
    }
    return originalFetch(input, init);
  };
}
await import('../openclaw-local-server.mjs');
