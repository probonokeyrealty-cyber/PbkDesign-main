# Ava Jarvis Architecture Status

This is the non-SaaS PBK Jarvis track: desktop control, bridge voice, memory, emotional intelligence, safety, and dashboard operations.

## Live / Implemented

- Render bridge: Postgres-backed, bearer-authenticated, approval-gated provider actions.
- Browser Ava avatar: floating push-to-talk UI with mobile-safe panel, Deepgram browser session support, transcript streaming, staged Ava responses, and optional ElevenLabs playback.
- Voice bridge: `/api/voice/browser/health`, `/api/voice/browser/session`, `/api/voice/browser/stream`, and `/api/voice/tts`.
- Telnyx media stream bridge: `/api/webhooks/telnyx/media` with token gate and Deepgram transcript capture.
- Intelligence tools: `pbk_learn`, `recallPbkMemory`, `detectPbkIntent`, `queryPbkKnowledge`, `recordPbkFeedback`, `runPbkAgentPipeline`.
- Safety tools: `pbk_send_update`, `pbk_call_operator`, `pbk_kill_switch`, approval-mode guardrails, protected ops passcode, and optional TOTP enforcement for admin/operator routes.
- Human communication doctrine: truthful AI disclosure, humor only when emotionally safe, grief/overwhelm no-joke policy, scam/trust handoff language.
- Desktop scaffold: `electron-desktop/` loads the live dashboard, adds tray controls, and maps the global hotkey to the same Ava voice panel.
- Optional provider prewarm: `PBK_VOICE_PREWARM_ENABLED=true` pre-opens Deepgram and ElevenLabs paths on bridge startup.

## Secure / Manual Handoff

- ElevenLabs production TTS needs `PBK_ELEVENLABS_API_KEY` and `PBK_ELEVENLABS_TTS_ENABLED=true` set directly in Render or from a non-logged secret source.
- Deepgram proof needs one real answered call with a human speaking so live transcript and sentiment can be verified.
- TOTP hardening is code-ready behind `PBK_TOTP_REQUIRED=true` and `PBK_TOTP_SECRET`; enable only after the operator workflow knows how to pass `X-PBK-TOTP`.
- Wake word and always-listening remain intentionally off until a privacy review.

## Later Controlled Upgrades

- Package Electron with installer/autostart after the wrapper is manually tested.
- Add wake-word detection as opt-in only.
- Add context-mode MCP after verifying the package source and tool compatibility.
- Add emotional intelligence microservices (DAFOR, MOSES, DeEAR, RLVER) as separate, observable services instead of embedding opaque ML in the bridge.
- Add streaming LLM-to-TTS once ElevenLabs is live and response latency is measured.
