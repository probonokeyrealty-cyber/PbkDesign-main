import { createHash } from 'node:crypto';

const COMPOSIO = 'https://backend.composio.dev';
const E2B_INVENTORY = 'https://api.e2b.app/v2/sandboxes?limit=1';
const TOOLKIT = 'composio_search';
const TOOL = 'COMPOSIO_SEARCH_WEB';
const only = (values, value) => Array.isArray(values) && values.length === 1 && values[0] === value;
const empty = (value) => value == null || (typeof value === 'object' && !Object.keys(value).length);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hasPinnedScope(session, { sessionId, userId, version }) {
  const scope = session?.config;
  return session?.session_id === sessionId &&
    session.config_version === version &&
    session.mcp?.url === `${COMPOSIO}/tool_router/${sessionId}/mcp` &&
    only(session.tool_router_tools, TOOL) &&
    scope?.user_id === userId &&
    only(scope.toolkits?.enabled, TOOLKIT) &&
    only(Object.keys(scope.tools ?? {}), TOOLKIT) &&
    only(scope.tools?.[TOOLKIT]?.enabled, TOOL) &&
    only(scope.preload?.tools, TOOL) &&
    empty(scope.connected_accounts) &&
    empty(scope.auth_configs) &&
    scope.instant === false &&
    scope.manage_connections?.enabled === false &&
    scope.workbench?.enable === false &&
    scope.proxy_execute?.enable === false &&
    scope.search?.enable === false &&
    scope.multi_account?.enable === false &&
    scope.execute?.enable_multi_execute === false;
}

function hasPinnedTool(item, hash) {
  return item?.slug === TOOL && item.toolkit?.slug === TOOLKIT && item.no_auth === true &&
    createHash('sha256').update(JSON.stringify(canonical(item.input_parameters ?? null))).digest('hex') === hash;
}

async function readSmallJson(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    return null;
  }
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > 128 * 1024) throw new Error('Provider metadata response exceeded limit.');
      controller.enqueue(chunk);
    },
  }));
  return new Response(body).json();
}

export function createPublicMarketConnectionCheck({
  env = process.env,
  request = fetch,
  now = Date.now,
} = {}) {
  const enabled = env.PBK_E2B_MARKET_CONNECTION_CHECK_ENABLED === 'true';
  const e2bKey = env.PBK_E2B_MARKET_WORKER_API_KEY?.trim();
  const composioKey = env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY?.trim();
  const sessionId = env.PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID?.trim();
  const userId = env.PBK_COMPOSIO_MARKET_SEARCH_USER_ID?.trim();
  const version = Number(env.PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION);
  const hash = env.PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256?.trim();
  const configured = Boolean(
    e2bKey && composioKey && e2bKey !== composioKey &&
    ![env.PBK_BRIDGE_API_KEY, env.PBK_COMPOSIO_INBOUND_TOKEN, env.PBK_AVA_OUTLOOK_COMPOSIO_API_KEY]
      .some((other) => other && [e2bKey, composioKey].includes(other.trim())) &&
    /^trs_[A-Za-z0-9_-]{1,80}$/.test(sessionId ?? '') &&
    userId && userId.length <= 100 &&
    Number.isSafeInteger(version) && version > 0 &&
    /^[a-f0-9]{64}$/.test(hash ?? '')
  );

  const status = (state, note) => ({
    kind: 'public_market_worker',
    optional: true,
    enabled,
    configured: enabled && configured,
    connected: state === 'connected_unverified',
    ready: false,
    executionEnabled: false,
    lastSuccessAt: null,
    state,
    note,
  });
  const get = (url, key, signal) => request(url, {
    method: 'GET',
    headers: { 'x-api-key': key, accept: 'application/json' },
    redirect: 'error',
    signal,
  });

  let cached;
  let inFlight;
  async function probe() {
    const signal = AbortSignal.timeout(5000);
    const sessionUrl = `${COMPOSIO}/api/v3.1/tool_router/session/${sessionId}`;
    try {
      const [e2bOk, searchOk] = await Promise.all([
        get(E2B_INVENTORY, e2bKey, signal).then(async (response) => {
          await response.body?.cancel();
          return response.status === 200;
        }),
        (async () => {
          const session = await readSmallJson(await get(sessionUrl, composioKey, signal));
          if (!hasPinnedScope(session, { sessionId, userId, version })) return false;
          // The per-session REST listing can omit preloaded tools. Verify the
          // exact advertised set above and pin the public tool's catalog schema.
          const tool = await readSmallJson(await get(`${COMPOSIO}/api/v3.1/tools/${TOOL}`, composioKey, signal));
          return hasPinnedTool(tool, hash);
        })(),
      ]);
      if (e2bOk && searchOk) {
        return status('connected_unverified', 'E2B and the pinned Composio session passed read-only checks. No job was run.');
      }
    } catch {
      // Never return provider errors, credentials, or inventory to Settings.
    }
    return status('connection_unverified', 'Could not verify E2B or the pinned Composio scope. No job was run.');
  }

  return async function checkConnection() {
    if (!enabled) return status('disabled', 'E2B cloud execution is not enabled on this bridge.');
    if (!configured) return status('configuration_missing', 'Dedicated E2B and pinned Composio credentials are needed.');
    if (cached && now() < cached.expiresAt) return cached.value;
    inFlight ??= probe().then((value) => {
      cached = { value, expiresAt: now() + (value.connected ? 60000 : 15000) };
      return value;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
