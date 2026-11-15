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
