import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isDeepSpecConfigured,
  readDeepSpecConfig,
  requestSpeculativeChatCompletion,
} from './deepspec-speculative-client.mjs';

const requests = [];

const server = createServer(async (request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization || '',
      body: body ? JSON.parse(body) : {},
    });

    if (request.url.includes('/fail/')) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'synthetic failure' } }));
      return;
    }

    if (request.url.includes('/slow/')) {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: 'late' } }] }));
      }, 150);
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'chatcmpl-deepspec-smoke',
        object: 'chat.completion',
        model: 'pbk-target',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Speculative lane ready.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      })
    );
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const endpoint = `http://127.0.0.1:${port}`;
const bridgeSource = readFileSync(resolve('scripts/openclaw-local-server.mjs'), 'utf8');

assert.match(
  bridgeSource,
  /requestSpeculativeChatCompletion/,
  'OpenClaw bridge should import the DeepSpec speculative client.'
);
assert.match(
  bridgeSource,
  /runDeepSeekChatCompletion[\s\S]*requestSpeculativeChatCompletion/,
  'DeepSpec speculative calls should wrap the existing DeepSeek completion path.'
);

try {
  const disabled = readDeepSpecConfig({
    PBK_DEEPSPEC_ENABLED: 'false',
    PBK_DEEPSPEC_ENDPOINT: endpoint,
    PBK_DEEPSPEC_TARGET_MODEL: 'pbk-target',
  });
  assert.equal(isDeepSpecConfigured(disabled), false, 'disabled config should not be active');

  const config = readDeepSpecConfig({
    PBK_DEEPSPEC_ENABLED: 'true',
    PBK_DEEPSPEC_ENDPOINT: `${endpoint}/v1/`,
    PBK_DEEPSPEC_API_KEY: 'secret-smoke-token',
    PBK_DEEPSPEC_TARGET_MODEL: 'pbk-target',
    PBK_DEEPSPEC_DRAFT_MODEL: 'pbk-draft',
    PBK_DEEPSPEC_NUM_SPECULATIVE_TOKENS: '5',
    PBK_DEEPSPEC_TIMEOUT_MS: '1000',
  });
  assert.equal(isDeepSpecConfigured(config), true, 'enabled endpoint should be configured');
  assert.equal(config.baseUrl, `${endpoint}/v1`, 'endpoint should normalize to one /v1 suffix');

  const result = await requestSpeculativeChatCompletion(
    {
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    },
    { config }
  );
  assert.equal(result.ok, true, 'successful endpoint should return ok');
  assert.equal(result.response.choices[0].message.content, 'Speculative lane ready.');
  assert.equal(requests.at(-1).url, '/v1/chat/completions');
  assert.equal(requests.at(-1).authorization, 'Bearer secret-smoke-token');
  assert.equal(requests.at(-1).body.model, 'pbk-target');
  assert.deepEqual(requests.at(-1).body.messages, [{ role: 'user', content: 'hello' }]);

  const failed = await requestSpeculativeChatCompletion(
    { messages: [{ role: 'user', content: 'fail' }] },
    {
      config: readDeepSpecConfig({
        PBK_DEEPSPEC_ENABLED: 'true',
        PBK_DEEPSPEC_ENDPOINT: `${endpoint}/fail`,
        PBK_DEEPSPEC_TARGET_MODEL: 'pbk-target',
      }),
    }
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'http_error');
  assert.equal(failed.status, 500);
  assert.equal(String(failed.error || '').includes('secret'), false, 'errors must not expose tokens');

  const timedOut = await requestSpeculativeChatCompletion(
    { messages: [{ role: 'user', content: 'slow' }] },
    {
      config: readDeepSpecConfig({
        PBK_DEEPSPEC_ENABLED: 'true',
        PBK_DEEPSPEC_ENDPOINT: `${endpoint}/slow`,
        PBK_DEEPSPEC_TARGET_MODEL: 'pbk-target',
        PBK_DEEPSPEC_TIMEOUT_MS: '25',
      }),
    }
  );
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.reason, 'timeout');

  console.log('deepspec-speculative-client-smoke: ok');
} finally {
  await new Promise((resolve) => server.close(resolve));
}
