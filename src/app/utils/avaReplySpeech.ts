import { splitAvaSpeechText } from '../../../scripts/ava-speech-chunks.mjs';

export type AvaVoiceProgress = {
  state: 'idle' | 'preparing' | 'speaking' | 'error';
  spokenCharacters: number;
  queuedCharacters: number;
};

type VoiceError = { code: 'reply_changed' | 'voice_failed' };
type PlaySpeech = (text: string, signal: AbortSignal, onPlaying: () => void) => Promise<void>;

export function createAvaReplySpeech(
  play: PlaySpeech,
  onProgress: (progress: AvaVoiceProgress) => void,
  onError: (error: VoiceError) => void,
) {
  const controller = new AbortController();
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'sentence' }) : null;
  const pending: string[] = [];
  let latest = '';
  let enqueued = 0;
  let spoken = 0;
  let draining = false;
  let final = false;
  let stopped = false;
  let settle!: () => void;
  const done = new Promise<void>(resolve => { settle = resolve; });
  const report = (state: AvaVoiceProgress['state']) => onProgress({
    state, spokenCharacters: spoken, queuedCharacters: Math.max(0, enqueued - spoken),
  });
  const stop = (error?: VoiceError) => {
    if (stopped) return;
    stopped = true;
    pending.length = 0;
    enqueued = spoken;
    controller.abort();
    report(error ? 'error' : 'idle');
    if (error) onError(error);
    settle();
  };
  const drain = async () => {
    if (draining || stopped) return;
    draining = true;
    try {
      while (pending.length && !stopped) {
        const text = pending.shift()!;
        report('preparing');
        await play(text, controller.signal, () => { if (!stopped) report('speaking'); });
        if (stopped) return;
        spoken += text.length;
      }
      if (final && !stopped) { report('idle'); settle(); }
    } catch {
      if (!stopped) stop({ code: 'voice_failed' });
    } finally {
      draining = false;
    }
  };
  const update = (text: string, complete = false) => {
    if (stopped || final) return;
    if (!text.startsWith(latest) && text.trimEnd() !== latest.trimEnd()) {
      stop({ code: 'reply_changed' });
      return;
    }
    latest = text;
    final = complete;
    const tail = text.slice(enqueued);
    let stableEnd = complete ? tail.length : 0;
    if (!complete && segmenter) {
      for (const part of segmenter.segment(tail)) {
        if (/[.!?\u3002\uff01\uff1f][\s"')\]*_\u2019\u201d]*$/.test(part.segment)) stableEnd = part.index + part.segment.length;
      }
    }
    const stable = tail.slice(0, stableEnd);
    pending.push(...splitAvaSpeechText(stable, 600));
    enqueued += stable.length;
    void drain();
  };
  return { update: (text: string) => update(text), finish: (text: string) => update(text, true), stop: () => stop(), done };
}

export function createAvaAudioPlayer(
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>,
  createContext: () => AudioContext = () => new AudioContext(),
) {
  let context: AudioContext | undefined;
  let closed = false;
  const active = new Set<() => void>();
  const prepare = async () => {
    if (closed) throw new Error('Voice playback is closed.');
    context ??= createContext();
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') throw new Error('Voice playback is unavailable.');
  };
  const play: PlaySpeech = async (text, signal, onPlaying) => {
    signal.throwIfAborted();
    const audio = await synthesize(text, signal);
    signal.throwIfAborted();
    if (!audio.size || !/^audio\//i.test(audio.type)) throw new Error('Voice returned no playable audio.');
    await prepare();
    const current = context!;
    const buffer = await current.decodeAudioData(await audio.arrayBuffer());
    signal.throwIfAborted();
    if (closed) throw new DOMException('Voice playback closed.', 'AbortError');
    const source = current.createBufferSource();
    source.buffer = buffer;
    source.connect(current.destination);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        active.delete(abort);
        source.onended = null;
        if (error) { try { source.stop(); } catch { /* Playback may not have started. */ } }
        source.disconnect();
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new DOMException('Voice playback stopped.', 'AbortError'));
      active.add(abort);
      source.onended = () => finish();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      try { source.start(); onPlaying(); } catch (error) { finish(error); }
    });
  };
  return {
    prepare, play,
    close: async () => {
      closed = true;
      for (const abort of active) abort();
      if (context && context.state !== 'closed') await context.close();
    },
  };
}
