import { createParser } from 'eventsource-parser';
import type { AvaAssistantChatResponse } from './runtimeBridge';

export type AvaChatStreamOptions = {
  onAnswer?: (text: string) => void;
  signal?: AbortSignal;
};

export class AvaChatStreamError extends Error {
  constructor(message: string, public code = 'stream_interrupted') {
    super(message);
    this.name = 'AvaChatStreamError';
  }
}

function parseResponse(value: unknown): AvaAssistantChatResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AvaChatStreamError('Ava returned an invalid response.');
  }
  const response = value as AvaAssistantChatResponse;
  if (typeof response.ok !== 'boolean'
    || (response.answer !== undefined && typeof response.answer !== 'string')
    || (response.result !== undefined && typeof response.result !== 'string')) {
    throw new AvaChatStreamError('Ava returned an invalid response.');
  }
  return response;
}

export async function readAvaChatResponse(
  response: Response,
  { onAnswer, signal }: AvaChatStreamOptions = {},
): Promise<AvaAssistantChatResponse> {
  signal?.throwIfAborted();
  if (!response.body) throw new AvaChatStreamError('Ava response was interrupted. No response body arrived.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const streaming = response.headers.get('Content-Type')?.split(';')[0].trim() === 'text/event-stream';
  let completed: AvaAssistantChatResponse | undefined;
  let json = '';
  const parser = createParser({
    onEvent(event) {
      signal?.throwIfAborted();
      if (completed || !['answer', 'done', 'error'].includes(event.event || '')) return;
      let value;
      try {
        value = JSON.parse(event.data);
      } catch {
        throw new AvaChatStreamError('Ava response was interrupted by invalid event data.');
      }
      if (event.event === 'done') {
        completed = parseResponse(value);
      } else if (event.event === 'error') {
        throw new AvaChatStreamError(
          typeof value?.message === 'string' ? value.message : 'Ava response was interrupted.',
          typeof value?.code === 'string' ? value.code : 'stream_interrupted',
        );
      } else {
        if (typeof value?.text !== 'string') {
          throw new AvaChatStreamError('Ava response was interrupted by invalid answer data.');
        }
        onAnswer?.(value.text);
      }
    },
  });
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      void reader.cancel().catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      const text = decoder.decode(chunk.value, { stream: !chunk.done });
      if (streaming) parser.feed(text);
      else json += text;
      signal?.throwIfAborted();
      if (completed) return completed;
      if (chunk.done) break;
    }
    if (streaming) {
      throw new AvaChatStreamError('Ava response was interrupted before completion. Check the connection before sending another request.');
    }
    try {
      return parseResponse(JSON.parse(json));
    } catch {
      throw new AvaChatStreamError('Ava returned an invalid response.');
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // A terminal event ends the exchange even when the server keeps the socket open.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
