import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';

let source = '';
try { source = readFileSync('src/app/utils/avaReplySpeech.ts', 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const bundled = await build({ stdin: { contents: source, resolveDir: 'src/app/utils', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const speech = await import(`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=ava-reply-speech-fixture.mjs`).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const played = [];
  const progress = [];
  const errors = [];
  let release;
  const queue = speech.createAvaReplySpeech(async (text, signal, onPlaying) => {
    played.push(text);
    onPlaying();
    await new Promise((resolve, reject) => {
      release = resolve;
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    });
  }, value => progress.push(value), error => errors.push(error));
  return { queue, played, progress, errors, release: () => release?.() };
}

test('a complete sentence starts before the final answer and cumulative updates do not repeat it', async () => {
  assert.equal(typeof speech.createAvaReplySpeech, 'function');
  const f = fixture();
  f.queue.update('A complete first sentence. An unfinished');
  await tick();
  assert.equal(f.played.join(''), 'A complete first sentence. ');
  assert.equal(f.progress.at(-1).state, 'speaking');
  f.queue.update('A complete first sentence. An unfinished');
  assert.equal(f.played.length, 1);
  f.queue.finish('A complete first sentence. An unfinished ending is now complete.');
  f.release(); await tick();
  assert.equal(f.played.length, 2);
  f.release(); await f.queue.done;
  assert.equal(f.played.join(''), 'A complete first sentence. An unfinished ending is now complete.');
  assert.equal(f.progress.at(-1).state, 'idle');
});

test('a detailed answer retains all characters and its unpunctuated final tail', async () => {
  const played = [];
  const queue = speech.createAvaReplySpeech(async text => { played.push(text); }, () => {}, error => { throw error; });
  const text = `${'A complete detailed explanation. '.repeat(250)}${'x'.repeat(1800)} Final tail`;
  queue.update(text.slice(0, 1500));
  queue.finish(text);
  await queue.done;
  assert.equal(played.join(''), text);
  assert.ok(played.every(chunk => chunk.length <= 600));
});

test('a fragment waits until a sentence boundary or final completion', async () => {
  const f = fixture();
  f.queue.update('An incomplete fragment');
  await tick(); assert.equal(f.played.length, 0);
  f.queue.finish('An incomplete fragment');
  await tick(); assert.equal(f.played[0], 'An incomplete fragment');
  f.release(); await f.queue.done;
});

test('Stop aborts playback and queued text and ignores later prefixes', async () => {
  const f = fixture();
  f.queue.update('First sentence. Second sentence.');
  await tick();
  f.queue.stop();
  f.queue.finish('First sentence. Second sentence. Last sentence.');
  await f.queue.done;
  assert.equal(f.played.length, 1);
  assert.equal(f.errors.length, 0);
  assert.equal(f.progress.at(-1).state, 'idle');
  assert.equal(f.progress.at(-1).queuedCharacters, 0);
});

test('a changed final answer cancels stale speech without replaying a correction', async () => {
  const f = fixture();
  f.queue.update('Provisional sentence.'); await tick();
  f.queue.finish('A different final answer.');
  await f.queue.done;
  assert.equal(f.played.length, 1);
  assert.equal(f.errors[0].code, 'reply_changed');
});

test('synthesis failure leaves a voice error rather than silently skipping a chunk', async () => {
  const errors = [];
  const states = [];
  const queue = speech.createAvaReplySpeech(async () => { throw new Error('private provider failure'); }, value => states.push(value), error => errors.push(error));
  queue.finish('A useful final answer.');
  await queue.done;
  assert.equal(errors[0].code, 'voice_failed');
  assert.equal(states.at(-1).state, 'error');
});

function audioFixture() {
  const sources = [];
  const context = {
    state: 'suspended', destination: {},
    resume: async () => { context.state = 'running'; },
    close: async () => { context.state = 'closed'; },
    decodeAudioData: async () => ({ duration: 120 }),
    createBufferSource() {
      const source = { onended: null, started: false, stopped: false,
        connect() {}, disconnect() {},
        start() { source.started = true; },
        stop() { source.stopped = true; source.onended?.(); },
      };
      sources.push(source);
      return source;
    },
  };
  return { sources, context };
}

test('audio playback waits for the actual ending, not synthesis or a model deadline', async () => {
  assert.equal(typeof speech.createAvaAudioPlayer, 'function');
  const f = audioFixture();
  const player = speech.createAvaAudioPlayer(async () => new Blob(['audio'], { type: 'audio/mpeg' }), () => f.context);
  await player.prepare();
  let ended = false;
  let playing = false;
  const promise = player.play('A long explanation.', new AbortController().signal, () => { playing = true; }).then(() => { ended = true; });
  await tick();
  assert.equal(playing, true);
  assert.equal(ended, false);
  f.sources[0].onended(); await promise;
  assert.equal(ended, true);
  await player.close();
  assert.equal(f.context.state, 'closed');
});

test('Stop aborts pending synthesis before any audio can start', async () => {
  const f = audioFixture();
  let aborted = false;
  const player = speech.createAvaAudioPlayer(async (_, signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Stopped', 'AbortError')); }, { once: true });
  }), () => f.context);
  await player.prepare();
  const controller = new AbortController();
  const promise = player.play('Pending audio.', controller.signal, () => {});
  await tick(); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(aborted, true);
  assert.equal(f.sources.length, 0);
  await player.close();
});

test('Stop during audio and close disconnect playback without late success', async () => {
  const f = audioFixture();
  const player = speech.createAvaAudioPlayer(async () => new Blob(['audio'], { type: 'audio/mpeg' }), () => f.context);
  await player.prepare();
  const controller = new AbortController();
  const promise = player.play('Spoken audio.', controller.signal, () => {});
  await tick(); controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(f.sources[0].stopped, true);
  const second = player.play('Another audio.', new AbortController().signal, () => {});
  await tick(); await player.close();
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(f.sources[1].stopped, true);
});

test('late decoding after cancellation never starts stale audio', async () => {
  const f = audioFixture();
  let decode;
  f.context.decodeAudioData = () => new Promise(resolve => { decode = resolve; });
  const player = speech.createAvaAudioPlayer(async () => new Blob(['audio'], { type: 'audio/mpeg' }), () => f.context);
  await player.prepare();
  const controller = new AbortController();
  const promise = player.play('Late audio.', controller.signal, () => {});
  await tick(); controller.abort(); decode({ duration: 10 });
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(f.sources.length, 0);
  await player.close();
});

test('a browser without sentence segmentation keeps text usable and speaks the full final reply', async () => {
  const original = Intl.Segmenter;
  Intl.Segmenter = undefined;
  try {
    const played = [];
    const queue = speech.createAvaReplySpeech(async text => { played.push(text); }, () => {}, () => {});
    queue.update('A sentence. A fragment');
    assert.equal(played.length, 0);
    queue.finish('A sentence. A fragment completed.');
    await queue.done;
    assert.equal(played.join(''), 'A sentence. A fragment completed.');
  } finally { Intl.Segmenter = original; }
});
