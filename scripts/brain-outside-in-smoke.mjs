const BASE_URL = String(process.env.PBK_HOSTED_BRIDGE_URL || 'https://pbk-openclaw-bridge.onrender.com')
  .trim()
  .replace(/\/+$/g, '');
const API_KEY = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function authHeaders(contentType = false) {
  assert(API_KEY, 'PBK_BRIDGE_API_KEY is required for outside-in Brain smoke tests.');
  return {
    Authorization: `Bearer ${API_KEY}`,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { response, parsed };
}

function getProviderKey(result = {}) {
  const raw = [
    result.webSearchProvider,
    result.provider?.name,
    result.provider?.provider,
    result.provider?.mode,
    result.provider?.model,
    typeof result.provider === 'string' ? result.provider : '',
    result.result,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/deepseek/.test(raw)) return 'deepseek';
  if (/openai|gpt|responses-web-search|web_search/.test(raw)) return 'openai';
  if (/tavily/.test(raw)) return 'tavily';
  if (/brain/.test(raw)) return 'pbk_brain';
  return 'unknown';
}

async function main() {
  const { response: healthResponse, parsed: health } = await requestJson('/health');
  assert(healthResponse.ok && health?.ok === true, `Hosted /health failed with ${healthResponse.status}.`);
  assert(health?.features?.authRequired === true, 'Hosted bridge must require auth for outside-in Brain checks.');

  const unauthorized = await fetch(`${BASE_URL}/api/brain/query?q=outside-in-check`);
  assert(unauthorized.status === 401, `Expected unauthenticated /api/brain/query to return 401, got ${unauthorized.status}.`);

  const { response: statusResponse, parsed: webStatus } = await requestJson('/api/brain/web-search/status', {
    headers: authHeaders(),
  });
  assert(statusResponse.ok && webStatus?.ok === true, `Brain web-search status failed with ${statusResponse.status}.`);
  assert(webStatus?.status?.fallbackProvider === 'deepseek' || webStatus?.status?.deepSeekFallbackReady !== undefined, 'Brain web-search status did not expose DeepSeek fallback readiness.');

  const { response: queryResponse, parsed: brainQuery } = await requestJson('/api/brain/query', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      query: 'PBK outside-in Brain check: summarize Ava/Rex status, no provider writes.',
      readOnly: true,
      noProviderWrites: true,
      source: 'brain-outside-in-smoke',
    }),
  });
  assert(queryResponse.ok, `Brain query returned ${queryResponse.status}.`);
  assert(brainQuery?.answer || brainQuery?.result?.answer, 'Brain query did not return an answer.');

  const { response: retrieveResponse, parsed: retrieve } = await requestJson('/api/brain/retrieve', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      query: 'probate seller objection handling trust script',
      source: 'brain-outside-in-smoke',
    }),
  });
  assert(retrieveResponse.ok, `Brain retrieve returned ${retrieveResponse.status}.`);
  assert(retrieve?.ok === true || retrieve?.result === 'closing_intelligence', 'Brain retrieve did not return a successful closing-intelligence response.');

  const { response: invokeResponse, parsed: invoke } = await requestJson('/invoke', {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify({
      toolName: 'getBrainState',
      params: {
        query: 'Use live web search for the current PBK provider fallback check. If OpenAI quota fails, use DeepSeek fallback. No provider writes.',
        webSearch: true,
        fallback: true,
        readOnly: true,
        noProviderWrites: true,
        source: 'brain-outside-in-smoke',
      },
    }),
  });
  assert(invokeResponse.ok && invoke?.ok === true, `Brain getBrainState invoke failed with ${invokeResponse.status}.`);
  const result = invoke?.result || {};
  assert(result.webSearch || result.openAiWebSearch, 'Brain getBrainState did not expose web-search metadata.');
  const providerKey = getProviderKey(result.webSearch || result.openAiWebSearch || result);
  assert(['tavily', 'openai', 'deepseek', 'pbk_brain'].includes(providerKey), `Unexpected Brain web-search provider: ${providerKey}.`);
  if (providerKey === 'pbk_brain') {
    assert(result.webSearch?.fallback || result.openAiWebSearch?.fallback || /fallback/i.test(String(result.answer || '')), 'PBK Brain provider result did not identify fallback behavior.');
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl: BASE_URL,
    revision: health.revision,
    stateBackend: health?.features?.stateBackend,
    webSearchStatus: webStatus.status || webStatus,
    invokedProvider: providerKey,
    deepSeekFallbackActive: result.deepSeekFallbackActive === true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
