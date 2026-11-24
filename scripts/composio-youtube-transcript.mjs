import { createHash } from 'node:crypto';

const TOOL_URL = 'https://backend.composio.dev/api/v3.1/tools/execute/GETANYAPI_YOUTUBE_VIDEO_TRANSCRIPT';
const TOOL_VERSION = '20261116_00';
const MAX_TRANSCRIPT_CHARS = 200_000;

export async function fetchComposioYouTubeTranscript(
  videoId,
  { env = process.env, fetchImpl = globalThis.fetch, minChars = 1 } = {}
) {
  const key = env.PBK_COMPOSIO_YOUTUBE_API_KEY?.trim() || env.COMPOSIO_API_KEY?.trim();
  const accountId = env.PBK_COMPOSIO_YOUTUBE_ACCOUNT_ID?.trim();
  const maxCost = env.PBK_COMPOSIO_YOUTUBE_MAX_COST_USD?.trim();
  if (
    env.PBK_COMPOSIO_YOUTUBE_ENABLED !== 'true' ||
    !key ||
    !accountId ||
    !/^0\.\d{1,8}$/.test(maxCost || '') ||
    Number(maxCost) <= 0 ||
    !/^[\w-]{11}$/.test(videoId || '')
  ) return null;

  const requestKey = createHash('sha256').update(JSON.stringify([videoId, maxCost])).digest('hex');
  try {
    const response = await fetchImpl(TOOL_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        connected_account_id: accountId,
        version: TOOL_VERSION,
        arguments: {
          id: videoId,
          max_cost_usd: maxCost,
          idempotency_key: `pbk-youtube-transcript-${requestKey}`,
        },
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const output = payload?.data?.output;
    const data = output?.data;
    if (payload?.successful !== true || payload.error || output?.found !== true) return null;
    const segments = Array.isArray(data?.segments) ? data.segments : [];
    const text = typeof data?.transcript === 'string' && data.transcript.trim()
      ? data.transcript
      : segments.map((segment) => typeof segment?.text === 'string' ? segment.text : '').join(' ');
    const transcript = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSCRIPT_CHARS);
    if (transcript.length < minChars) return null;

    return { ok: true, videoId, transcript, segmentCount: segments.length, source: 'composio_getanyapi' };
  } catch {
    return null;
  }
}
