import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Server-side only. The property reader binds one exact property and the
// selected datasets using the verified ATTOM input schema; browser callers
// never choose an arbitrary server, tool or argument object.
// Public bootstrap source (read 2026-11-18):
// https://mcp.intelligence.attomdata.com/metadata
// capabilityGuides[attom-mcp-bootstrap] documents backend client_credentials at
// /token, initialize at POST /, and MCP-Session-Id reuse. Credentials must be
// configured in the bridge secret manager; never copy browser cookies/tokens.
// tools/list is metadata only. getPropertyData is an explicit provider read and
// runs only inside the existing explicit enrichment coordinator.
// SDK owns protocol negotiation and session IDs; neither is returned or logged.
const ORIGIN = 'https://mcp.intelligence.attomdata.com';
const failure = code => Object.assign(new Error(code), { code });
const clean = value => typeof value === 'string' ? value.trim() : '';

// Full multi-dataset records can take 30–45 seconds. Callers may select up to
// 60 seconds; the default remains 30 seconds and failed reads are never replayed.
export function createAttomMcpClient({ env = process.env, request = fetch, now = Date.now, timeoutMs = 30_000 } = {}) {
  const timeout = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(60_000, timeoutMs)) : 30_000;
  const clientId = clean(env.ATTOM_MCP_CLIENT_ID);
  const clientSecret = clean(env.ATTOM_MCP_CLIENT_SECRET);
  let token, tokenPending, session, connecting, openingClient;
  const lifecycle = new AbortController();
  let operationTail = Promise.resolve();
  let closed = false;
  const ensureOpen = () => { if (closed) throw failure('attom_mcp_closed'); };

  async function boundedRequest(url, init = {}) {
    ensureOpen();
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash || !['/', '/token'].includes(parsed.pathname)) throw failure('attom_mcp_endpoint_denied');
    const signal = AbortSignal.any([lifecycle.signal, AbortSignal.timeout(timeout), ...(init.signal ? [init.signal] : [])]);
    try {
      const response = await request(parsed.href, { ...init, redirect: 'error', signal });
      ensureOpen();
      if ([401, 403].includes(response.status)) throw failure('attom_mcp_authorization_failed');
      if (response.status === 429) throw failure('attom_mcp_rate_limited');
      if (!response.body) return response;
      // Limit bytes before SDK JSON/SSE parsing, including chunked responses.
      const limit = parsed.pathname === '/token' ? 65_536 : 2_097_152;
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body.cancel();
        throw failure('attom_mcp_response_too_large');
      }
      let bytes = 0;
      const bounded = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > limit) throw failure('attom_mcp_response_too_large');
          controller.enqueue(chunk);
        },
      }));
      return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      if (closed) throw failure('attom_mcp_closed');
      if (error?.code?.startsWith('attom_mcp_')) throw error;
      throw failure(signal.aborted ? 'attom_mcp_timed_out' : 'attom_mcp_unavailable');
    }
  }

  async function accessToken() {
    ensureOpen();
    if (!clientId || !clientSecret) throw failure('attom_mcp_not_configured');
    if (token && now() < token.refreshAt) return token.value;
    if (!tokenPending) {
      tokenPending = (async () => {
        const response = await boundedRequest(`${ORIGIN}/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
        });
        if (!response.ok) throw failure('attom_mcp_authorization_failed');
        let body;
        try { body = await response.json(); } catch { throw failure('attom_mcp_authorization_failed'); }
        ensureOpen();
        const expiry = Number(body.expires_in), value = clean(body.access_token);
        if (!value || value.length > 16_384 || /[\r\n]/.test(value) || clean(body.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(expiry) || expiry <= 0 || expiry > 31_536_000) throw failure('attom_mcp_authorization_failed');
        token = { value, refreshAt: now() + expiry * 1000 - Math.min(30_000, expiry * 500) };
        return value;
      })().finally(() => { tokenPending = undefined; });
    }
    return tokenPending;
  }

  async function connected() {
    if (closed) throw failure('attom_mcp_closed');
    if (session) return session;
    if (!connecting) {
      connecting = (async () => {
        await accessToken();
        ensureOpen();
        const client = new Client({ name: 'pbk-attom-readonly', version: '1.0.0' }, { capabilities: {} });
        openingClient = client;
        const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/`), {
          reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
          fetch: async (url, init = {}) => {
            const headers = new Headers(init.headers);
            headers.set('Authorization', `Bearer ${await accessToken()}`);
            return boundedRequest(url, { ...init, headers });
          },
        });
        try {
          await client.connect(transport, { timeout, maxTotalTimeout: timeout });
          if (closed) { await client.close(); throw failure('attom_mcp_closed'); }
          session = client;
          return client;
        } catch (error) {
          await client.close().catch(() => {});
          throw error;
        } finally {
          if (openingClient === client) openingClient = undefined;
        }
      })().finally(() => { connecting = undefined; });
    }
    return connecting;
  }

  function invoke(operation) {
    // Serialize operations on this client so retirement after one failure cannot
    // cancel another read sharing the session. No failed operation is replayed.
    const work = operationTail.then(async () => {
      let operationClient;
      try {
        ensureOpen();
        operationClient = await connected();
        ensureOpen();
        return await operation(operationClient);
      } catch (error) {
        if (operationClient && session === operationClient) {
          session = undefined;
          await operationClient.close().catch(() => {});
        }
        if (closed) throw failure('attom_mcp_closed');
        const code = error?.code;
        if (code === 'attom_mcp_authorization_failed') token = undefined;
        if (typeof code === 'string' && /^attom_mcp_[a-z_]+$/.test(code)) throw failure(code);
        throw failure(error?.code === -32001 ? 'attom_mcp_timed_out' : 'attom_mcp_unavailable');
      }
    });
    operationTail = work.catch(() => {});
    return work;
  }

  return Object.freeze({
    listTools: () => invoke(client => client.listTools({}, { timeout, maxTotalTimeout: timeout })),
    async getPropertyData(argumentsObject) {
      let args;
      try {
        if (!argumentsObject || typeof argumentsObject !== 'object' || Array.isArray(argumentsObject)) throw new Error();
        const encoded = JSON.stringify(argumentsObject);
        if (Buffer.byteLength(encoded, 'utf8') > 65_536) throw new Error();
        args = JSON.parse(encoded);
      } catch { throw failure('attom_mcp_invalid_arguments'); }
      return invoke(async client => {
        const result = await client.callTool({ name: 'get_property_data', arguments: args }, undefined, { timeout, maxTotalTimeout: timeout });
        if (result.isError) throw failure('attom_mcp_tool_failed');
        return result;
      });
    },
    async close() {
      closed = true;
      lifecycle.abort();
      token = undefined;
      const clients = new Set([session, openingClient]);
      session = undefined;
      openingClient = undefined;
      await Promise.all([...clients].filter(Boolean).map(client => client.close().catch(() => {})));
    },
  });
}
