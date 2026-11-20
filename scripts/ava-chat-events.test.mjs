import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { jest, test } from '@jest/globals';
import * as chat from './ava-chat-events.mjs';

async function withDeadline(work, label, milliseconds = 2000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

test('disconnect waits time out and release their timer when the server never acknowledges', async () => {
  jest.useFakeTimers();
  try {
    let outcome;
    const wait = withDeadline(new Promise(() => {}), 'server disconnect', 2000)
      .then(() => { outcome = 'resolved'; }, error => { outcome = error.message; });
    await jest.advanceTimersByTimeAsync(2000);
    assert.equal(outcome, 'Timed out waiting for server disconnect');
    await wait;
    assert.equal(jest.getTimerCount(), 0);
    assert.equal(await withDeadline(Promise.resolve('acknowledged'), 'server disconnect'), 'acknowledged');
    await assert.rejects(withDeadline(Promise.reject(new Error('sample failure')), 'server disconnect'), /sample failure/);
    assert.equal(jest.getTimerCount(), 0);
  } finally { jest.useRealTimers(); }
});

async function readUntil(reader, expected) {
  let text = '';
  while (!text.includes(expected)) {
    const { done, value } = await reader.read();
    assert.equal(done, false, `Stream ended before receiving ${JSON.stringify(expected)}`);
    text += new TextDecoder().decode(value);
  }
  return text;
}

test.each(['', 'event: status\ndata: {"phase":"thinking"}\n\nFirst safe'])
('first-answer reader rejects premature EOF (%j)', async chunk => {
  const reader = new ReadableStream({
    start(controller) {
      if (chunk) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }).getReader();
  let reads = 0;
  const guardedReader = {
    read() {
      // Bound the old microtask spin without relying on a timer it would starve.
      assert.ok(++reads <= (chunk ? 2 : 1), 'Reader retried after EOF');
      return reader.read();
    },
  };
  try {
    await assert.rejects(readUntil(guardedReader, 'First safe words.'),
      /Stream ended before.*First safe words\./);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
});

test('quiet streams get one-second transport comments, respecting backpressure and disconnect', async () => {
  jest.useFakeTimers();
  const request = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableNeedDrain: false,
    writeHead() {}, flushHeaders() {},
    write(chunk) { writes.push(chunk); return true; },
    end() { this.writableEnded = true; },
  });
  const writes = [];
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const running = chat.streamAvaChatResponse(request, response, async () => {
    const stopped = new Promise(resolve => request.avaStream.signal.addEventListener('abort', resolve, { once: true }));
    started();
    await stopped;
    return { body: { ok: true, answer: 'Must not complete after disconnect.' } };
  });
  try {
    await ready;
    await jest.advanceTimersByTimeAsync(999);
    assert.equal(writes.filter(chunk => chunk.startsWith(':')).length, 0);
    await jest.advanceTimersByTimeAsync(1);
    assert.equal(writes.filter(chunk => chunk === ': keep-alive\n\n').length, 1,
      'A quiet stream must wake buffered browser delivery within one second');
    response.writableNeedDrain = true;
    await jest.advanceTimersByTimeAsync(1000);
    assert.equal(writes.filter(chunk => chunk.startsWith(':')).length, 1);
    response.destroyed = true;
    response.emit('close');
    await running;
    assert.equal(jest.getTimerCount(), 0, 'Disconnect must dispose the keep-alive interval');
    const count = writes.length;
    await jest.advanceTimersByTimeAsync(10_000);
    assert.equal(writes.length, count, 'Disconnect must stop keep-alives');
    assert.equal(writes.some(chunk => chunk.includes('event: done')), false);
  } finally {
    response.destroyed = true;
    response.emit('close');
    await running;
    jest.useRealTimers();
  }
});

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
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST', body: '{}', signal: AbortSignal.timeout(2000),
    });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    const first = await readUntil(reader, 'First safe words.');
    assert.ok(!first.includes('event: done'));
    finish();
    let rest = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
    assert.match(rest, /event: done/);
    assert.match(rest, /The ending/);
  } finally {
    finish();
    try {
      await reader?.cancel();
    } finally {
      reader?.releaseLock();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
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
  const controller = new AbortController();
  let reader;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST', body: '{}', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
    });
    reader = response.body.getReader();
    await withDeadline(reader.read(), 'first stream chunk');
    await withDeadline(reader.cancel(), 'reader cancellation');
    await withDeadline(aborted, 'server disconnect');
  } finally {
    controller.abort();
    try { reader?.releaseLock(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
});
