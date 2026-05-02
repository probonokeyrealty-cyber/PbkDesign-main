import { DeepgramClient } from '@deepgram/sdk';

export const DEEPGRAM_SAMPLE_URL = 'https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav';

function envValue(env, keys = []) {
  for (const key of keys) {
    const value = String(env?.[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function boolEnv(env, key, fallback = false) {
  const raw = String(env?.[key] || '').trim();
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function numberEnv(env, key, fallback = 0) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getDeepgramConfig(env = process.env) {
  const apiKey = envValue(env, ['PBK_DEEPGRAM_API_KEY', 'DEEPGRAM_API_KEY']);
  const baseUrl = envValue(env, ['PBK_DEEPGRAM_BASE_URL', 'DEEPGRAM_BASE_URL']);
  return {
    apiKey,
    baseUrl,
    model: envValue(env, ['PBK_DEEPGRAM_MODEL', 'DEEPGRAM_MODEL']) || 'nova-2',
    liveModel: envValue(env, ['PBK_DEEPGRAM_LIVE_MODEL', 'DEEPGRAM_LIVE_MODEL']) || 'nova-2-meeting',
    language: envValue(env, ['PBK_DEEPGRAM_LANGUAGE', 'DEEPGRAM_LANGUAGE']) || 'en',
    telnyxEncoding: envValue(env, ['PBK_DEEPGRAM_TELNYX_ENCODING', 'DEEPGRAM_TELNYX_ENCODING']) || 'mulaw',
    telnyxSampleRate: numberEnv(env, 'PBK_DEEPGRAM_TELNYX_SAMPLE_RATE', numberEnv(env, 'DEEPGRAM_TELNYX_SAMPLE_RATE', 8000)),
    analyzeRecordings: boolEnv(env, 'PBK_DEEPGRAM_ANALYZE_RECORDINGS', false),
  };
}

export function getDeepgramProviderMeta(env = process.env) {
  const config = getDeepgramConfig(env);
  const missing = [];
  if (!config.apiKey) missing.push('PBK_DEEPGRAM_API_KEY or DEEPGRAM_API_KEY');
  return {
    configured: Boolean(config.apiKey),
    ready: missing.length === 0,
    mode: 'deepgram-sdk',
    model: config.model,
    liveModel: config.liveModel,
    language: config.language,
    telnyxEncoding: config.telnyxEncoding,
    telnyxSampleRate: config.telnyxSampleRate,
    analyzeRecordings: config.analyzeRecordings,
    features: ['prerecorded_transcription', 'live_telnyx_media_transcription', 'sentiment', 'utterances'],
    missing,
  };
}

export function createDeepgramClient(env = process.env) {
  const config = getDeepgramConfig(env);
  if (!config.apiKey) {
    const error = new Error('Deepgram provider is not configured.');
    error.code = 'DEEPGRAM_PROVIDER_MISSING';
    error.missing = ['PBK_DEEPGRAM_API_KEY or DEEPGRAM_API_KEY'];
    throw error;
  }
  return new DeepgramClient({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  });
}

function assertHttpUrl(value = '') {
  const url = String(value || '').trim();
  if (!url) {
    const error = new Error('Audio URL is required.');
    error.code = 'DEEPGRAM_AUDIO_URL_MISSING';
    throw error;
  }
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) throw new Error('unsupported protocol');
    return parsed.toString();
  } catch {
    const error = new Error('Audio URL must be a valid http(s) URL.');
    error.code = 'DEEPGRAM_AUDIO_URL_INVALID';
    throw error;
  }
}

function classifyScore(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 0.333333333) return 'positive';
  if (score <= -0.333333333) return 'negative';
  return 'neutral';
}

function toPbkSentimentScore(score) {
  return Number.isFinite(score) ? Number(((Math.max(-1, Math.min(1, score)) + 1) / 2).toFixed(3)) : null;
}

function collectUtterances(result = {}) {
  const utterances = result?.results?.utterances;
  return Array.isArray(utterances) ? utterances : [];
}

export function extractDeepgramTranscript(result = {}) {
  const channels = result?.results?.channels;
  const transcript = Array.isArray(channels)
    ? channels.map((channel) => channel?.alternatives?.[0]?.transcript || '').filter(Boolean).join('\n').trim()
    : '';
  if (transcript) return transcript;
  return collectUtterances(result).map((utterance) => utterance?.transcript || '').filter(Boolean).join(' ').trim();
}

export function summarizeDeepgramResult(result = {}) {
  const transcript = extractDeepgramTranscript(result);
  const channels = Array.isArray(result?.results?.channels) ? result.results.channels : [];
  const firstAlternative = channels[0]?.alternatives?.[0] || {};
  const sentiments = result?.results?.sentiments || {};
  const average = sentiments.average || {};
  const utterances = collectUtterances(result);
  const score = Number(average.sentiment_score ?? utterances.find((item) => Number.isFinite(Number(item?.sentiment_score)))?.sentiment_score);
  const sentimentLabel = average.sentiment || utterances.find((item) => item?.sentiment)?.sentiment || classifyScore(score);
  const segments = Array.isArray(sentiments.segments) ? sentiments.segments : [];

  return {
    transcript,
    transcriptPreview: transcript.slice(0, 220),
    confidence: Number.isFinite(Number(firstAlternative.confidence)) ? Number(firstAlternative.confidence) : null,
    sentiment: {
      label: sentimentLabel,
      score: Number.isFinite(score) ? Number(score.toFixed(4)) : null,
      pbkScore: toPbkSentimentScore(score),
      average,
      segmentCount: segments.length,
      segments: segments.slice(0, 8).map((segment) => ({
        text: String(segment.text || '').slice(0, 180),
        sentiment: segment.sentiment || classifyScore(Number(segment.sentiment_score)),
        score: Number.isFinite(Number(segment.sentiment_score)) ? Number(Number(segment.sentiment_score).toFixed(4)) : null,
      })),
    },
    utteranceCount: utterances.length,
    utterances: utterances.slice(0, 8).map((utterance) => ({
      transcript: String(utterance.transcript || '').slice(0, 180),
      speaker: utterance.speaker ?? null,
      start: utterance.start ?? null,
      end: utterance.end ?? null,
      sentiment: utterance.sentiment || null,
      sentimentScore: Number.isFinite(Number(utterance.sentiment_score)) ? Number(Number(utterance.sentiment_score).toFixed(4)) : null,
    })),
    warnings: Array.isArray(result?.metadata?.warnings) ? result.metadata.warnings : Array.isArray(result?.warnings) ? result.warnings : [],
  };
}

export function sanitizeDeepgramError(error) {
  return {
    message: error?.message || 'Deepgram request failed.',
    code: error?.code || error?.name || 'DEEPGRAM_ERROR',
    statusCode: error?.statusCode || error?.status || error?.response?.status || null,
    missing: Array.isArray(error?.missing) ? error.missing : [],
  };
}

export async function transcribeDeepgramUrl(options = {}, env = process.env) {
  const meta = getDeepgramProviderMeta(env);
  if (!meta.ready) {
    return {
      ok: false,
      result: 'provider_missing',
      provider: 'deepgram',
      error: `Deepgram is not configured (${meta.missing.join(', ')}).`,
      missing: meta.missing,
    };
  }

  try {
    const config = getDeepgramConfig(env);
    const url = assertHttpUrl(options.url || DEEPGRAM_SAMPLE_URL);
    const client = createDeepgramClient(env);
    const response = await client.listen.v1.media.transcribeUrl({
      url,
      model: options.model || config.model,
      language: options.language || config.language,
      smart_format: options.smartFormat ?? options.smart_format ?? true,
      punctuate: options.punctuate ?? true,
      paragraphs: options.paragraphs ?? true,
      sentiment: options.sentiment ?? true,
      utterances: options.utterances ?? true,
      diarize: options.diarize ?? false,
    });
    const summary = summarizeDeepgramResult(response);
    return {
      ok: true,
      result: 'live',
      provider: 'deepgram',
      model: options.model || config.model,
      url,
      summary,
      raw: options.includeRaw ? response : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      result: error?.code === 'DEEPGRAM_AUDIO_URL_INVALID' ? 'unavailable' : 'provider_missing',
      provider: 'deepgram',
      error: sanitizeDeepgramError(error).message,
      details: sanitizeDeepgramError(error),
    };
  }
}

export async function transcribeDeepgramFile(options = {}, env = process.env) {
  const meta = getDeepgramProviderMeta(env);
  if (!meta.ready) {
    return {
      ok: false,
      result: 'provider_missing',
      provider: 'deepgram',
      error: `Deepgram is not configured (${meta.missing.join(', ')}).`,
      missing: meta.missing,
    };
  }
  try {
    const config = getDeepgramConfig(env);
    const client = createDeepgramClient(env);
    const bytes = options.bytes || options.buffer;
    if (!bytes?.length) {
      return { ok: false, result: 'unavailable', provider: 'deepgram', error: 'Audio bytes are required.' };
    }
    const response = await client.listen.v1.media.transcribeFile(bytes, {
      model: options.model || config.model,
      language: options.language || config.language,
      smart_format: options.smartFormat ?? options.smart_format ?? true,
      punctuate: options.punctuate ?? true,
      paragraphs: options.paragraphs ?? true,
      sentiment: options.sentiment ?? true,
      utterances: options.utterances ?? true,
      diarize: options.diarize ?? false,
    });
    const summary = summarizeDeepgramResult(response);
    return {
      ok: true,
      result: 'live',
      provider: 'deepgram',
      model: options.model || config.model,
      summary,
      raw: options.includeRaw ? response : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      result: 'provider_missing',
      provider: 'deepgram',
      error: sanitizeDeepgramError(error).message,
      details: sanitizeDeepgramError(error),
    };
  }
}

export async function createDeepgramLiveConnection(options = {}, env = process.env) {
  const config = getDeepgramConfig(env);
  const client = createDeepgramClient(env);
  const connection = await client.listen.v1.connect({
    model: options.model || config.liveModel,
    language: options.language || config.language,
    smart_format: String(options.smartFormat ?? options.smart_format ?? true),
    interim_results: String(options.interimResults ?? options.interim_results ?? true),
    punctuate: String(options.punctuate ?? true),
    encoding: options.encoding || config.telnyxEncoding,
    sample_rate: String(options.sampleRate || options.sample_rate || config.telnyxSampleRate),
    channels: String(options.channels || 1),
    vad_events: String(options.vadEvents ?? options.vad_events ?? true),
    utterance_end_ms: String(options.utteranceEndMs || options.utterance_end_ms || 1000),
    Authorization: `Token ${config.apiKey}`,
  });
  return connection;
}

export function sendDeepgramAudio(connection, bytes) {
  if (!connection || !bytes?.length) return false;
  if (typeof connection.sendMedia === 'function') {
    connection.sendMedia(bytes);
    return true;
  }
  if (connection.socket && typeof connection.socket.send === 'function') {
    connection.socket.send(bytes);
    return true;
  }
  return false;
}
