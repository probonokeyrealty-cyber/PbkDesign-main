// Disposable bridge fixture only: no ambient provider credentials or production state.
process.env.PBK_COMPOSIO_STAGING_ENABLED = 'true';
process.env.PBK_COMPOSIO_INBOUND_ENABLED = 'true';
process.env.PBK_COMPOSIO_INBOUND_TOKEN = `${process.env.PBK_BRIDGE_API_KEY}-readonly-fixture`;
process.env.PBK_COMPOSIO_INBOUND_URL = `https://127.0.0.1:${process.env.PBK_OPENCLAW_PORT}/mcp/pbk-readonly`;
if (process.argv.includes('--outbound-fixture')) {
  const { schemaFingerprint } = await import('../lib/composio-connection.mjs');
  const schema = {
    type: 'object',
    properties: { contact_id: { type: 'string' } },
    required: ['contact_id'],
    additionalProperties: false,
  };
  const tool = 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT';
  const url = 'https://backend.composio.dev/api/v3/mcp/fixture';
  Object.assign(process.env, {
    PBK_COMPOSIO_MCP_URL: url,
    PBK_COMPOSIO_API_KEY: 'synthetic-project-fixture',
    PBK_COMPOSIO_AUTH_CONFIG_ID: 'auth-config',
    PBK_COMPOSIO_USER_ID: 'user',
    PBK_COMPOSIO_ACCOUNT_ID: 'account',
    PBK_COMPOSIO_SESSION_ID: 'session',
    PBK_COMPOSIO_SESSION_CONFIG_VERSION: '1',
    PBK_COMPOSIO_SANDBOX_LOCATION_ID: 'sandbox-fixture',
    PBK_COMPOSIO_QA_CONTACT_ID: 'qa-fixture',
    PBK_COMPOSIO_CONTACT_SCHEMA_SHA256: schemaFingerprint(schema),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    if (!target.startsWith('https://backend.composio.dev/')) return originalFetch(input, init);
    if (new Headers(init.headers).get('x-api-key') !== 'synthetic-project-fixture')
      return new Response(null, { status: 401 });
    const path = new URL(target).pathname;
    if (path === '/api/v3.1/auth/session/info')
      return Response.json({ error: { code: 908 } }, { status: 403 });
    if (path === '/api/v3.1/tool_router/session/session')
      return Response.json({
        session_id: 'session',
        config_version: 1,
        mcp: { url },
        config: {
          user_id: 'user',
          connected_accounts: { highlevel_location: ['account'] },
          toolkits: { enabled: ['highlevel_location'] },
          tools: { highlevel_location: { enabled: [tool] } },
          preload: { tools: [tool] },
        },
      });
    if (path === '/api/v3.1/connected_accounts/account')
      return Response.json({
        id: 'account',
        user_id: 'user',
        auth_config: { id: 'auth-config', is_disabled: false },
        status: 'ACTIVE',
        is_disabled: false,
        toolkit: { slug: 'highlevel_location' },
      });
    if (target !== url) return new Response(null, { status: 404 });
    const body = JSON.parse(init.body);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const contact = {
      id: 'qa-fixture',
      locationId: 'sandbox-fixture',
      dnd: true,
      tags: ['pbk-qa-no-outreach'],
    };
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: body.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'composio-fixture', version: '1' },
          }
        : body.method === 'tools/list'
          ? { tools: [{ name: tool, inputSchema: schema }] }
          : body.method === 'tools/call' &&
              body.params.name === tool &&
              body.params.arguments?.contact_id === 'qa-fixture'
            ? {
                structuredContent: { contact },
                content: [{ type: 'text', text: JSON.stringify({ contact }) }],
              }
            : null;
    if (!result) return new Response(null, { status: 400 });
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
}
await import('../openclaw-local-server.mjs');
