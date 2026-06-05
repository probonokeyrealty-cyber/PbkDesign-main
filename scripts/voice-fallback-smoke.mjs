import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = path.join(ROOT_DIR, 'ops', 'upgrade-integrations', 'local-voice-fallback-status.json');
const DEFAULT_TEXT = 'PBK voice fallback smoke test.';
const CANDIDATE_PATHS = ['/tts', '/api/tts', '/synthesize', '/api/voice/tts'];

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/g, '');
}

function detectProvider(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('moss')) return 'moss-tts';
  if (lower.includes('zerovox') || lower.includes('zero-vox')) return 'zerovox';
  return 'local-tts-fallback';
}

function isPlayableAudio(contentType, bytes) {
  if (/^audio\//i.test(String(contentType || ''))) return bytes.length > 44;
  const magic = bytes.subarray(0, 12).toString('latin1');
  return bytes.length > 44 && (magic.startsWith('RIFF') || magic.startsWith('ID3') || magic.startsWith('OggS') || magic.startsWith('fLaC'));
}

async function writeStatus(status) {
  await mkdir(path.dirname(STATUS_FILE), { recursive: true });
  await writeFile(STATUS_FILE, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...status }, null, 2)}\n`);
}

async function postWithTimeout(url, body, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(getArg('url') || process.env.PBK_TTS_FALLBACK_BASE_URL || process.env.PBK_MOSS_TTS_BASE_URL || process.env.PBK_ZEROVOX_BASE_URL);
  const text = getArg('text') || DEFAULT_TEXT;

  if (!baseUrl) {
    await writeStatus({
      ok: false,
      reason: 'missing_fallback_url',
      provider: null,
      url: null,
      playableAudio: false,
      audioBytes: 0,
    });
    throw new Error('Set PBK_TTS_FALLBACK_BASE_URL, PBK_MOSS_TTS_BASE_URL, PBK_ZEROVOX_BASE_URL, or pass --url=...');
  }

  const errors = [];
  for (const endpointPath of CANDIDATE_PATHS) {
    const url = `${baseUrl}${endpointPath}`;
    try {
      const response = await postWithTimeout(url, { text, format: 'wav', source: 'pbk_voice_fallback_smoke' });
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      const playableAudio = response.ok && isPlayableAudio(contentType, bytes);

      if (playableAudio) {
        await writeStatus({
          ok: true,
          provider: detectProvider(baseUrl),
          url,
          endpointPath,
          status: response.status,
          contentType,
          playableAudio,
          audioBytes: bytes.length,
        });
        console.log(`Voice fallback smoke passed via ${url} (${bytes.length} bytes).`);
        return;
      }

      errors.push({ url, status: response.status, contentType, audioBytes: bytes.length, bodyPreview: bytes.subarray(0, 160).toString('utf8') });
    } catch (error) {
      errors.push({ url, error: error instanceof Error ? error.message : String(error || 'request_failed') });
    }
  }

  await writeStatus({
    ok: false,
    reason: 'no_playable_audio_response',
    provider: detectProvider(baseUrl),
    url: baseUrl,
    playableAudio: false,
    audioBytes: 0,
    errors,
  });
  throw new Error(`Voice fallback smoke failed for ${baseUrl}. No endpoint returned playable audio.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
