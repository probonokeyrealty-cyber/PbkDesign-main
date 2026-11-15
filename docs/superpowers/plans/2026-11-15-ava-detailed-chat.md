# Ava Detailed Chat

User direction: DeepSeek should power operator chat and give complete explanations in text and speech when needed, without an artificial word or sentence cap.

Approach: extend the existing chat and speech paths. Keep the structured decision and approval controller, remove short reply cuts, preserve full assistant answers in history and browser storage, and give operator chat a 30-second shared generation budget with up to 4096 output tokens. Short answers can still finish immediately; seller phone-turn timing remains separate. Match the proxy/browser deadlines to this longer operator request.

Speech: retain the existing ElevenLabs and browser fallback. Send long ElevenLabs speech as sequential bounded chunks in one audio response so provider request size limits do not silently cut the explanation. Preserve cancellation and surface chunk failures.

Verification: regression tests for long replies, paragraph/history preservation, complete ordered speech, cancellation, provider errors, the shared request deadline, proxy authentication, and existing action gates. Build/typecheck and inspect desktop/mobile long-answer layout. No new GPU service or speculative decoding is needed for this change.

Result: 47 unit suites passed (671 tests, 8 skipped); lint, typecheck, production build, Docker import packaging, and desktop Chromium/mobile WebKit checks passed. Review blockers in request-history normalization and pending speech-fetch cancellation were fixed and rechecked. New behavior is verified locally; deployment is pending. Local frontend preview: http://127.0.0.1:5273/ava-chat (uses the currently deployed Render backend).
