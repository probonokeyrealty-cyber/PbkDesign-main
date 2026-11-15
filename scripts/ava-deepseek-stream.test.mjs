import assert from 'node:assert/strict';
import { test } from '@jest/globals';
import * as streaming from './ava-deepseek-stream.mjs';

const encode = value => new TextEncoder().encode(value);
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const content = value => frame({ id: 'fixture', choices: [{ delta: { content: value }, finish_reason: null }] });
const header = JSON.stringify({ decision: 'answer', confidence: 0.8, nextAction: '', needsApproval: false, missionTimeline: [], toolIntent: null }).slice(0, -1) + ',"reply":"';

test('reply sanitization removes tagged reasoning and credentials in previews and complete output', () => {
  assert.equal(typeof streaming.sanitizeAvaStreamReply, 'function');
  for (const tag of ['think', 'analysis', 'reasoning', 'scratchpad']) {
    assert.equal(streaming.sanitizeAvaStreamReply(`Visible. <${tag}>Private planning `), 'Visible. ');
    assert.equal(streaming.sanitizeAvaStreamReply(`Visible. <${tag}>Private planning</${tag}> Safe ending.`), 'Visible.  Safe ending.');
  }
  assert.equal(streaming.sanitizeAvaStreamReply('Example sk-proj-abcdefghijklmnopqrst'), 'Example [redacted-secret]');
});

test('visible answer arrives before the upstream completion is released', async () => {
  assert.equal(typeof streaming.readDeepSeekStream, 'function');
  let upstream;
  const response = new Response(new ReadableStream({ start(controller) { upstream = controller; } }));
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => true });
  const running = streaming.readDeepSeekStream(response, { onDelta: delta => preview.write(delta) });
  upstream.enqueue(encode(content(header + 'Hello operator. More ')));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(answers[0], 'Hello operator. More ');
  upstream.enqueue(encode(content('detail."}') + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + frame({ choices: [], usage: { completion_tokens: 20 } }) + 'data: [DONE]\n\n'));
  upstream.close();
  const result = await running;
  assert.equal(JSON.parse(result.choices[0].message.content).reply, 'Hello operator. More detail.');
  assert.equal(result.usage.completion_tokens, 20);
  assert.equal(answers.at(-1), 'Hello operator. More detail.');
});

test('fragmented UTF-8 and escaped JSON strings survive byte-sized delivery', async () => {
  assert.equal(typeof streaming.readDeepSeekStream, 'function');
  const answer = 'A quoted "example".\nNext: caf\u00e9.';
  const raw = header + JSON.stringify(answer).slice(1) + '}';
  const bytes = encode(content(raw) + frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\r\n\r\n');
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => true });
  const response = new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } }));
  await streaming.readDeepSeekStream(response, { onDelta: delta => preview.write(delta) });
  assert.equal(answers.at(-1), answer);
});

test.each([
  { decision: 'act', needsApproval: false, toolIntent: null },
  { decision: 'answer', needsApproval: true, toolIntent: null },
  { decision: 'answer', needsApproval: false, toolIntent: { name: 'telnyx_sms', summary: 'send', paramsJson: '{}', providerWrite: true } },
])('action or approval metadata cannot enter a visible answer: %j', async metadata => {
  assert.equal(typeof streaming.createAvaDecisionPreview, 'function');
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => true });
  await preview.write(JSON.stringify({ confidence: 0.8, nextAction: '', missionTimeline: [], ...metadata, reply: 'I sent that text.' }));
  assert.deepEqual(answers, []);
});

test('reply before decision metadata remains buffered', async () => {
  assert.equal(typeof streaming.createAvaDecisionPreview, 'function');
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => true });
  await preview.write('{"reply":"Do not reveal this yet.",');
  await preview.write('"decision":"answer","confidence":0.8,"nextAction":"","needsApproval":false,"missionTimeline":[],"toolIntent":null}');
  assert.deepEqual(answers, []);
});

test('controller-rejected prefixes are never displayed', async () => {
  assert.equal(typeof streaming.createAvaDecisionPreview, 'function');
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => false });
  await preview.write(header + 'Do not show this. ');
  assert.deepEqual(answers, []);
});

test('an unfinished credential token is held until it can be sanitized', async () => {
  assert.equal(typeof streaming.createAvaDecisionPreview, 'function');
  const answers = [];
  const preview = streaming.createAvaDecisionPreview({ onAnswer: text => answers.push(text), sanitize: text => text, check: async () => true });
  await preview.write(header + 'Example sk-partial');
  await preview.write('-credential value ');
  assert.equal(answers.at(-1), 'Example [redacted-secret] value ');
  assert.ok(answers.every(text => !text.includes('sk-')));
});

test('reasoning is redacted and tool-call deltas are accumulated, never sent as text', async () => {
  assert.equal(typeof streaming.readDeepSeekStream, 'function');
  const deltas = [];
  const wire = frame({ choices: [{ delta: { reasoning_content: 'Private reasoning' }, finish_reason: null }] })
    + frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'tool', type: 'function', function: { name: 'test', arguments: '{' } }] } }] })
    + frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
  const result = await streaming.readDeepSeekStream(new Response(wire), { onDelta: text => deltas.push(text) });
  assert.deepEqual(deltas, []);
  assert.equal(result.choices[0].message.tool_calls[0].function.arguments, '{}');
  assert.ok(!JSON.stringify(result).includes('Private reasoning'));
});

test('missing terminal event is an interruption, not a complete answer', async () => {
  assert.equal(typeof streaming.readDeepSeekStream, 'function');
  await assert.rejects(streaming.readDeepSeekStream(new Response(content('partial'))), /incomplete|interrupted/i);
});

test('an interrupted provider stream retains a received billing receipt', async () => {
  const wire = content('partial') + frame({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 37 } });
  await assert.rejects(streaming.readDeepSeekStream(new Response(wire)), error => {
    assert.equal(error.providerUsage.total_tokens, 37);
    return /interrupted/.test(error.message);
  });
});

test('cancellation stops a blocked provider read', async () => {
  assert.equal(typeof streaming.readDeepSeekStream, 'function');
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const controller = new AbortController();
  const running = streaming.readDeepSeekStream(response, { signal: controller.signal });
  controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.equal(cancelled, true);
});
