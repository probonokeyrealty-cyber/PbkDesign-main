export async function streamAvaChatResponse(request, response, run, headers = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  response.writeHead(200, {
    ...headers,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const emit = async (event, data) => {
    controller.signal.throwIfAborted();
    if (!response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
      await new Promise((resolve, reject) => {
        const cleanup = () => { response.off('drain', drain); response.off('close', close); };
        const drain = () => { cleanup(); resolve(); };
        const close = () => { cleanup(); reject(new DOMException('Stream closed.', 'AbortError')); };
        response.once('drain', drain);
        response.once('close', close);
      });
    }
  };
  request.avaStream = { signal: controller.signal, onAnswer: text => emit('answer', { text }) };
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) response.write(': keep-alive\n\n');
  }, 10_000);
  heartbeat.unref?.();
  try {
    await emit('status', { phase: 'thinking' });
    const result = await run();
    controller.signal.throwIfAborted();
    if ((result.statusCode || 200) >= 400) {
      await emit('error', { code: 'chat_request_failed', message: 'Ava could not complete that request. Please try again.' });
    } else {
      await emit('done', result.body || {});
    }
  } catch {
    if (!controller.signal.aborted && !response.destroyed) {
      await emit('error', { code: 'stream_interrupted', message: 'Ava\'s response was interrupted. Please try again.' }).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
    request.off('aborted', abort);
    response.off('close', abort);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
