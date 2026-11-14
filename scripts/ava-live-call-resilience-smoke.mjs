import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const bridgePath = path.join(repoRoot, 'scripts', 'openclaw-local-server.mjs');
const source = readFileSync(bridgePath, 'utf8');

const checks = [
  {
    name: 'live spoken replies use guardAvaResponse before phone audio',
    pass:
      /import\s+\{\s*guardAvaResponse\s*\}\s+from\s+['"]\.\/ava-response-guard\.mjs['"]/.test(source) &&
      /function\s+guardTelnyxLiveSpokenReply\s*\(/.test(source) &&
      /guardTelnyxLiveSpokenReply\([^)]*\)/.test(source),
  },
  {
    name: 'ElevenLabs Telnyx TTS has timeout and stale-turn protection',
    pass:
      /ELEVENLABS_TELNYX_TTS_TIMEOUT_MS/.test(source) &&
      /AbortController/.test(source) &&
      /isTelnyxTtsReplyStale\s*\(/.test(source) &&
      /stale_seller_turn_before_media_send/.test(source),
  },
  {
    name: 'Telnyx media path can clear buffered playback for barge-in',
    pass:
      /function\s+sendTelnyxMediaClearCommand\s*\(/.test(source) &&
      /event:\s*['"]clear['"]/.test(source) &&
      /sendTelnyxMediaClearCommand\(session/.test(source),
  },
  {
    name: 'seller turns blocked by active locks or cooldown are queued, not dropped',
    pass:
      /queueTelnyxAvaReplyRetry\s*\(/.test(source) &&
      /ava_turn_lock_active_queued/.test(source) &&
      /reply_cooldown_queued/.test(source),
  },
  {
    name: 'Deepgram mid-call close attempts reconnect even after prior transcript',
    pass:
      /function\s+reconnectTelnyxDeepgramAfterClose\s*\(/.test(source) &&
      /deepgram_socket_reconnect_start/.test(source) &&
      !/if\s*\(\s*finalized\s*\|\|\s*session\.deepgramFallbackActive\s*\|\|\s*session\.transcript\.length\s*>\s*0\s*\|\|\s*!session\.audioBytes\s*\)\s*return\s+false\s*;/.test(source),
  },
  {
    name: 'episodic memory labels are outcome-aware, not first-row winning labels',
    pass:
      /formatEpisodicMemoryLabel\s*\(/.test(source) &&
      !/index\s*===\s*0\s*\?\s*['"]Similar past winning call['"]/.test(source),
  },
  {
    name: 'BANT authority extraction requires real authority evidence',
    pass:
      /authorityEvidencePattern/.test(source) &&
      !/wife\|husband\|spouse\|partner\|attorney\|lawyer\|executor\|co-\?owner\|decision\|my client\|seller/.test(source),
  },
];

const failed = checks.filter((check) => !check.pass);

if (failed.length) {
  console.error('Ava live-call resilience smoke failed:');
  for (const check of failed) console.error(`- ${check.name}`);
  process.exit(1);
}

console.log(`Ava live-call resilience smoke passed (${checks.length} checks).`);
