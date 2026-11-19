import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposioResearchDiscovery } from './composio-research-discovery.mjs';

const checkedAt = '2026-11-19T12:00:00.000Z';
const enabled = () => ({
  COMPOSIO_API_KEY: 'test-only-credential',
  PBK_COMPOSIO_RESEARCH_ENABLED: 'true',
});
const item = {
  slug: 'COMPOSIO_SEARCH_WEB',
  toolkit: { slug: 'composio_search' },
  version: '20261119_00',
};
const response = (value) => new Response(JSON.stringify(value));
const readWith = (fetchImpl, env = enabled()) =>
  createComposioResearchDiscovery({ env, fetchImpl, now: () => checkedAt });

test('configured but disabled stays local, with no fabricated check time', async () => {
  for (const flag of [undefined, 'false', 'TRUE', true]) {
    const read = readWith(
      () => {
        throw new Error('Unexpected fetch');
      },
      { COMPOSIO_API_KEY: 'test-only-credential', PBK_COMPOSIO_RESEARCH_ENABLED: flag }
    );
    const result = await read();
    assert.equal(result.status, 'disabled');
    assert.equal('checkedAt' in result, false);
    assert.deepEqual(result.tools, []);
  }
});

test('configuration is evaluated lazily on each explicit read', async () => {
  const env = {};
  let calls = 0;
  const read = readWith(async () => {
    calls += 1;
    return response({ items: [item] });
  }, env);
  assert.equal(calls, 0);
  assert.equal((await read()).status, 'not_configured');
  Object.assign(env, enabled());
  assert.equal((await read()).status, 'matched');
  assert.equal(calls, 1);
});

test('only the fixed catalog URL and authentication header cross the provider boundary', async () => {
  let calls = 0;
  const read = readWith(async (url, options) => {
    calls += 1;
    const target = new URL(url);
    assert.equal(target.origin + target.pathname, 'https://backend.composio.dev/api/v3.1/tools');
    assert.deepEqual(
      [...target.searchParams.entries()],
      [
        ['tool_slugs', 'COMPOSIO_SEARCH_WEB'],
        ['toolkit_versions[composio_search]', '20261119_00'],
      ]
    );
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-api-key'], 'test-only-credential');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return response({ items: [item] });
  });
  assert.equal(
    (await read({ query: 'private customer data', url: 'https://example.invalid' })).status,
    'matched'
  );
  assert.equal(calls, 1);
});

test('matched tools project server-owned metadata and discard provider prose, schemas and URLs', async () => {
  const result = await readWith(async () =>
    response({
      items: [
        {
          ...item,
          name: 'untrusted',
          description: 'test-only-credential',
          url: 'https://example.invalid',
          input_parameters: { secret: true },
          runnable: true,
        },
        item,
      ],
    })
  )();
  assert.deepEqual(
    { ...result, note: undefined },
    {
      source: 'composio',
      status: 'matched',
      discoveryOnly: true,
      checkedAt,
      tools: [
        {
          slug: 'COMPOSIO_SEARCH_WEB',
          name: 'Public web research',
          version: '20261119_00',
          inputFields: ['query'],
          scope: 'public_web',
          runnable: false,
        },
      ],
      note: undefined,
    }
  );
  assert.match(result.note, /catalog/i);
  assert.doesNotMatch(
    JSON.stringify(result),
    /untrusted|test-only-credential|example.invalid|input_parameters/
  );
});

test('unknown slug, toolkit and version cannot become catalog matches', async () => {
  for (const candidate of [
    { ...item, slug: 'OTHER_TOOL' },
    { ...item, toolkit: { slug: 'other' } },
    { ...item, version: 'latest' },
    { ...item, version: undefined, available_versions: ['20261119_00'] },
    { ...item, toolkit: null },
    null,
  ]) {
    const result = await readWith(async () => response({ items: [candidate] }))();
    assert.equal(result.status, 'not_found');
    assert.deepEqual(result.tools, []);
  }
});

test('malformed JSON and catalog envelopes return a redacted unavailable status', async () => {
  for (const body of ['{broken test-only-credential', 'null', '{}', '{"items":{}}']) {
    const result = await readWith(async () => new Response(body))();
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.tools, []);
    assert.doesNotMatch(JSON.stringify(result), /test-only-credential|broken/);
  }
});

test('HTTP failures are classified, never retried, and never read or exposed', async () => {
  for (const [status, expected] of [
    [401, 'authorization_failed'],
    [403, 'authorization_failed'],
    [429, 'rate_limited'],
    [302, 'unavailable'],
    [500, 'unavailable'],
  ]) {
    let calls = 0;
    const result = await readWith(async () => {
      calls += 1;
      return new Response('test-only-credential', { status });
    })();
    assert.equal(result.status, expected);
    assert.equal(result.checkedAt, checkedAt);
    assert.deepEqual(result.tools, []);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /test-only-credential/);
  }
});

test('network and redirect rejection messages never escape', async () => {
  let calls = 0;
  const result = await readWith(async () => {
    calls += 1;
    throw new Error('test-only-credential https://example.invalid/?secret=private');
  })();
  assert.equal(result.status, 'unavailable');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /test-only-credential|example.invalid|private/);
});

test('stream byte limit is enforced before parsing, even with misleading content length', async () => {
  let cancelled = false;
  const prefix = JSON.stringify({ items: [item] });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(prefix));
      controller.enqueue(new Uint8Array(256 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readWith(
    async () => new Response(stream, { headers: { 'content-length': '1' } })
  )();
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.tools, []);
  assert.equal(cancelled, true);
});

test('exactly 256 KiB is allowed and multi-byte overflow is rejected by bytes', async () => {
  const prefix = JSON.stringify({ items: [item] });
  const allowed = prefix + ' '.repeat(256 * 1024 - Buffer.byteLength(prefix));
  assert.equal((await readWith(async () => new Response(allowed))()).status, 'matched');
  assert.equal((await readWith(async () => new Response(allowed + 'é'))()).status, 'unavailable');
});

test(
  'one 10-second deadline covers fetch and streamed body completion, including uncooperative promises',
  { timeout: 12000 },
  async () => {
    const signals = [];
    let cancelled = false;
    const hangingFetch = readWith(async (_url, options) => {
      signals.push(options.signal);
      return new Promise(() => {});
    });
    const hangingBody = readWith(async (_url, options) => {
      signals.push(options.signal);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"items":'));
          },
          cancel() {
            cancelled = true;
          },
        })
      );
    });
    const results = await Promise.all([hangingFetch(), hangingBody()]);
    for (const result of results) {
      assert.equal(result.status, 'timed_out');
      assert.equal(result.checkedAt, checkedAt);
      assert.deepEqual(result.tools, []);
    }
    assert.ok(signals.every((signal) => signal.aborted));
    assert.equal(cancelled, true);
  }
);

test('missing configuration returns an honest status without reading the provider', async () => {
  let requests = 0;
  const read = createComposioResearchDiscovery({
    env: {},
    fetchImpl: async () => {
      requests += 1;
      throw new Error('Unexpected external call');
    },
    now: () => {
      throw new Error('No provider timestamp without a request');
    },
  });
  const result = await read();
  assert.equal(result.status, 'not_configured');
  assert.equal(result.source, 'composio');
  assert.equal(result.discoveryOnly, true);
  assert.deepEqual(result.tools, []);
  assert.equal('checkedAt' in result, false);
  assert.equal(requests, 0);
});
