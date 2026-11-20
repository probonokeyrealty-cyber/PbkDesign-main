# Ava Streamed Voice Verification

Date: 2026-11-15. Scope: authenticated Ava Chat spoken replies, not a live phone call or an acoustic/transcription audit.

## Published Release

- Source: `5c63eb1edba5002165c86c2f9d64d24966b75e5c`.
- Netlify staff site `pbkcenter`: deploy `6afa40b3ea9cdd470f406b84`, ready and published.
- Render bridge: deploy `dep-dbt41cvf3r2c73f2la9g`, live at the same source commit.
- Concurrent main-branch SMTP changes were preserved. The initial Render build lacked the shared speech helper in the frontend Docker stage; a forward fix added that copy and a packaging regression check before the successful release.
- Hosted smoke passed after release: DeepSeek, ElevenLabs, Netlify, and OpenClaw ready. Anonymous requests to `/`, `/leads`, and `/settings` each returned 401. Staff protection and provider-write approval gates were not changed. No keys were added or rotated.

## Live Chrome Evidence

- Voice was off on page load and enabled explicitly with the speaker control.
- A six-paragraph detailed reply contained 1,732 characters and ended with the requested sentence: "The explanation is complete, and every part has been covered."
- The browser's completed-playback counter reached all 1,732 characters, with `state: idle` and `queued: 0`. The adapter advances this counter only after Web Audio `onended`, not when synthesis or text generation finishes. This verifies the complete playback lifecycle, not a human listening assessment of pronunciation.
- A separate synthetic long request showed `voice: speaking` while `textState: pending`, 4,138 ms after the Send click. At that observation, text contained 1,842 characters and speech had 1,287 queued characters. This is one observed timing, not a production latency percentile.
- Stop after text completion returned speech to idle and cleared queued audio.
- A second concurrent text/speech check showed active speech during pending text at 3,879 ms. Stop then produced `textState: cancelled`, `voice: idle`, `queued: 0`, and no Stop button. A later observation remained idle, without restarting audio.
- At 390px width, document and viewport widths were both 390px. Mic bounds were x=22..66, speaker x=72..116, and Send x=273..369 on the same row: no control overlap or page overflow. The temporary viewport was reset and voice was turned off at the end.
- Local, gitignored proof files: `.pbk-local/ava-voice-stream-overlap.json`, `.pbk-local/ava-voice-stop.json`, `.pbk-local/ava-voice-long-complete.png`, and `.pbk-local/ava-voice-mobile-fixed.png`.

## Automated Checks

- Final focused rerun: `npm run test:ava-assistant-chat`, both smokes and 30 Node tests passed.
- Post-release rerun: `npm run test:hosted` passed.
- Implementation verification also passed typecheck, lint, production build, bridge/MCP checks, and Render Docker import checks.
- Full Jest run passed 50 suites, 731 tests passed and 8 skipped. An earlier concurrent run exhausted Windows memory; the standalone run completed successfully.
- Independent code review found a late microphone callback/unmount race. Production-closure regression tests were written, the race was fixed, and the reviewer reported no remaining actionable findings.

## Remaining Generation Limit

The new speech queue has no total character, word, or playback-duration cap; individual synthesis chunks are bounded for reliable playback. It does not make model generation unlimited. The existing chat route still has a 30-second shared generation budget and a 4,096-token output ceiling. A deliberately oversized forty-paragraph request returned an interrupted text response and stopped its provisional audio safely. The browser error did not expose whether that request reached the deadline, token ceiling, or another upstream interruption. Automatic multi-request continuation was not added in this voice release. The complete detailed-reply playback check above passed independently.
