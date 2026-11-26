import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, jest, test } from '@jest/globals';
import { readDeepSeekStream } from './ava-deepseek-stream.mjs';
import { createProxyFixture } from './fixtures/netlify-proxy-qa.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const encode = text => new TextEncoder().encode(text);
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const part = text => frame({ choices: [{ delta: { content: text } }] });
const end = frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';

afterEach(() => jest.useRealTimers());

function fixture(fetch) {
  const context = vm.createContext({
    AbortController, AbortSignal, Date, Response, fetch, readDeepSeekStream,
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id),
    toNumber: (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback,
    getDeepSeekProviderMeta: () => ({ ready: true, model: 'fixture-model' }),
    DEEPSEEK_MODEL: 'fixture-model', DEEPSEEK_THINKING_MODE: 'disabled',
    DEEPSEEK_TIMEOUT_MS: 30_000, DEEPSEEK_BASE_URL: 'https://model.invalid',
    DEEPSEEK_STRICT_TOOL_MODE: 'disabled', DEEPSEEK_REASONING_EXPOSURE: 'disabled',
    DEEPSEEK_STRICT_TOOL_BASE_URL: 'https://model.invalid', DEEPSEEK_API_KEY: 'fixture-only',
    normalizeDeepSeekToolsForStrictMode: () => [],
    ensureDeepSeekJsonModeMessages: messages => messages,
    readDeepSpecConfig: () => ({}), isDeepSpecConfigured: () => false,
    executeProviderCircuitGuard: (_, run) => run(), isRetryableDeepSeekResult: () => false,
    process: { env: {} }, buildDeepSeekReasoningPolicy: () => ({}),
    observeUsagePersistence: run => run(), recordTokenUsage: async () => ({ ok: true }),
    sanitizeDeepSeekToolCalls: calls => calls,
  });
  const start = source.indexOf('async function runDeepSeekChatCompletion(');
  const finish = source.indexOf('\nfunction buildDeepSeekLiveRetryModels(', start);
  vm.runInContext(source.slice(start, finish), context);
  return context;
}

test('only an explicit long-chat request can exceed the ordinary 4096-token provider ceiling', async () => {
  const bodies = [];
  const context = fixture(async (_, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ error: { message: 'fixture rejection' } }, { status: 400 });
  });
  await context.runDeepSeekChatCompletion([], { maxTokens: 32_768, longReply: true });
  await context.runDeepSeekChatCompletion([], { maxTokens: 32_768 });
  await context.runDeepSeekChatCompletion([], { maxTokens: 99_999, longReply: true });
  assert.deepEqual(bodies.map(body => body.max_tokens), [32_768, 4096, 32_768]);
});

test('active provider text continues beyond 30/60/90 seconds without resetting the absolute budget', async () => {
  jest.useFakeTimers();
  let upstream;
  const response = new Response(new ReadableStream({ start(c) { upstream = c; } }));
  const context = fixture(async () => response);
  const deltas = [];
  const pending = context.runDeepSeekChatCompletion([], {
    longReply: true, maxTokens: 32_768, attemptTimeoutMs: 600_000,
    deadlineAt: Date.now() + 600_000, streamIdleTimeoutMs: 90_000,
    streamPreviewFactory: () => ({ emitted: false, write: delta => deltas.push(delta) }),
  });
  await jest.advanceTimersByTimeAsync(60_000);
  upstream.enqueue(encode(part('First complete sentence. ')));
  await jest.advanceTimersByTimeAsync(60_000);
  upstream.enqueue(encode(part('The complete final sentence.') + end));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.answer, 'First complete sentence. The complete final sentence.');
  assert.equal(deltas.length, 2);
});

test('a silent provider stream is cancelled by the inactivity watchdog', async () => {
  jest.useFakeTimers();
  let cancelled = false;
  const context = fixture(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const pending = context.runDeepSeekChatCompletion([], {
    attemptTimeoutMs: 600_000, deadlineAt: Date.now() + 600_000, streamIdleTimeoutMs: 90_000,
    streamPreviewFactory: () => ({ emitted: false, write() {} }),
  });
  await jest.advanceTimersByTimeAsync(90_000);
  const cancelledOnTime = cancelled;
  if (!cancelledOnTime) await jest.advanceTimersByTimeAsync(510_000);
  const result = await pending;
  assert.equal(cancelledOnTime, true, 'inactivity should stop the read before the overall deadline');
  assert.equal(result.result, 'provider_timeout');
  assert.equal(cancelled, true);
});

test('provider progress cannot extend the shared deadline and cancellation is never retried', async () => {
  jest.useFakeTimers();
  let upstream;
  let calls = 0;
  const context = fixture(async () => { calls++; return new Response(new ReadableStream({ start(c) { upstream = c; } })); });
  const pending = context.runDeepSeekChatCompletion([], {
    attemptTimeoutMs: 600_000, deadlineAt: Date.now() + 100_000, streamIdleTimeoutMs: 90_000,
    streamPreviewFactory: () => ({ emitted: true, write() {} }), retryAttempts: 2,
  });
  await jest.advanceTimersByTimeAsync(60_000);
  upstream.enqueue(encode(part('Progress does not authorize more time. ')));
  await jest.advanceTimersByTimeAsync(40_000);
  assert.equal((await pending).result, 'provider_timeout');
  assert.equal(calls, 1);
});

test('large streamed JSON has bounded headroom without dropping the complete final tail', async () => {
  const answer = `${'Detailed sentence. '.repeat(9000)}The real ending.`;
  const response = new Response(part(answer) + end);
  const result = await readDeepSeekStream(response, { maxContentCharacters: 1_048_576 });
  assert.equal(result.choices[0].message.content, answer);
});

test('only existing allowed staff origins can send the existing team-session header directly', () => {
  const context = vm.createContext({ URL, HOST: '127.0.0.1', PORT: 4000, process: { env: {} } });
  const start = source.indexOf('const BRIDGE_DEFAULT_ALLOWED_ORIGINS =');
  const finish = source.indexOf('\nconst COMMAND_CENTER_APP_PATHS', start);
  vm.runInContext(source.slice(start, finish), context);
  const headers = context.buildBridgeCorsHeaders({ headers: { origin: 'https://pbkcenter.netlify.app' } });
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://pbkcenter.netlify.app');
  assert.match(headers['Access-Control-Allow-Headers'], /\bX-PBK-Team-Token\b/i);
  const untrusted = context.buildBridgeCorsHeaders({ headers: { origin: 'https://untrusted.invalid' } });
  assert.equal(untrusted['Access-Control-Allow-Origin'], undefined);
  assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
  for (const origin of ['https://deploy-preview-15--pbkcenter.netlify.app', 'https://branch-qa--pbkcenter.netlify.app', 'https://6afa40b3ea9cdd470f406b84--pbkcenter.netlify.app']) {
    assert.equal(context.buildBridgeCorsHeaders({ headers: { origin } })['Access-Control-Allow-Origin'], origin);
  }
  for (const origin of ['http://branch-qa--pbkcenter.netlify.app', 'https://branch-qa--other-site.netlify.app', 'https://branch-qa--pbkcenter.netlify.app.evil.invalid', 'https://pbkcenter.netlify.app@evil.invalid', 'https://branch-qa--pbkcenter.netlify.app:8443']) {
    assert.equal(context.buildBridgeCorsHeaders({ headers: { origin } })['Access-Control-Allow-Origin'], undefined);
  }
});

test('direct chat preserves the same restricted-operator permissions as the existing proxy', async () => {
  const context = vm.createContext({});
  if (source.includes("from './ava-team-chat-permissions.mjs'")) {
    const helper = readFileSync(new URL('./ava-team-chat-permissions.mjs', import.meta.url), 'utf8');
    vm.runInContext(helper.replaceAll('export function', 'function'), context);
  }
  const start = source.indexOf('function authorizeDirectTeamBridgeRequest(');
  const finish = source.indexOf('\nfunction getTeamApprovalRestriction(', start);
  vm.runInContext(source.slice(start, finish), context);
  const cases = [
    ['canPlaceCalls', 'Prepare a call to this seller before dialing.'],
    ['canSendSms', 'Draft a text message to the seller.'],
    ['canSendEmail', 'Compose an email to this owner.'],
    ['canApproveProviderActions', 'Approve the provider request.'],
  ];
  for (const [permission, message] of cases) {
    const permissions = Object.fromEntries(cases.map(([key]) => [key, key !== permission]));
    const proxy = createProxyFixture(async target => Response.json(new URL(target).pathname === '/api/auth/team/verify'
      ? { ok: true, permissions } : { ok: true }));
    for (const body of [{ message }, { message: 'Review my last call.', messages: [{ role: 'user', content: message }] }]) {
      const direct = context.authorizeDirectTeamBridgeRequest({ method: 'POST', pathname: '/api/assistant/chat', body, permissions });
      assert.equal(direct.statusCode, 403, permission + ' must remain enforced before chat');
      assert.equal(direct.permission, permission);
      const response = await proxy({ httpMethod: 'POST', path: '/.netlify/functions/pbk-bridge-proxy',
        queryStringParameters: { path: '/api/assistant/chat' }, headers: { 'x-pbk-team-token': 'fixture-team' }, body: JSON.stringify(body) });
      assert.equal(response.statusCode, direct.statusCode);
      assert.equal(JSON.parse(response.body).permission, direct.permission);
    }
  }
  assert.equal(context.authorizeDirectTeamBridgeRequest({ method: 'POST', pathname: '/api/assistant/chat', body: { message: 'Explain clear spoken communication.' }, permissions: {} }).ok, true);
  assert.equal(context.authorizeDirectTeamBridgeRequest({ method: 'POST', pathname: '/api/assistant/chat', body: { message: 'Summarize the latest call recording.' }, permissions: {} }).ok, true);
});
