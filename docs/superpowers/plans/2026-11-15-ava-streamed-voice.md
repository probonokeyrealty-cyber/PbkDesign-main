# Ava Streamed Voice Implementation Plan

> **REQUIRED WORKFLOW:** Use superpowers:subagent-driven-development with test-driven development and independent code review. Steps use checkbox syntax for tracking. Deployment requires explicit release approval.

**Goal:** Speak streamed Ava replies promptly and finish detailed explanations without truncation.

**Architecture:** A cumulative-prefix sentence queue drives a small Web Audio playback adapter through the existing authenticated TTS bridge. Speech has its own lifetime after text completes; cancellation ends both lanes.

**Tech Stack:** React, TypeScript, Intl.Segmenter, Web Audio, existing PBK/ElevenLabs TTS, Node tests/esbuild.

**Spec:** `docs/superpowers/specs/2026-11-15-ava-streamed-voice-design.md`

## Global Constraints
- Text-only remains the default.
- No new voice provider, keys, desktop surface, or approval bypass.
- No fixed total word, character, or playback-duration cap.

## Review Focus
- Repeated cumulative updates must not repeat spoken text.
- Final rewrites must cancel stale audio.
- Stop after text completes must still stop speech.
- Audio failures must not mark a completed text answer incomplete.
- Long speech must not inherit the model request's timeout.

### Task 1: Queue and Playback
Files: `src/app/utils/avaReplySpeech.ts`, `scripts/ava-reply-speech.node-test.mjs`.
Interface: `createAvaReplySpeech(play, onProgress, onError)` exposes `update`, `finish`, `stop`, `done`; `createAvaAudioPlayer(synthesize)` exposes `prepare`, `play`, and `close`.
- [x] Write and run failing queue/playback tests.
- [x] Implement bounded sentence chunks using Intl.Segmenter and the existing speech chunk splitter.
- [x] Verify full text and tail retention, cancellation, revision, errors, and playback completion.

### Task 2: Ava Chat Integration
Files: `src/app/routes/AvaChat.tsx`, existing runtime bridge adapter.
- [x] Add opt-in speaker control and plain voice status, reusing PBK icons and tokens.
- [x] Connect safe prefixes/final answers, keep Stop active during speech, and clean up on interrupt/unmount.
- [x] Verify build, typecheck, lint, unit suite, client streaming, bridge/MCP checks. Hosted post-release check remains in Task 3.

### Task 3: Approved Release
- [x] Independently review changes and address findings.
- [ ] Preserve concurrent main changes, push only the approved scope, and wait for published/live deployments.
- [ ] Verify first speech before text completion, full spoken tail, Stop, mobile overflow, and staff protection.
