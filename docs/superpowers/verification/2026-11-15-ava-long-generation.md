# Ava Long Generation Verification

Date: 2026-11-15 (America/Los_Angeles). Scope: authenticated staff chat and its speech queue, not a phone-call test.

## Release

- Ava implementation commits: `cc64cf3` (long generation/transport), `4ad9cbe` (actual-capacity instruction), and `cb3355b` (descriptive-cue false positive).
- Concurrent property-intelligence changes were preserved. The later source `ce0fd33828cc23f4110b03a01c856c27582c8384` is a descendant of the reviewed Ava fixes; its chat/guard implementation is unchanged.
- Inspected Render deploy: `dep-dbt5qkvf3r2c73f4d2h0`, live. Netlify deploy: `6afa5d53019104c0fb2256c9`, ready and published at the same later source.

## Behavior And Safety

- Chat-only generation allows 32,768 output tokens, with one ten-minute retry/fallback deadline and a 90-second stream-inactivity watchdog. Other model/phone-turn budgets retain their existing limits.
- The browser allows eleven minutes for transport/final persistence. Netlify-hosted chat streams use the existing authenticated Render endpoint directly, avoiding the serverless duration ceiling. Other requests retain their existing routing.
- The master key stays server-side. Existing team tokens, shared proxy/direct chat-intent permissions, approval gates, and no-POST-replay behavior are preserved. Expired/rejected captured tokens cannot clear a replacement session.
- Assistant reply/history preservation supports 256,000 characters; oversized provider content fails explicitly rather than silently becoming a completed clipped reply. Speech uses bounded synthesis chunks with no total playback-duration cap.
- The original signature pattern remains intact. Only bounded descriptive communication cues receive a nominal-language exception. Real signing, sign-off, signing-of, DocuSign, mixed actions, and option-letter counterexamples remain blocked.

## Automated Evidence

- Full Jest verification of the Ava release: 51 suites passed, 757 tests passed, 8 skipped.
- Final chat/mission smokes and 57 client/voice/recognition tests passed again after the concurrent source updates.
- Long-generation/provider/decision/guard targeted run: 61 tests passed. Independent guard review also passed all 47 guard cases plus additional counterexamples.
- Typecheck, production build, standard project lint, MCP typecheck, isolated bridge smoke, behavioral suite, Netlify proxy-auth smoke, and Docker import checks passed during implementation. The final Docker import rerun checked 114 imports, 92 files, and both frontend voice inputs.
- An additional expanded lint invocation for previously unlisted scripts found the pre-existing unused `reasons` variable in `ava-response-guard.mjs`; it reported no errors. This unrelated warning was not removed.
- Independent reviews found and resolved direct/proxy permission mismatch, trusted-preview CORS, an outdated smoke assertion, invented short-channel claims, and ambiguous signing-phrase counterexamples. No actionable findings remained in the reviewed scope.

## Hosted And Browser Evidence

- Hosted health passed with Postgres, DeepSeek, ElevenLabs, Render, Netlify, and OpenClaw ready. No keys were added or rotated.
- Production preflight accepted the canonical staff origin and a recognized PBK preview origin with the existing team header. An unrelated Netlify origin received no allowed-origin header. Anonymous direct chat returned 401; anonymous staff `/`, `/leads`, and `/settings` checks returned 401.
- Chrome's new chat client produced a complete 2,299-character explanation with its requested final sentence. Active voice was observed with 1,086 characters played and 1,213 queued. The tab closed before playback completion; the user explicitly chose "Leave browser playback to me." Full device playback and a fresh mobile check were therefore not claimed for this release.
- Automated queue coverage retained an explanation above 64,000 characters, every bounded chunk, and its complete tail. Stop, late decoding, rewrites, failures, and completed-only context remain covered by regressions.

## Stress-Test Audit

- A forty-section reply completed naturally in 18.8 seconds but was shorter than requested; it was not counted as proof beyond the old generation ceiling.
- An earlier long PBK manual ran for 71.8 seconds before a final-controller signature guard pause. That was not a model timeout and led to the narrowly reviewed nominal-language fix. Baseline proof is preserved in `.pbk-local/ava-long-generation-guard-pause.json`.
- Another test lost its response when a concurrent Render deployment replaced the running instance. Service logs and deploy ancestry confirmed the replacement. No POST was automatically replayed and no concurrent work was rolled back.
- Final authenticated live stream passed on the later release: 44,142 characters, 7,123 words, all 48 numbered sections in order, and the exact requested final sentence. First answer: 1,743 ms; complete response: 71,987 ms; 634 cumulative answer events. The final controller guard passed and the result was `deepseek_chat_answer`, not a fallback.
- This timing is one controlled observation, not a production percentile. The response did not expose an exact provider output-token receipt; outbound 32,768-token configuration is verified by production-closure tests instead.
- The PBK training prompt requested neutral hypothetical examples, excluded sensitive/transactional content, and used "indicator" or "signal" for descriptive cues. Guard negative tests independently verify actual signing remains blocked.
- The initial diagnostic section-count assertion assumed plain numbering and missed Markdown `## 1.` headings. After correcting that parser, offline validation of the unchanged saved response confirmed sections 1 through 48 and the complete tail without replaying a POST. Proof: `.pbk-local/ava-long-generation-live-extended.json` and `.pbk-local/ava-long-generation-live-extended.txt`.

## Remaining Safeguards

These changes do not promise unlimited output. Provider limits, the stated resource budgets, content/approval guards, network loss, and service replacement can still end a request. Speech remains independently cancellable, and failed/cancelled replies are not promoted into completed follow-up context. Browser playback is left to the user as requested.
