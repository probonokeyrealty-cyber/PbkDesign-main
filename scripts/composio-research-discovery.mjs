const CATALOG_URL = 'https://backend.composio.dev/api/v3.1/tools';
const TOOL_SLUG = 'COMPOSIO_SEARCH_WEB';
const TOOLKIT_SLUG = 'composio_search';
const VERSION = '20261119_00';
const MAX_BYTES = 256 * 1024;
const NOTES = {
  matched:
    'Catalog metadata found for public web research. This does not confirm account access, agent readiness, or tool execution.',
  not_configured: 'Composio research is not configured.',
  disabled: 'Composio research inspection is disabled.',
  authorization_failed: 'Catalog authorization failed. No tools were executed.',
  rate_limited: 'Catalog inspection was rate limited. Try again later.',
  timed_out: 'Catalog inspection timed out. No tools were executed.',
  unavailable: 'Catalog inspection is unavailable. No tools were executed.',
  not_found: 'The approved public web research tool version was not found in the catalog.',
};

function result(status, checkedAt) {
  return {
    source: 'composio',
    status,
    discoveryOnly: true,
    ...(checkedAt === undefined ? {} : { checkedAt }),
    tools:
      status === 'matched'
        ? [
            {
              slug: TOOL_SLUG,
              name: 'Public web research',
              version: VERSION,
              inputFields: ['query'],
              scope: 'public_web',
              runnable: false,
            },
          ]
        : [],
    note: NOTES[status],
  };
}

// Configuration is read only when the caller explicitly requests inspection.
export function createComposioResearchDiscovery({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
} = {}) {
  return async function readComposioResearch() {
    const key = typeof env.COMPOSIO_API_KEY === 'string' ? env.COMPOSIO_API_KEY.trim() : '';
    if (!key) return result('not_configured');
    if (env.PBK_COMPOSIO_RESEARCH_ENABLED !== 'true') return result('disabled');

    const checkedAt = now();
    const controller = new AbortController();
    let reader;
    let timer;
    let timedOut = false;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('Catalog deadline exceeded'));
      }, 10_000);
    });

    const inspect = async () => {
      const url = new URL(CATALOG_URL);
      url.searchParams.set('tool_slugs', TOOL_SLUG);
      url.searchParams.set(`toolkit_versions[${TOOLKIT_SLUG}]`, VERSION);
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'x-api-key': key },
        redirect: 'error',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Catalog deadline exceeded');
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) return 'authorization_failed';
        if (response.status === 429) return 'rate_limited';
        return 'unavailable';
      }
      reader = response.body?.getReader();
      if (!reader) return 'unavailable';
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) throw new Error('Catalog deadline exceeded');
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('Catalog body exceeded limit');
        chunks.push(value);
      }
      const catalog = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
      if (!catalog || !Array.isArray(catalog.items)) return 'unavailable';
      return catalog.items.some(
        (entry) =>
          entry?.slug === TOOL_SLUG &&
          entry?.toolkit?.slug === TOOLKIT_SLUG &&
          entry?.version === VERSION
      )
        ? 'matched'
        : 'not_found';
    };

    try {
      return result(await Promise.race([inspect(), deadline]), checkedAt);
    } catch {
      // Provider response bodies, credentials and error messages never enter the DTO.
      return result(timedOut ? 'timed_out' : 'unavailable', checkedAt);
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Cleanup must not extend the deadline if a provider stream ignores cancellation.
      if (reader) void reader.cancel().catch(() => {});
    }
  };
}
