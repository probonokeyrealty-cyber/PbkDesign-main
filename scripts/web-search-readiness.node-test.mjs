import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the bridge's actual status builder without starting a server or calling providers.
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function getWebSearchProviderStatus()');
const end = source.indexOf('\nfunction getHermesProviderMeta', start);
assert(start >= 0 && end > start);
const body = source.slice(start, end);
const unavailable = { configured: false, ready: false, missing: ['test-provider-not-configured'] };
const available = { configured: true, ready: true, missing: [] };
function status({ tavily = unavailable, openAi = unavailable, deepSeek = unavailable } = {}) {
  const context = vm.createContext({
    getTavilyProviderMeta: () => tavily,
    getOpenAiWebSearchProviderMeta: () => openAi,
    getDeepSeekProviderMeta: () => deepSeek,
  });
  return JSON.parse(JSON.stringify(vm.runInContext(`${body}\ngetWebSearchProviderStatus()`, context)));
}

test('local knowledge fallback cannot make external web retrieval ready', () => {
  const result = status();
  assert.equal(result.ready, false);
  assert.equal(result.configured, false);
  assert.equal(result.liveReady, false);
  assert.equal(result.knowledgeFallbackAvailable, true);
  assert.equal(result.mode, 'pbk_brain-fallback');
  assert.match(result.note, /not configured/i);
  assert.match(result.note, /knowledge fallback/i);
});

test('a language-model fallback alone does not establish live web retrieval', () => {
  const result = status({ deepSeek: available });
  assert.equal(result.ready, false);
  assert.equal(result.liveReady, false);
  assert.equal(result.fallbackReady, true);
  assert.equal(result.mode, 'deepseek-fallback');
});

test('Tavily readiness reports external retrieval capability without claiming execution proof', () => {
  const result = status({ tavily: available });
  assert.equal(result.ready, true);
  assert.equal(result.configured, true);
  assert.equal(result.liveReady, true);
  assert.equal(result.mode, 'tavily-live');
  assert.deepEqual(result.missing, []);
  assert.match(result.note, /per request/i);
});

test('OpenAI web search is live retrieval and precedes the model fallback', () => {
  const result = status({ openAi: available, deepSeek: available });
  assert.equal(result.ready, true);
  assert.equal(result.liveReady, true);
  assert.equal(result.mode, 'openai-live');
  assert.equal(result.primaryProvider, 'openai');
  assert.deepEqual(result.missing, []);
});

test('configured but unavailable external provider stays unready', () => {
  const result = status({ tavily: { ...unavailable, configured: true } });
  assert.equal(result.configured, true);
  assert.equal(result.ready, false);
  assert.equal(result.liveReady, false);
});

test('provider details and existing neural-output contract remain available', () => {
  const result = status();
  assert.equal(result.providers.tavily.ready, false);
  assert.equal(result.providers.openAiWebSearch.ready, false);
  assert.deepEqual(result.neuralOutput.targetAgents, ['ava', 'rex']);
  assert.equal(result.statusEndpoint, '/api/brain/web-search/status');
  assert(result.missing.length > 0);
});

const summaryStart = source.indexOf('function summarizeProviderComponent(');
const summaryEnd = source.indexOf('\nfunction summarizeHealthComponents', summaryStart);
const summaryBody = source.slice(summaryStart, summaryEnd);
const summaryCalls = [...source.matchAll(/webSearch: (summarizeProviderComponent\(providers\.webSearch, \{[\s\S]*?\n    \}\))/g)];
assert.equal(summaryCalls.length, 2, 'Exercise both detailed and liveness health consumers');
for (const [index, match] of summaryCalls.entries()) {
  for (const ready of [false, true]) {
    test(`health consumer ${index + 1} preserves external retrieval readiness ${ready}`, () => {
      const metadata = status(ready ? { openAi: available } : {});
      const context = vm.createContext({ providers: { webSearch: metadata } });
      const result = vm.runInContext(`${summaryBody}\n${match[1]}`, context);
      assert.equal(result.ready, ready);
      assert.equal(result.configured, ready);
      assert.equal(result.status, ready ? 'up' : 'missing');
    });
  }
}
