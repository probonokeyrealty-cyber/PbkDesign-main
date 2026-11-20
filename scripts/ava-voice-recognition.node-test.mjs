import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { resolveAvaBrowserCommand } from '../src/app/utils/avaBrowserCommand.mjs';

const source = readFileSync('src/app/routes/AvaChat.tsx', 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('  const startListening = () => {');
const end = source.indexOf('\n  const replayCommand', start);
assert.ok(start > 0 && end > start);

function fixture({ failStart = false } = {}) {
  const submitted = [];
  const drafts = [];
  const errors = [];
  const reviews = [];
  const context = vm.createContext({
    voiceMountedRef: { current: true }, recognitionRef: { current: null },
    getSpeechRecognitionConstructor: () => class { start() { if (failStart) throw Error('microphone unavailable'); } stop() {} },
    setVoiceOutput: () => {}, setSubmitError: text => errors.push(text), setListening: () => {},
    setTranscript: () => {}, setDraft: text => drafts.push(text), submitCommand: text => submitted.push(text),
    setVoiceDraft: value => reviews.push(value), stopReplySpeech: () => {}, linkedLeadId: '',
    resolveAvaBrowserCommand,
  });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('startListening()', context);
  const result = Object.assign([{ transcript: 'A hypothetical explanation.' }], { isFinal: true });
  return { context, submitted, drafts, errors, reviews, callback: context.recognitionRef.current?.onresult, event: { results: [result] } };
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
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.drafts, ['A hypothetical explanation.']);
  assert.equal(f.reviews.at(-1), true);
});

test('native voice submits one exact navigation command even if the final event repeats', () => {
  const f = fixture();
  const event = { results: [Object.assign([{ transcript: 'Open Leads' }], { isFinal: true })] };
  f.callback(event);
  f.callback(event);
  assert.deepEqual(f.submitted, ['Open Leads']);
});

test('interim capture preserves the typed draft and an unavailable microphone falls back to text', () => {
  const voice = fixture();
  voice.callback({ results: [Object.assign([{ transcript: 'call the' }], { isFinal: false })] });
  assert.deepEqual(voice.drafts, []);
  assert.deepEqual(voice.submitted, []);
  const unsupported = fixture({ failStart: true });
  assert.equal(unsupported.context.recognitionRef.current, null);
  assert.match(unsupported.errors.at(-1), /type/i);
});

test('browser commands resolve exact existing destinations and the bound lead', () => {
  assert.deepEqual(resolveAvaBrowserCommand('Hey Ava, please go to the Deal Analyzer.'), { path: '/deals/analyzer' });
  assert.deepEqual(resolveAvaBrowserCommand('Open\nthe Deal Analyzer'), { path: '/deals/analyzer' });
  assert.deepEqual(resolveAvaBrowserCommand('Open current lead', 'lead:sample-1'), { path: '/leads/lead%3Asample-1' });
  assert.deepEqual(resolveAvaBrowserCommand('Open current lead', '..'), { path: null });
  assert.equal(resolveAvaBrowserCommand('Open https://example.org'), null);
  assert.equal(resolveAvaBrowserCommand('Open Leads and export all records'), null);
});

test('Ava opens saved lead evidence only for the lead bound to the conversation', () => {
  assert.deepEqual(resolveAvaBrowserCommand('Show saved analysis', 'lead-42'), { path: '/leads/lead-42#lead-numbers' });
  assert.deepEqual(resolveAvaBrowserCommand('Show saved comps', 'lead-42'), { path: '/leads/lead-42#lead-comps' });
  assert.deepEqual(resolveAvaBrowserCommand('Open property photos', 'lead-42'), { path: '/leads/lead-42#lead-photos' });
  assert.deepEqual(resolveAvaBrowserCommand('Show property record', 'lead-42'), { path: '/leads/lead-42#lead-record' });
  assert.deepEqual(resolveAvaBrowserCommand('Show saved comps'), { path: null });
  assert.equal(resolveAvaBrowserCommand('Refresh comps', 'lead-42'), null);
  const linked = fixture();
  linked.context.linkedLeadId = 'lead-42';
  const event = { results: [Object.assign([{ transcript: 'Show saved comps' }], { isFinal: true })] };
  linked.callback(event);
  assert.deepEqual(linked.submitted, ['Show saved comps']);
  const general = fixture();
  general.callback(event);
  assert.deepEqual(general.submitted, []);
  assert.deepEqual(general.drafts, ['Show saved comps']);
});

test('an explicit lead search keeps the term in navigation state, preserves case, and supports voice', () => {
  const command = 'Hey Ava, please search leads for Avery O’Neil.';
  assert.deepEqual(resolveAvaBrowserCommand(command), { path: '/leads', state: { avaLeadSearch: 'Avery O’Neil' } });
  assert.equal(resolveAvaBrowserCommand('Search leads for'), null);
  assert.equal(resolveAvaBrowserCommand('Search leads for A\nSend a message'), null);
  const f = fixture();
  f.callback({ results: [Object.assign([{ transcript: command }], { isFinal: true })] });
  assert.deepEqual(f.submitted, [command]);
});
