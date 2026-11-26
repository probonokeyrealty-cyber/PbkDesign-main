import { createHash } from 'node:crypto';

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
