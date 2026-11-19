import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const AGENTS = new Set([
  'Ava',
  'BANT Enforcer',
  'Call Analyzer',
  'Hermes',
  'Max',
  'Nurture Agent',
  'Prosody Tuner',
  'QA Agent',
  'Research Orchestrator',
  'Rex',
  'Script Rotator',
]);
const STATES = new Set([
  'disabled',
  'configuration_missing',
  'connecting',
  'connected',
  'unavailable',
  'error',
]);
function direction(value = {}) {
  return {
    ready: value.ready === true,
    state: STATES.has(value.state) ? value.state : 'unavailable',
  };
}
export function selectPbkReadOnlyStatus(kind, value = {}) {
  if (kind === 'health')
    return {
      ok: value.ok === true,
      authRequired: value.features?.authRequired === true,
      stateBackend: ['postgres', 'file'].includes(value.features?.stateBackend)
        ? value.features.stateBackend
        : 'unknown',
    };
  if (kind === 'registry') {
    const names = [
      ...new Set(
        (value.registry?.agents || value.agents || [])
          .map((a) => a.name)
          .filter((n) => AGENTS.has(n))
      ),
    ];
    return {
      agents: names.map((name) => ({ name })),
      agentCount: names.length,
      executionVerified: false,
    };
  }
  return { outbound: direction(value.outbound), inbound: direction(value.inbound), readOnly: true };
}
export function createPbkReadOnlyMcpServer({ readStatus, onRead = () => {} }) {
  const server = new McpServer({ name: 'pbk-readonly', version: '1.0.0' });
  for (const [name, kind] of [
    ['pbk_health', 'health'],
    ['pbk_agent_registry', 'registry'],
    ['pbk_connection_readiness', 'readiness'],
  ]) {
    server.registerTool(
      name,
      {
        description: 'Read sanitized PBK staging metadata. No business records or provider writes.',
        inputSchema: z.object({}).strict().default({}),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        if (Object.keys(args).length)
          return {
            isError: true,
            content: [{ type: 'text', text: 'Arguments are not permitted.' }],
          };
        let timer;
        try {
          const raw = await Promise.race([
            readStatus(kind),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('timeout')), 5000);
            }),
          ]);
          const data = selectPbkReadOnlyStatus(kind, raw);
          onRead(name);
          return {
            content: [{ type: 'text', text: JSON.stringify(data) }],
            structuredContent: data,
          };
        } catch {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Read-only status unavailable.' }],
          };
        } finally {
          clearTimeout(timer);
        }
      }
    );
  }
  return server;
}
function configFrom(env, allowLoopback) {
  if (env.PBK_COMPOSIO_STAGING_ENABLED !== 'true' || env.PBK_COMPOSIO_INBOUND_ENABLED !== 'true')
    return { reason: 'disabled' };
  const key = String(env.PBK_COMPOSIO_INBOUND_TOKEN || '').trim();
  if (
    key.length < 24 ||
    [env.PBK_BRIDGE_API_KEY, env.PBK_COMPOSIO_API_KEY].some(
      (other) => other && String(other).trim() === key
    )
  )
    return { reason: 'configuration_missing' };
  try {
    const url = new URL(env.PBK_COMPOSIO_INBOUND_URL);
    const local = allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (
      (url.protocol !== 'https:' && !local) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/mcp/pbk-readonly'
    )
      throw Error();
    return { key, url };
  } catch {
    return { reason: 'configuration_missing' };
  }
}
export function createPbkReadOnlyMcpEndpoint({
  env = process.env,
  readStatus,
  now = Date.now,
  allowLoopback = false,
  onAudit = () => {},
}) {
  const config = configFrom({ ...env }, allowLoopback);
  let lastSuccess = null,
    windowStart = now(),
    requests = 0;
  const active = new Set();
  const events = [];
  function record(decision, correlationId, toolName = 'mcp_protocol') {
    const safe = [
      'pbk_health',
      'pbk_agent_registry',
      'pbk_connection_readiness',
      'mcp_protocol',
    ].includes(toolName)
      ? toolName
      : 'unrecognized';
    const event = {
      direction: 'inbound',
      toolName: safe,
      decision,
      correlationId,
      at: new Date(now()).toISOString(),
    };
    events.push(event);
    if (events.length > 100) events.shift();
    try {
      onAudit({ ...event });
    } catch {}
  }
  function status() {
    const ready = lastSuccess !== null && now() - lastSuccess < 120_000;
    return {
      optional: true,
      enabled: config.reason !== 'disabled',
      ready,
      state: config.reason || (ready ? 'connected' : 'unavailable'),
      lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
      reason: config.reason || (ready ? 'read_verified' : 'read_not_verified'),
      note: ready
        ? 'Authenticated read-only PBK tool verified.'
        : 'Limited staging endpoint. An authenticated tool read is required.',
    };
  }
  function send(res, code, error) {
    if (res.writableEnded) return;
    res.writeHead(code, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify({ error }));
  }
  async function handle(req, res) {
    const correlationId = randomUUID();
    const deny = (code, error) => {
      record('denied', correlationId);
      send(res, code, error);
    };
    if (config.reason) {
      deny(config.reason === 'disabled' ? 404 : 503, config.reason);
      return;
    }
    const supplied = String(req.headers.authorization || '');
    const hash = (v) => createHash('sha256').update(v).digest();
    if (!timingSafeEqual(hash(supplied), hash(`Bearer ${config.key}`))) {
      deny(401, 'unauthorized');
      return;
    }
    if (now() - windowStart >= 60_000) {
      windowStart = now();
      requests = 0;
    }
    if (++requests > 60) {
      deny(429, 'rate_limited');
      return;
    }
    if (
      req.headers.host !== config.url.host ||
      (req.headers.origin && req.headers.origin !== config.url.origin)
    ) {
      deny(403, 'origin_denied');
      return;
    }
    if (req.url !== '/mcp/pbk-readonly') {
      deny(404, 'not_found');
      return;
    }
    if (req.method !== 'POST') {
      deny(405, 'method_not_allowed');
      return;
    }
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      deny(415, 'json_required');
      return;
    }
    if (Number(req.headers['content-length'] || 0) > 65_536) {
      req.resume();
      deny(413, 'body_limit');
      return;
    }
    const timer = setTimeout(() => {
      deny(408, 'request_timeout');
      req.destroy();
    }, 10_000);
    let server, transport;
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 65_536) {
          deny(413, 'body_limit');
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      // Reject extra arguments before the SDK's empty-object schema can strip them.
      if (
        body?.method === 'tools/call' &&
        body.params?.arguments !== undefined &&
        (body.params.arguments === null ||
          typeof body.params.arguments !== 'object' ||
          Array.isArray(body.params.arguments) ||
          Object.keys(body.params.arguments).length)
      ) {
        deny(400, 'arguments_denied');
        return;
      }
      if (
        body?.method === 'tools/call' &&
        !['pbk_health', 'pbk_agent_registry', 'pbk_connection_readiness'].includes(
          body.params?.name
        )
      ) {
        record('denied', correlationId, 'unrecognized');
        deny(403, 'tool_denied');
        return;
      }
      server = createPbkReadOnlyMcpServer({
        readStatus,
        onRead: (name) => {
          lastSuccess = now();
          record('allowed', correlationId, name);
        },
      });
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      active.add(server);
      await server.connect(transport);
      res.setHeader('cache-control', 'no-store');
      await transport.handleRequest(req, res, body);
    } catch {
      deny(400, 'invalid_mcp_request');
    } finally {
      clearTimeout(timer);
      if (server) {
        active.delete(server);
        await server.close().catch(() => {});
      } else await transport?.close().catch(() => {});
    }
  }
  return {
    handle,
    status,
    audit: () => events.map((e) => ({ ...e })),
    close: async () => {
      await Promise.all([...active].map((s) => s.close().catch(() => {})));
      active.clear();
      lastSuccess = null;
    },
  };
}
