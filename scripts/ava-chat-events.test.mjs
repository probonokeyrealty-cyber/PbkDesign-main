import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from '@jest/globals';
import * as chat from './ava-chat-events.mjs';

test('the real HTTP chat stream flushes an answer before the final result', async () => {
  assert.equal(typeof chat.streamAvaChatResponse, 'function');
  let finish;
  const tail = new Promise(resolve => { finish = resolve; });
  const server = createServer((request, response) => void chat.streamAvaChatResponse(request, response, async () => {
    await request.avaStream.onAnswer('First safe words.');
    await tail;
    return { statusCode: 200, body: { ok: true, answer: 'First safe words. The ending.', sessionId: 'fixture' } };
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let reader;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: '{}' });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    let first = '';
    while (!first.includes('First safe words.')) first += new TextDecoder().decode((await reader.read()).value);
    assert.ok(!first.includes('event: done'));
    finish();
    let rest = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    assert.match(rest, /event: done/);
    assert.match(rest, /The ending/);
  } finally {
    finish();
    await reader?.cancel();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('disconnect aborts work and an exception never sends a successful completion', async () => {
  assert.equal(typeof chat.streamAvaChatResponse, 'function');
  let stopped;
  const aborted = new Promise(resolve => { stopped = resolve; });
  const server = createServer((request, response) => void chat.streamAvaChatResponse(request, response, async () => {
    await request.avaStream.onAnswer('Partial words.');
    await new Promise(resolve => request.avaStream.signal.addEventListener('abort', resolve, { once: true }));
    stopped();
    throw new Error('private-provider-details');
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST', body: '{}' });
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel();
    await aborted;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
