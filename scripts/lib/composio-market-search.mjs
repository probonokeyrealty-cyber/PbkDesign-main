import { connectComposioHttp, schemaFingerprint } from './public-market-mcp.mjs';
import { normalizePublicEvidence } from './public-market-worker.mjs';
const TOOL = 'COMPOSIO_SEARCH_WEB';
const EXA_TOOL = 'EXA_ANSWER';
const EXA_USER = 'pbk-public-market-research-staging';
const EXA_SCHEMA_SHA256 = 'b013594caba3ca649fa9d041459e0729cdededeb07a9635a987ab57ebe41d47d';
const API = 'https://backend.composio.dev/api/v3.1';
// The reviewed REST catalog schema differs from the separately pinned MCP inputSchema.
const REST_SCHEMA_SHA256 = 'cafda083ef8419a8de5b5f7fa078ff25f852a9a0a49e0bbaeb3447e6b5f42380';
const only = (a, value) => Array.isArray(a) && a.length === 1 && a[0] === value;
export function verifyMarketSearchSession(config, session) {
  const c = session?.config;
  const exa = config.userId === EXA_USER;
  const toolkit = exa ? 'exa' : 'composio_search';
  const tool = exa ? EXA_TOOL : TOOL;
  const accounts = c?.connected_accounts ?? {};
  return (
    session?.session_id === config.sessionId &&
    session.config_version === config.version &&
    session.mcp?.url === config.url &&
    c?.user_id === config.userId &&
    only(c.toolkits?.enabled, toolkit) &&
    only(Object.keys(c.tools ?? {}), toolkit) &&
    only(c.tools?.[toolkit]?.enabled, tool) &&
    only(c.preload?.tools, tool) &&
    (exa
      ? /^ca_[A-Za-z0-9_-]{1,80}$/.test(config.exaAccountId ?? '') &&
        only(session.tool_router_tools, EXA_TOOL) &&
        only(Object.keys(accounts), 'exa') &&
        only(accounts.exa, config.exaAccountId) &&
        c.manage_connections?.enable_wait_for_connections === false &&
        c.manage_connections?.enable_connection_removal === false
      : Object.keys(accounts).length === 0) &&
    Object.keys(c.auth_configs ?? {}).length === 0 &&
    c.instant === false &&
    c.manage_connections?.enabled === false &&
    c.workbench?.enable === false &&
    c.proxy_execute?.enable === false &&
    c.search?.enable === false &&
    c.multi_account?.enable === false &&
    c.execute?.enable_multi_execute === false
  );
}
const sessionPath = (config) => '/tool_router/session/' + encodeURIComponent(config.sessionId);
async function readProviderJson(fetchImpl, path, config, signal, body) {
  const r = await fetchImpl(API + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'x-api-key': config.key,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw Error('provider_http');
  }
  let bytes = 0;
  const stream = r.body.pipeThrough(
    new TransformStream({
      transform(chunk, c) {
        bytes += chunk.length;
        if (bytes > 2000000) {
          c.error(Error('response_limit'));
          return;
        }
        c.enqueue(chunk);
      },
    })
  );
  return new Response(stream).json();
}
async function verify(config, signal, fetchImpl) {
  const session = await readProviderJson(fetchImpl, sessionPath(config), config, signal);
  return verifyMarketSearchSession(config, session) ? session : null;
}
async function executeWithRest(fetchImpl, config, signal, session, query) {
  if (!verifyMarketSearchSession(config, session) || !only(session.tool_router_tools, TOOL))
    throw Error('scope');
  const catalog = await readProviderJson(fetchImpl, '/tools/' + TOOL, config, signal);
  if (
    catalog?.slug !== TOOL ||
    catalog.toolkit?.slug !== 'composio_search' ||
    catalog.no_auth !== true ||
    schemaFingerprint(catalog.input_parameters) !== REST_SCHEMA_SHA256
  )
    throw Error('schema');
  signal.throwIfAborted();
  const result = await readProviderJson(fetchImpl, sessionPath(config) + '/execute', config, signal, {
    tool_slug: TOOL,
    arguments: { query },
  });
  if (!result || result.error || (result.result_type !== undefined && result.result_type !== 'completed'))
    throw Error('provider');
  if (Object.hasOwn(result, 'successful')) return result;
  if (Object.hasOwn(result.data ?? {}, 'successful')) return result.data;
  return { successful: true, data: result.data };
}
export function createComposioMarketSearch({
  env = process.env,
  connect = connectComposioHttp,
  verify: verifyScope = verify,
  fetchImpl = globalThis.fetch,
} = {}) {
  const enabled = env.PBK_COMPOSIO_MARKET_SEARCH_ENABLED === 'true';
  const key = String(env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY ?? '').trim(),
    sessionId = env.PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID,
    userId = env.PBK_COMPOSIO_MARKET_SEARCH_USER_ID,
    version = Number(env.PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION),
    hash = env.PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256;
  const exa = userId === EXA_USER;
  const exaAccountId = env.PBK_COMPOSIO_MARKET_SEARCH_EXA_ACCOUNT_ID;
  const tool = exa ? EXA_TOOL : TOOL;
  const configured = !!(
    key &&
    /^[a-f0-9]{64}$/.test(hash ?? '') &&
    (exa
      ? /^ca_[A-Za-z0-9_-]{1,80}$/.test(exaAccountId ?? '') && hash === EXA_SCHEMA_SHA256
      : !exaAccountId) &&
    /^trs_[A-Za-z0-9_-]{1,80}$/.test(sessionId ?? '') &&
    typeof userId === 'string' &&
    userId.length > 0 &&
    userId.length <= 100 &&
    Number.isSafeInteger(version) &&
    version > 0 &&
    ![env.PBK_BRIDGE_API_KEY, env.PBK_COMPOSIO_INBOUND_TOKEN].some(
      (other) => other && String(other).trim() === key
    )
  );
  const config = {
    key,
    sessionId,
    userId,
    version,
    exaAccountId,
    url: `https://backend.composio.dev/tool_router/${sessionId}/mcp`,
  };
  const status = () => ({
    enabled,
    configured,
    state: !enabled ? 'disabled' : !configured ? 'configuration_missing' : 'unverified',
  });
  async function search(query) {
    if (!enabled || !configured) return { ok: false, live: false, result: status().state };
    if (
      typeof query !== 'string' ||
      !query.trim() ||
      query.length > 600 ||
      /\b(?:ak_|sk-|e2b_)[A-Za-z0-9_-]{12,}/i.test(query)
    )
      return { ok: false, live: false, result: 'public_search_denied' };
    const signal = AbortSignal.timeout(20000);
    let client;
    try {
      const session = await verifyScope(config, signal, fetchImpl);
      if (!session || (exa && !verifyMarketSearchSession(config, session))) throw Error('scope');
      client = await connect(config, signal);
      if (signal.aborted) throw Error('expired');
      let useRest = false;
      let listing;
      try {
        listing = await client.listTools({}, { signal, timeout: 20000 });
      } catch (error) {
        if (exa || error?.code !== -32601 || signal.aborted) throw error;
        useRest = true;
      }
      let data;
      if (useRest) {
        data = await executeWithRest(fetchImpl, config, signal, session, query);
      } else {
        if (
          listing?.tools?.length !== 1 ||
          listing.nextCursor ||
          listing.tools[0].name !== tool ||
          schemaFingerprint(listing.tools[0].inputSchema) !== hash
        )
          throw Error('schema');
        const args = exa ? { query, model: 'exa', stream: false, text: false } : { query };
        const result = await client.callTool({ name: tool, arguments: args }, undefined, {
          signal,
          timeout: 20000,
        });
        if (result.isError || signal.aborted) throw Error('provider');
        data = result.structuredContent;
        if (!data) {
          const text =
            result.content
              ?.filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('') ?? '';
          if (text.length > 2000000) throw Error('limit');
          data = JSON.parse(text);
        }
      }
      if (signal.aborted || data?.successful !== true || !Array.isArray(data.data?.citations))
        throw Error('result');
      const evidence = normalizePublicEvidence({
        ok: true,
        live: true,
        answer: data.data.answer,
        citations: data.data.citations.map((c) => c?.url),
      });
      return { ok: true, live: true, ...evidence };
    } catch {
      return { ok: false, live: false, result: 'public_search_unavailable' };
    } finally {
      await client?.close().catch(() => {});
    }
  }
  return { status, search };
}
