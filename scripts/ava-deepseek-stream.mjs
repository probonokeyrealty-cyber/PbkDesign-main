import { createParser } from 'eventsource-parser';
import { JSONParser } from '@streamparser/json';
import { isAvaCompactDecisionSafe } from './ava-decision-messages.mjs';
import { redactAssistantSecrets } from './ava-assistant-chat.mjs';

export function sanitizeAvaStreamReply(value = '') {
  const text = String(value || '');
  const stack = [];
  let visible = '';
  let offset = 0;
  // Reasoning embedded in reply text is private too, including nested/unclosed tags.
  for (const tag of text.matchAll(/<\/?(think|analysis|reasoning|reflection|scratchpad)\b[^>]*>/gi)) {
    if (!tag[0].startsWith('</')) {
      if (!stack.length) visible += text.slice(offset, tag.index);
      stack.push(tag[1].toLowerCase());
    } else if (stack.at(-1) === tag[1].toLowerCase()) {
      stack.pop();
      if (!stack.length) offset = tag.index + tag[0].length;
    } else if (!stack.length) {
      visible += text.slice(offset, tag.index);
      offset = tag.index + tag[0].length;
    }
  }
  if (!stack.length) visible += text.slice(offset);
  return redactAssistantSecrets(visible.replace(/<(?:think|analysis|reasoning|reflection|scratchpad)\b[^>]*$/gi, ''));
}

export async function readDeepSeekStream(response, { signal, onDelta = () => {}, onActivity = () => {}, maxContentCharacters = 128_000 } = {}) {
  if (!response.body) throw new Error('DeepSeek stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  const parser = createParser({ onEvent: event => events.push(event.data), onError: () => { throw new Error('DeepSeek stream is malformed.'); } });
  let answer = '';
  let reasoningSeen = false;
  let finishReason = null;
  let done = false;
  let id = '';
  let usage = null;
  const toolCalls = [];
  const contentLimit = Number.isFinite(maxContentCharacters) && maxContentCharacters > 0
    ? Math.min(1_048_576, maxContentCharacters) : 128_000;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (!done) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      onActivity();
      parser.feed(decoder.decode(next.value, { stream: true }));
      while (events.length) {
        const data = events.shift();
        if (data === '[DONE]') { done = true; break; }
        const payload = JSON.parse(data);
        if (payload.error) throw new Error('DeepSeek stream reported an error.');
        id = payload.id || id;
        usage = payload.usage || usage;
        const choice = payload.choices?.find(item => !item.index || item.index === 0);
        if (!choice) continue;
        finishReason = choice.finish_reason || finishReason;
        const delta = choice.delta || {};
        reasoningSeen ||= Boolean(delta.reasoning_content);
        for (const tool of delta.tool_calls || []) {
          const index = Number(tool.index || 0);
          if (!Number.isInteger(index) || index < 0 || index > 127) throw new Error('Invalid streamed tool index.');
          const target = toolCalls[index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tool.id) target.id = tool.id;
          if (tool.type) target.type = tool.type;
          target.function.name += tool.function?.name || '';
          target.function.arguments += tool.function?.arguments || '';
        }
        if (typeof delta.content === 'string' && delta.content) {
          answer += delta.content;
          if (answer.length > contentLimit) throw new Error('DeepSeek stream exceeded the response budget.');
          // Tool decisions are retained for final validation, never rendered as text.
          if (!toolCalls.length) await onDelta(delta.content);
        }
      }
    }
    if (!done || !finishReason) throw new Error('DeepSeek stream was interrupted before completion.');
    return {
      id, usage,
      choices: [{ finish_reason: finishReason, message: { content: answer, reasoning_content: reasoningSeen ? '[redacted]' : '', tool_calls: toolCalls.filter(Boolean) } }],
    };
  } catch (error) {
    if (usage) { error.providerUsage = usage; error.responseId = id; }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createAvaDecisionPreview({ onAnswer, sanitize, check, now = Date.now }) {
  const parser = new JSONParser({ emitPartialTokens: true, emitPartialValues: true });
  const metadata = {};
  const completedKeys = new Set();
  let reply = '';
  let replyComplete = false;
  let replyStarted = false;
  let validOrder = true;
  let blocked = false;
  let emitted = '';
  let lastEmissionAt = -Infinity;
  let wireBytes = 0;
  parser.onValue = ({ key, value, stack, partial }) => {
    if (stack.length !== 1) return;
    if (key === 'reply') {
      if (value === undefined && partial) return;
      if (replyComplete || typeof value !== 'string') { validOrder = false; return; }
      replyStarted = true;
      reply = value;
      replyComplete = !partial;
    } else if (!partial) {
      if (replyStarted || completedKeys.has(key)) validOrder = false;
      completedKeys.add(key);
      metadata[key] = value;
    }
  };
  return {
    get emitted() { return Boolean(emitted); },
    async write(delta) {
      parser.write(delta);
      if (blocked || !validOrder || !reply) return;
      if (emitted && !replyComplete && now() - lastEmissionAt < 50) return;
      const decision = { ...metadata, reply };
      if (!isAvaCompactDecisionSafe(JSON.stringify(decision))
        || !['answer', 'ask', 'log_only'].includes(metadata.decision)
        || metadata.needsApproval || metadata.toolIntent !== null) return;
      // Hold the unfinished word so a credential split across tokens can be redacted.
      let boundary = reply.length;
      while (boundary > 0 && !/\s/.test(reply[boundary - 1])) boundary--;
      const stable = replyComplete ? reply : reply.slice(0, boundary);
      const visible = sanitize(sanitizeAvaStreamReply(stable));
      if (!visible || visible === emitted) return;
      const bytes = Buffer.byteLength(JSON.stringify({ text: visible })) + 32;
      // Bound cumulative progress overhead, not the final authoritative answer.
      if (wireBytes + bytes > 8 * 1024 * 1024) return;
      if (!await check(visible, decision)) { blocked = true; return; }
      await onAnswer(visible);
      emitted = visible;
      lastEmissionAt = now();
      wireBytes += bytes;
    },
  };
}
