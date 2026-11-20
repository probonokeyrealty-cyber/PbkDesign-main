import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from '@jest/globals';
import { appendAssistantMessage, normalizeAssistantSession } from './ava-assistant-chat.mjs';

const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const explanation = `${'Here is a useful explanation with a concrete example. '.repeat(70)}\n\nFinal detail: preserve the complete ending.`;

function fixture() {
  const context = vm.createContext({
    URL, toNumber: Number,
    extractJsonObjectFromText: (text) => { try { return JSON.parse(text); } catch { return null; } },
    ELEVENLABS_VOICE_ID: 'fixture-voice', ELEVENLABS_MODEL_ID: 'fixture-model',
    ELEVENLABS_OUTPUT_FORMAT: 'mp3_44100_128', ELEVENLABS_BASE_URL: 'https://voice.invalid',
    ELEVENLABS_STABILITY: 0.5, ELEVENLABS_SIMILARITY_BOOST: 0.75, ELEVENLABS_SPEED: 1,
    buildAvaProsodyProfile: () => null,
    applyProsodyTextControls: (text) => ({ text }),
  });
  const load = (startName, endName) => {
    const start = source.indexOf(startName);
    const end = source.indexOf(endName, start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end), context);
  };
  load('function looksLikeStrategistMetaText(', '\nlet lastAvaSpokenOutput');
  load('function normalizeAvaSpokenScript(', '\nfunction normalizeStrategistResponse');
  load('function parseAvaDeepSeekDecisionAnswer(', '\nfunction getAvaDeepSeekDecisionFromToolResult');
  load('function buildElevenLabsTtsRequest(', '\nasync function fetchElevenLabsTts');
  return context;
}

test('a complete detailed DeepSeek reply survives parsing and final normalization', () => {
  const context = fixture();
  const raw = JSON.stringify({ reply: explanation, decision: 'answer', confidence: 0.8 });
  const decision = context.parseAvaDeepSeekDecisionAnswer(raw);
  assert.equal(decision.reply, explanation);
  assert.equal(context.normalizeAvaAssistantAnswer(raw), explanation);
  assert.equal(context.normalizeAvaAssistantAnswer(explanation), explanation);
});

test('follow-up context retains the end of a detailed assistant answer', () => {
  const session = appendAssistantMessage({}, 'assistant', explanation);
  assert.equal(session.history[0].content, explanation);
  assert.equal(normalizeAssistantSession(session).history[0].content, explanation);
  const redacted = appendAssistantMessage({}, 'assistant', `${explanation} sk-proj-abcdefghijklmnopqrst`);
  assert.match(redacted.history[0].content, /\[redacted-secret\]$/);
});

test('a long generated explanation retains its complete tail beyond the old 64000-character history cutoff', () => {
  const answer = `${'Detailed example and explanation. '.repeat(2500)}\n\nThe entire ending remains available.`;
  assert.ok(answer.length > 64_000);
  const session = appendAssistantMessage({}, 'assistant', answer);
  assert.equal(session.history[0].content.length, answer.length);
  assert.equal(session.history[0].content.slice(-36), answer.slice(-36));
  assert.equal(normalizeAssistantSession(session).history[0].content, answer);
  const context = fixture();
  assert.equal(context.parseAvaDeepSeekDecisionAnswer(JSON.stringify({ reply: answer })).reply, answer);
  assert.equal(context.normalizeAvaAssistantAnswer(answer), answer);
});

test('speech request building preserves all supplied text beyond 1800 characters', () => {
  const context = fixture();
  const request = context.buildElevenLabsTtsRequest({ autoProsody: false }, explanation);
  assert.equal(request.payload.text, explanation.replace(/\s+/g, ' ').trim());
});
