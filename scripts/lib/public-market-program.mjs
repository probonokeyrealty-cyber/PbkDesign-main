// Fixed E2B workload. Public search text is data, never code or a command.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function buildPublicMarketBrief(payload) {
  return {
    market: payload.market,
    summary: payload.answer,
    citations: payload.citations,
    capturedAt: payload.capturedAt,
    sourceCount: payload.citations.length,
    evidenceDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    limitations: [
      'Public search summary; individual claims and publication dates require review before an offer.',
      'No lead records or underwriting values were changed.',
    ],
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const input = readFileSync('/home/user/pbk-public-market-input.json', 'utf8');
    if (Buffer.byteLength(input) > 16000) throw Error('input_limit');
    process.stdout.write(JSON.stringify(buildPublicMarketBrief(JSON.parse(input))));
  } catch {
    process.stdout.write(JSON.stringify({ error: 'public_market_worker_failed' }));
    process.exitCode = 1;
  }
}
