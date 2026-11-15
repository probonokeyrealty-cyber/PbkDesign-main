# Ava and Connection Findings (2026-11-15)

## Live Connections

- Netlify's authenticated connector confirms staff project `pbkcenter` has a ready published deployment. Team login remains required on all deployments. Anonymous checks of `/`, `/leads`, and `/settings` returned 401 before verification.
- The Render CLI is installed at `C:\Users\Dell\.local\bin\render.exe`, authenticates to workspace PBK, and finds all six expected resources. The latest inspected bridge deploy is live at commit `fe120bb`. The Render connector itself returned `Unknown tool`; CLI and bridge checks succeeded independently.
- Render `/health` confirms DeepSeek is configured and ready. Missing local DeepSeek credentials do not prevent the dashboard from using Render. No new provider secret is required for that hosted path.
- The local OpenClaw gateway was stopped while the outbound heartbeat agent was running. `openclaw.cmd gateway start` restarted the existing login item. It briefly passed HTTP readiness, but subsequent HTTP and WebSocket probes timed out again, including direct HTTP checks with a 10-second deadline. The latest hosted result is `ready: false` with a fresh heartbeat carrying failed local probes. Gateway logs reached channel/sidecar startup; the listener exists, but stable responsiveness has not been restored. This is the remaining connection blocker, not a missing Render key.
- The bridge's Netlify metadata defaults to the retired `pbkcommandcenter` address. The local fix now uses `pbkcenter`, prioritizes explicit PBK URLs, validates links, and adds the non-secret site identity to `render.yaml` and `.env.example`. This code/config correction has not been deployed by this task.

## Chat Evidence

The authenticated state snapshot exposed 52 assistant session summaries, with counts and latest user/assistant previews rather than full transcripts. The current browser tab stopped at the protected workspace access screen, so this review does not claim a full transcript audit.

The most recent operator preview was an unsuccessful lead lookup, answered from the deterministic lookup path. Another preview used the fixed read-only audit response. Those answers are produced by PBK routing and do not exercise open-ended DeepSeek conversation. Recent history pass-through is already implemented in `AvaChat.tsx` and merged by the bridge.

`output/ava-latency-0dbe7bd-live-exclusive.json` records a previous controlled run on 2026-11-14: six model-backed requests, median 1326 ms, p95 1714 ms, and no fallback requests. The associated quality file contains six complete, relevant DeepSeek Flash replies. This is fixture evidence, not a current production p95 or phone-latency result.

The current frontend awaits `/api/assistant/chat` and adds the answer only after receiving the complete JSON response. It has no token-streaming render path. `scripts/ava-decision-messages.mjs` explicitly limits a simple conversational reply to two sentences totaling at most 30 words, while tool and audit intents can answer from templates. These explain the difference in pacing and wording from the DeepSeek chat application. The recent latency constraints were preserved; streaming and conversational-policy changes were not implemented in this pass.

## DeepSpec Decision

The optional endpoint client, fallback, dataset exporter, and benchmark gate exist. Keep speculation disabled until a compatible inference service is available and measured. The interactive chat route explicitly passes `speculative: false` with a shared 2300 ms model budget.

Speculative decoding needs target weights and compatible draft/speculator support inside the inference engine; it cannot be added around a hosted DeepSeek API call. DeepSpec's documented Qwen/Gemma draft checkpoints do not establish DeepSeek V4 compatibility. Render's published compute catalog does not document the proposed $19-49/month GPU plan. See [DeepSpec](https://github.com/deepseek-ai/DeepSpec), [vLLM](https://docs.vllm.ai/en/stable/features/speculative_decoding/), and [Render compute plans](https://render.com/docs/compute-plans).

## Verification

### Follow-Up: Detailed Chat

After the founder authorized the change, operator chat's fixed 30-word instruction and the 1200/1600-character reply cuts were removed. Full replies retain paragraphs, survive browser reload, and remain in follow-up history. DeepSeek operator requests now share a 30-second deadline and allow up to 4096 generated tokens; proxy and browser timeouts are 40 and 45 seconds. Model/transport resource limits still apply, but explanations have no fixed word or sentence cap. Seller phone-turn timing is unchanged.

Long ElevenLabs speech is delivered as sequential bounded requests in one audio response, preserving the full explanation. Stream cancellation stops further delivery, and later-chunk failures surface instead of reporting clipped speech as complete. The Render Docker image includes the new helper. Speculative decoding stays disabled.

The updated unit suite passed 47 suites (671 tests, 8 skipped), including actual request normalization/history merging and cancellation during a pending provider fetch. Independent review confirmed both follow-up blockers were cleared. Lint and Render packaging checks passed. Built-asset browser checks passed desktop Chromium and 390px WebKit with a reply over 5000 characters, reload/follow-up checks, approval checks, and no horizontal overflow. These changes are locally verified and have not been deployed by this task.

Passed: typecheck, production build, Netlify provider regression tests (4), release-status smoke, Ava assistant/mission-controller smokes, operator-health smoke, connection-strength/runtime-recovery checks, DeepSpec client/fallback/export/benchmark-gate smokes, bridge syntax check, YAML parse, and whitespace check.

Unrelated in-progress workflow, investor, and UI edits were preserved. No production deployment, new GPU service, or provider-key rotation was performed. The attached Desktop Commander launcher was inspected as reference data; its download-and-execute command was not run.

## Hosted Release Follow-Up

This follow-up supersedes the earlier local-only deployment status above. The founder's subsequent continuation authorized release. Ava changes were committed as `b183c61` and pushed to `main` from an isolated worktree. The concurrent, already-published Fleet context changes were preserved, tested together with Ava, and subsequently incorporated upstream as `830edc9`.

- Render deployment `dep-dbt1m115efls73fb3l2g` is live on `830edc9`, which includes the Ava changes. Netlify staff deployment `6afa1b8d6d41857c32763933` is ready with Ava and the same Fleet source snapshot. A future Git deploy still replaces a manual Netlify deploy; the tested source is now represented on `main`.
- A hosted synthetic read-only request returned a complete 307-word, 1741-character `deepseek-v4-flash` answer, including its requested ending, in about 3.7 seconds. A follow-up correctly expanded the third principle in about 1.8 seconds. These are individual diagnostic samples, not production percentile measurements. Some probe wording instead hit deterministic lookup or safety-pause paths; those gates remain in place and not every request is model-backed.
- A hosted 2035-character ElevenLabs speech request returned 2,912,009 audio bytes. Chromium decoded the combined response as about 182 seconds of audio. Full-text chunk ordering and cancellation also passed automated tests; audible quality was not reviewed.
- Netlify team-login protection remains enabled on all deployments. Anonymous `/`, `/leads`, and `/settings` checks returned 401 after release. BrowserOS reached the separate team-passcode gate, so this is not a claim of a full authenticated hosted UI run. Combined built-asset desktop, 390px WebKit, and 320px regression checks passed.
- DeepSeek is configured and ready using existing Render credentials; no keys were added or rotated. Netlify health now links `https://pbkcenter.netlify.app`. Two subsequent hosted OpenClaw checks reported fresh successful local heartbeats, unlike the earlier failures; this confirms current readiness, not long-term stability.
- Removed the obsolete proxy `timeout = 25` declaration from `netlify.toml`. Netlify documents a non-configurable 60-second synchronous limit; the application retains its bounded 30/40/45-second model/proxy/browser deadlines. The added configuration regression passed.

Token-by-token text rendering and speculative decoding remain out of scope and disabled respectively. Seller phone-turn deadlines and provider approval controls were not relaxed.

## Token Streaming Follow-Up

The founder subsequently authorized real text streaming. The implementation now consumes DeepSeek SSE, waits for complete non-action decision metadata, and forwards sanitized/controller-checked reply prefixes through Netlify API v2 to the existing chat exchange. A Stop control cancels generation; interrupted replies remain visible but do not enter completed browser history. The final validated response retains the existing mission, approval and session metadata. JSON compatibility and phone-turn behavior remain unchanged.

Before deployment, independent review findings were fixed for runtime package installation, final-event redaction and controller rewrites, tagged hidden reasoning, retained usage after missing terminal markers, and Netlify's named-handler API selection. CLI-built manifests proved the old bundle selected API v1 and the corrected default Fetch bundle selects API v2. Fresh local verification passed 50 unit suites (724 tests, 8 skipped), 17 client-stream tests, build, lint, typecheck, bridge and packaging checks, plus Chromium 1440px and WebKit 390px held-tail/Stop/interruption/history/overflow checks.

The initial streaming release `e4121cf` was verified live on Render deployment `dep-dbt2f9mq1p3s73fduqvg` and protected Netlify deployment `6afa27a6c85eb41b984a9e48` (API v2). A native DeepSeek Flash diagnostic delivered its first answer at 1063ms and completed at 7588ms, with 3596 characters and an unchanged final answer. These are single-run diagnostics, not production percentiles. Authenticated Chrome visibly showed the reply growing while Stop remained available; anonymous Home, Leads and Settings requests still returned 401. Some probe wording hit existing deterministic or safety-fallback paths, which remain intact.

A follow-up bounds cumulative progress overhead to 50ms updates and 8MiB of progress events without clipping the final answer. This also replaces a slow trailing-word regex with a linear scan. The follow-up passed 726 unit tests (8 skipped), the 17 client tests, and independent review. A memory-bounded, explicit-GC suite rerun passed after an earlier host paging-file failure; no system security or memory settings were changed.
