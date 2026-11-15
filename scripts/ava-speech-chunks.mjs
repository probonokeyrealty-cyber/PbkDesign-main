export function splitAvaSpeechText(text, maxChars = 1600) {
  const value = String(text || '');
  const limit = Number.isFinite(maxChars) && maxChars >= 2 ? Math.floor(maxChars) : 1600;
  const chunks = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + limit, value.length);
    if (end < value.length) {
      const boundary = value.lastIndexOf(' ', end - 1);
      if (boundary > offset + limit / 2) end = boundary + 1;
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function joinAvaSpeechResponses(firstResponse, remainingChunks, fetchChunk) {
  if (!firstResponse.ok || !remainingChunks.length) return firstResponse;
  let reader = firstResponse.body.getReader();
  let nextIndex = 0;
  let cancelled = false;
  const requestAbort = new AbortController();
  const headers = new Headers(firstResponse.headers);
  headers.delete('content-length');
  headers.delete('transfer-encoding');

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (!reader) {
            if (nextIndex >= remainingChunks.length) {
              controller.close();
              return;
            }
            const response = await fetchChunk(remainingChunks[nextIndex++], requestAbort.signal);
            if (cancelled) {
              await response.body?.cancel();
              return;
            }
            if (!response.ok || !response.body) {
              await response.body?.cancel();
              throw new Error(`Speech chunk failed with status ${response.status}.`);
            }
            reader = response.body.getReader();
          }
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) {
            reader.releaseLock();
            reader = null;
          } else {
            controller.enqueue(value);
            return;
          }
        }
      } catch (error) {
        await reader?.cancel().catch(() => {});
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      requestAbort.abort(reason);
      await reader?.cancel(reason);
    },
  });
  return new Response(stream, { status: firstResponse.status, headers });
}
