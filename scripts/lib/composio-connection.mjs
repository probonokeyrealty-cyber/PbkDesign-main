import { createHash, randomUUID } from 'node:crypto';

const CONTACT_TOOL = 'HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT';
const SAFE_STATES = new Set([
  'disabled',
  'configuration_missing',
  'connecting',
  'connected',
  'unavailable',
  'error',
]);
export function schemaFingerprint(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])])
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function readConfig(env) {
  if (env.PBK_COMPOSIO_STAGING_ENABLED !== 'true') return { enabled: false, reason: 'disabled' };
  const keys = [
    'MCP_URL',
    'API_KEY',
    'AUTH_CONFIG_ID',
    'USER_ID',
    'ACCOUNT_ID',
    'SESSION_ID',
    'SESSION_CONFIG_VERSION',
    'SANDBOX_LOCATION_ID',
    'QA_CONTACT_ID',
    'CONTACT_SCHEMA_SHA256',
  ];
  if (keys.some((k) => !String(env[`PBK_COMPOSIO_${k}`] || '').trim()))
    return { enabled: true, reason: 'configuration_missing' };
  try {
    const key = String(env.PBK_COMPOSIO_API_KEY).trim();
    if (
      [env.PBK_BRIDGE_API_KEY, env.PBK_COMPOSIO_INBOUND_TOKEN].some(
        (other) => other && String(other).trim() === key
      )
    )
      throw Error();
    const url = new URL(env.PBK_COMPOSIO_MCP_URL);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'backend.composio.dev' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/(?:(?:api\/v3(?:\.1)?\/mcp\/|v3\/mcp\/|tool_router\/v3\/)[A-Za-z0-9_/-]+|tool_router\/trs_[A-Za-z0-9_-]+\/mcp)$/.test(
        url.pathname
      ) ||
      /pbk-readonly/i.test(url.pathname)
    )
      throw Error();
    if (!/^[a-f0-9]{64}$/.test(env.PBK_COMPOSIO_CONTACT_SCHEMA_SHA256)) throw Error();
    if (
      !/^[A-Za-z0-9_-]{1,100}$/.test(env.PBK_COMPOSIO_SESSION_ID) ||
      !/^\d+$/.test(env.PBK_COMPOSIO_SESSION_CONFIG_VERSION)
    )
      throw Error();
    return {
      enabled: true,
      url: url.href,
      key,
      authConfigId: env.PBK_COMPOSIO_AUTH_CONFIG_ID,
      userId: env.PBK_COMPOSIO_USER_ID,
      accountId: env.PBK_COMPOSIO_ACCOUNT_ID,
      sessionId: env.PBK_COMPOSIO_SESSION_ID,
      configVersion: Number(env.PBK_COMPOSIO_SESSION_CONFIG_VERSION),
      contactId: env.PBK_COMPOSIO_QA_CONTACT_ID,
      locationId: env.PBK_COMPOSIO_SANDBOX_LOCATION_ID,
      schemaHash: env.PBK_COMPOSIO_CONTACT_SCHEMA_SHA256,
    };
  } catch {
    return { enabled: true, reason: 'configuration_missing' };
  }
}

// Authenticated metadata reads, never connection creation or session mutation.
export async function verifyComposioSessionScope(config, signal) {
  async function get(path) {
    const response = await fetch('https://backend.composio.dev' + path, {
      headers: { 'x-api-key': config.key, Accept: 'application/json' },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('scope_unavailable');
    }
    let size = 0;
    const body = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, c) {
          size += chunk.length;
          if (size > 2_000_000) {
            c.error(Error('response_limit'));
            return;
          }
          c.enqueue(chunk);
        },
      })
    );
    return new Response(body).json();
  }
  // Project API keys cannot call the user-only auth/session/info route (908).
  // Provision these immutable resource IDs in the independently verified project.
  // Authenticated access to both exact resources proves the project-key boundary;
  // never substitute a user/org key or accept caller-supplied scope overrides.
  const account = await get('/api/v3.1/connected_accounts/' + encodeURIComponent(config.accountId));
  if (
    account.id !== config.accountId ||
    account.user_id !== config.userId ||
    account.auth_config?.id !== config.authConfigId ||
    account.auth_config?.is_disabled !== false ||
    account.status !== 'ACTIVE' ||
    account.is_disabled !== false ||
    account.toolkit?.slug !== 'highlevel_location'
  )
    return false;
  const session = await get(
    '/api/v3.1/tool_router/session/' + encodeURIComponent(config.sessionId)
  );
  const cfg = session.config;
  const only = (v, expected) => Array.isArray(v) && v.length === 1 && v[0] === expected;
  if (
    session.session_id !== config.sessionId ||
    session.config_version !== config.configVersion ||
    session.mcp?.url !== config.url ||
    cfg?.user_id !== config.userId ||
    !only(cfg.connected_accounts?.highlevel_location, config.accountId) ||
    !only(cfg.toolkits?.enabled, 'highlevel_location') ||
    !only(cfg.tools?.highlevel_location?.enabled, CONTACT_TOOL) ||
    !only(cfg.preload?.tools, CONTACT_TOOL)
  )
    return false;
  return true;
}

export async function connectComposioHttp(config, signal) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const target = new URL(config.url);
  const guardedFetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.href !== target.href) throw Error('destination_denied');
    if (String(init.method || 'GET').toUpperCase() === 'GET')
      return new Response(null, { status: 405 });
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('remote_unavailable');
    }
    if (response.status === 202 || response.status === 204) return response;
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json') && !type.includes('text/event-stream')) {
      await response.body?.cancel();
      throw Error('mcp_response_required');
    }
    let length = 0;
    const limited = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          length += chunk.length;
          if (length > 2_000_000) {
            controller.error(Error('response_limit'));
            return;
          }
          controller.enqueue(chunk);
        },
      })
    );
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(limited, { status: response.status, headers });
  };
  const transport = new StreamableHTTPClientTransport(target, {
    fetch: guardedFetch,
    requestInit: { headers: { 'x-api-key': config.key } },
  });
  const client = new Client({ name: 'pbk-composio-readonly', version: '1.0.0' });
  try {
    await client.connect(transport, { signal });
    return client;
  } catch {
    await transport.close().catch(() => {});
    throw Error('connection_failed');
  }
}

export function createComposioConnection({
  env = process.env,
  connect = connectComposioHttp,
  verifyScope = verifyComposioSessionScope,
  onAudit = () => {},
  now = Date.now,
  timeoutMs = 10_000,
} = {}) {
  const config = readConfig({ ...env });
  let client = null,
    connecting = null,
    phase = config.reason || 'unavailable',
    lastSuccess = null,
    lastError = null,
    retryAfter = 0,
    generation = 0;
  const activeControllers = new Set();
  const events = [];
  function record(decision, correlationId) {
    const event = {
      direction: 'outbound',
      toolName: CONTACT_TOOL,
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
  async function bounded(work) {
    const controller = new AbortController();
    activeControllers.add(controller);
    let timer;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(Error('timeout'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  }
  async function getClient() {
    if (client) return client;
    if (connecting) return connecting;
    const startedGeneration = generation;
    phase = 'connecting';
    connecting = bounded(async (signal) => {
      const candidate = await connect(config, signal);
      if (signal.aborted || startedGeneration !== generation) {
        await candidate.close().catch(() => {});
        throw Error('connection_obsolete');
      }
      try {
        const listing = await candidate.listTools({}, { signal, timeout: timeoutMs });
        const tool = listing?.tools?.find((t) => t.name === CONTACT_TOOL);
        if (!tool || schemaFingerprint(tool.inputSchema) !== config.schemaHash)
          throw Error('schema_mismatch');
        if (signal.aborted || startedGeneration !== generation) throw Error('connection_obsolete');
        client = candidate;
        candidate.onclose = () => {
          if (client === candidate) {
            client = null;
            generation++;
            phase = 'unavailable';
            lastError = 'composio_connection_closed';
            retryAfter = now() + 5_000;
          }
        };
        return candidate;
      } catch {
        await candidate.close().catch(() => {});
        throw Error('tool_policy_unavailable');
      }
    }).finally(() => {
      connecting = null;
    });
    return connecting;
  }
  function status() {
    const fresh = lastSuccess !== null && now() - lastSuccess < 120_000;
    const ready = !!client && phase === 'connected' && fresh;
    const state = ready
      ? 'connected'
      : phase === 'connected'
        ? 'unavailable'
        : SAFE_STATES.has(phase)
          ? phase
          : 'error';
    return {
      optional: true,
      enabled: config.enabled,
      ready,
      state,
      status: state,
      lastSuccessAt: lastSuccess === null ? null : new Date(lastSuccess).toISOString(),
      reason: lastError || config.reason || (ready ? 'read_verified' : 'read_not_verified'),
      note: ready
        ? 'Sandbox QA read verified; DND on and QA excluded.'
        : 'Read-only staging connection. A verified sandbox read is required.',
    };
  }
  async function read(request = {}) {
    const correlationId = randomUUID();
    if (
      !request ||
      typeof request !== 'object' ||
      Array.isArray(request) ||
      Object.keys(request).some((k) => !['operation', 'agentId'].includes(k)) ||
      request.operation !== 'qa-contact' ||
      !['ava', 'rex'].includes(request.agentId)
    ) {
      record('denied', correlationId);
      return { ok: false, result: 'composio_read_denied' };
    }
    if (config.reason) {
      record('denied', correlationId);
      return { ok: false, result: config.reason };
    }
    if (now() < retryAfter) {
      record('denied', correlationId);
      return { ok: false, result: 'composio_retry_backoff' };
    }
    let ownClient = client,
      ownGeneration = generation;
    try {
      if (!(await bounded((signal) => verifyScope(config, signal))))
        throw Error('scope_not_verified');
      const c = await getClient();
      ownClient = c;
      ownGeneration = generation;
      const listing = await bounded((signal) => c.listTools({}, { signal, timeout: timeoutMs }));
      const tool = listing?.tools?.find((t) => t.name === CONTACT_TOOL);
      if (!tool || schemaFingerprint(tool.inputSchema) !== config.schemaHash)
        throw Error('schema_changed');
      const result = await bounded((signal) =>
        c.callTool({ name: CONTACT_TOOL, arguments: { contact_id: config.contactId } }, undefined, {
          signal,
          timeout: timeoutMs,
        })
      );
      if (ownGeneration !== generation) throw Error('connection_obsolete');
      if (result.isError) throw Error('provider_error');
      let data = result.structuredContent;
      if (!data) {
        const text =
          result.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('') || '';
        if (text.length > 2_000_000) throw Error('response_limit');
        data = JSON.parse(text);
      }
      if (data?.successful === false || data?.success === false) throw Error('provider_error');
      const contact = data?.data?.contact || data?.contact || data?.data?.data?.contact;
      if (
        !contact ||
        contact.id !== config.contactId ||
        contact.locationId !== config.locationId ||
        contact.dnd !== true ||
        !Array.isArray(contact.tags) ||
        !contact.tags.includes('pbk-qa-no-outreach')
      )
        throw Error('scope_not_verified');
      lastSuccess = now();
      phase = 'connected';
      lastError = null;
      record('allowed', correlationId);
      return {
        ok: true,
        result: 'composio_qa_read_verified',
        contact: { dnd: true, qaExcluded: true, identityVerified: true, locationVerified: true },
        readOnly: true,
      };
    } catch {
      record('unavailable', correlationId);
      if (generation === ownGeneration && (!ownClient || client === ownClient)) {
        phase = 'error';
        lastError = 'composio_read_unavailable';
        retryAfter = now() + 5_000;
        const failed = client;
        client = null;
        generation++;
        void failed?.close().catch(() => {});
      }
      return { ok: false, result: 'composio_read_unavailable' };
    }
  }
  async function close() {
    generation++;
    for (const c of activeControllers) c.abort();
    const old = client;
    client = null;
    phase = config.reason || 'unavailable';
    await old?.close().catch(() => {});
  }
  return {
    read,
    status,
    close,
    audit: () => events.map((e) => ({ ...e })),
    deny: () => record('denied', randomUUID()),
  };
}

export async function routeComposioAgentRead(connection, params = {}) {
  const command = String(params.command || params.text || '').trim();
  const explicit = params.composioOperation !== undefined;
  const matched =
    /^(?:(?:ava|rex)[,:]?\s+)?(?:check|verify|read)\s+(?:the\s+)?composio\s+qa\s+contact[.!?]?$/i.test(
      command
    );
  if (!explicit && !matched) return null;
  const agentId = String(
    params.agentId || params.agent || (/^rex\b/i.test(command) ? 'rex' : 'ava')
  ).toLowerCase();
  // Explicit payloads never gain an arbitrary argument channel.
  const hasOverride = (v, depth = 0) =>
    depth > 8 ||
    (v &&
      typeof v === 'object' &&
      Object.entries(v).some(
        ([k, child]) =>
          /^(?:arguments|toolName|headers|url|accountId|locationId|approvalId|composioArguments|connected_accounts|connectedAccounts|account_id|location_id)$/i.test(
            k
          ) || hasOverride(child, depth + 1)
      ));
  if (hasOverride(params)) {
    connection.deny?.();
    return {
      ok: false,
      routedTo: 'tool_first:composio_read',
      response: { answer: 'That read is outside the approved sandbox scope.' },
    };
  }
  const result = await connection.read({
    operation: explicit ? params.composioOperation : 'qa-contact',
    agentId,
  });
  return {
    ok: result.ok,
    routedTo: 'tool_first:composio_read',
    response: {
      ...result,
      answer: result.ok
        ? 'The sandbox QA contact is verified. DND is on, and the record remains excluded from sales priority.'
        : 'The sandbox read is unavailable. Check the Composio connection status in Settings.',
    },
  };
}
