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

test('speech request building preserves all supplied text beyond 1800 characters', () => {
  const context = fixture();
  const request = context.buildElevenLabsTtsRequest({ autoProsody: false }, explanation);
  assert.equal(request.payload.text, explanation.replace(/\s+/g, ' ').trim());
});
