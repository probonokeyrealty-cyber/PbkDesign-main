import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = readFileSync('src/app/routes/AvaChat.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const startListening = () => {');
const end = source.indexOf('\n  const replayCommand', start);
assert.ok(start > 0 && end > start);

function fixture() {
  const submitted = [];
  const context = vm.createContext({
    voiceMountedRef: { current: true }, recognitionRef: { current: null },
    getSpeechRecognitionConstructor: () => class { start() {} stop() {} },
    setVoiceOutput: () => {}, setSubmitError: () => {}, setListening: () => {},
    setTranscript: () => {}, setDraft: () => {}, submitCommand: text => submitted.push(text),
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('startListening()', context);
  const result = Object.assign([{ transcript: 'A hypothetical explanation.' }], { isFinal: true });
  return { context, submitted, callback: context.recognitionRef.current.onresult, event: { results: [result] } };
}

test('a captured final microphone callback cannot submit after the chat unmounts', () => {
  const f = fixture();
  f.context.voiceMountedRef.current = false;
  f.callback(f.event);
  assert.deepEqual(f.submitted, []);
});

test('a previous microphone session cannot submit into a newer listening session', () => {
  const f = fixture();
  vm.runInContext('startListening()', f.context);
  f.callback(f.event);
  assert.deepEqual(f.submitted, []);
  f.context.recognitionRef.current.onresult(f.event);
  assert.deepEqual(f.submitted, ['A hypothetical explanation.']);
});
