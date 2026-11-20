import { connectComposioHttp, schemaFingerprint } from './composio-connection.mjs';
import { normalizePublicEvidence } from './public-market-worker.mjs';
const TOOL = 'COMPOSIO_SEARCH_WEB';
const only = (a, value) => Array.isArray(a) && a.length === 1 && a[0] === value;
export function verifyMarketSearchSession(config, session) {
  const c = session?.config;
  return (
    session?.session_id === config.sessionId &&
    session.config_version === config.version &&
    session.mcp?.url === config.url &&
    c?.user_id === config.userId &&
    only(c.toolkits?.enabled, 'composio_search') &&
    only(c.tools?.composio_search?.enabled, TOOL) &&
    only(c.preload?.tools, TOOL) &&
    Object.keys(c.connected_accounts ?? {}).length === 0 &&
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
async function verify(config, signal) {
  const r = await fetch(
    'https://backend.composio.dev/api/v3.1/tool_router/session/' +
      encodeURIComponent(config.sessionId),
    { headers: { 'x-api-key': config.key }, redirect: 'error', signal }
  );
  if (!r.ok) {
    await r.body?.cancel();
    return false;
  }
  let bytes = 0;
  const body = r.body.pipeThrough(
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
  return verifyMarketSearchSession(config, await new Response(body).json());
}
export function createComposioMarketSearch({
  env = process.env,
  connect = connectComposioHttp,
  verify: verifyScope = verify,
} = {}) {
  const enabled = env.PBK_COMPOSIO_MARKET_SEARCH_ENABLED === 'true';
  const key = String(env.PBK_COMPOSIO_MARKET_SEARCH_API_KEY ?? '').trim(),
    sessionId = env.PBK_COMPOSIO_MARKET_SEARCH_SESSION_ID,
    userId = env.PBK_COMPOSIO_MARKET_SEARCH_USER_ID,
    version = Number(env.PBK_COMPOSIO_MARKET_SEARCH_CONFIG_VERSION),
    hash = env.PBK_COMPOSIO_MARKET_SEARCH_SCHEMA_SHA256;
  const configured = !!(
    key &&
    /^[a-f0-9]{64}$/.test(hash ?? '') &&
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
      if (!(await verifyScope(config, signal))) throw Error('scope');
      client = await connect(config, signal);
      if (signal.aborted) throw Error('expired');
      const listing = await client.listTools({}, { signal, timeout: 20000 });
      if (
        listing.tools?.length !== 1 ||
        listing.nextCursor ||
        listing.tools[0].name !== TOOL ||
        schemaFingerprint(listing.tools[0].inputSchema) !== hash
      )
        throw Error('schema');
      const result = await client.callTool({ name: TOOL, arguments: { query } }, undefined, {
        signal,
        timeout: 20000,
      });
      if (result.isError || signal.aborted) throw Error('provider');
      let data = result.structuredContent;
      if (!data) {
        const text =
          result.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('') ?? '';
        if (text.length > 2000000) throw Error('limit');
        data = JSON.parse(text);
      }
      if (data?.successful !== true || !Array.isArray(data.data?.citations)) throw Error('result');
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
