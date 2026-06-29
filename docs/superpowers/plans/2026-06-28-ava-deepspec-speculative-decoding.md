# Ava DeepSpec Speculative Decoding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional speculative-decoding lane for Ava/Rex DeepSeek requests so PBK can reduce response latency while keeping existing DeepSeek fallback, approval gates, and response contracts intact.

**Architecture:** Deploy a vLLM-compatible speculative endpoint as a separate service, then route PBK bridge DeepSeek chat calls through that endpoint only when `PBK_DEEPSPEC_ENABLED=true`. On timeout, HTTP error, malformed response, or missing config, the bridge falls back to the current DeepSeek path. Ava Chat history should continue to send prior turns so phrasing and motion feel like a continuous DeepSeek-style chat.

**Tech Stack:** Node.js 22 bridge scripts, Render environment variables, vLLM OpenAI-compatible server, DeepSpec draft-model training/evaluation pipeline, Jest/Node smoke tests, PBK doctor scripts, BrowserOS/Browser verification.

---

## Source Checks

- DeepSpec is a full-stack codebase for speculative-decoding draft model data prep, training, and evaluation: https://github.com/deepseek-ai/DeepSpec
- DeepSpec currently releases Qwen3 and Gemma draft checkpoints, including `deepseek-ai/dspark_qwen3_4b_block7`: https://huggingface.co/collections/deepseek-ai/deepspec
- vLLM supports speculative decoding through `--speculative-config`, with draft-model config keys including `method`, `model`, and `num_speculative_tokens`: https://docs.vllm.ai/en/stable/features/speculative_decoding/
- vLLM online serving keeps the OpenAI-compatible client request path unchanged once the server is launched with speculative decoding: https://docs.vllm.ai/en/latest/features/speculative_decoding/draft_model/

## Guardrails

- Do not commit real API keys, endpoint tokens, Hugging Face tokens, Render tokens, or DeepSeek keys.
- Keep `PBK_DEEPSPEC_ENABLED=false` until benchmark evidence shows the speculative endpoint beats the current DeepSeek live path.
- Do not use a Qwen/Gemma released draft checkpoint for production DeepSeek traffic; use those checkpoints only for local vLLM integration proofing or benchmark harness validation.
- Preserve current approval gates. Speculative decoding changes inference speed only; it must not grant authority to write provider state, change MAO, send SMS, place calls, or approve offers.
- Preserve current response shape from `runDeepSeekChatCompletion` and existing `/api/assistant/chat` callers.

## Environment Contract

Add these placeholders to local env docs and Render. Only `PBK_DEEPSPEC_API_KEY` is secret, but `PBK_DEEPSPEC_ENDPOINT` and `PBK_DEEPSPEC_DRAFT_MODEL` are environment-specific and should be set from Render UI until the service is final.

```text
PBK_DEEPSPEC_ENABLED=false
PBK_DEEPSPEC_ENDPOINT=
PBK_DEEPSPEC_API_KEY=
PBK_DEEPSPEC_PROVIDER=vllm
PBK_DEEPSPEC_TARGET_MODEL=deepseek-v4-flash
PBK_DEEPSPEC_DRAFT_MODEL=
PBK_DEEPSPEC_NUM_SPECULATIVE_TOKENS=5
PBK_DEEPSPEC_TIMEOUT_MS=2500
PBK_DEEPSPEC_FALLBACK_ENABLED=true
```

## Implementation Tasks

- [x] Create `scripts/deepspec-speculative-client.mjs`.
  - Export `readDeepSpecConfig(env)`, `isDeepSpecConfigured(config)`, and `requestSpeculativeChatCompletion(payload, options)`.
  - Accept an OpenAI-compatible endpoint base. Normalize trailing `/v1` so both `https://service.example.com` and `https://service.example.com/v1` work.
  - Send `Authorization: Bearer ${PBK_DEEPSPEC_API_KEY}` only when the key exists.
  - Use `AbortSignal.timeout(Number(PBK_DEEPSPEC_TIMEOUT_MS || 2500))`.
  - Return `{ ok: true, response, meta }` on compatible response; return `{ ok: false, reason, meta }` without throwing on expected endpoint failures.

- [x] Add focused smoke coverage in `scripts/deepspec-speculative-client-smoke.mjs`.
  - Start a local HTTP server that returns an OpenAI-compatible chat completion.
  - Assert the client sends the expected model, messages, and authorization header.
  - Assert timeout and 500 responses return `ok: false`.
  - Add package script `test:deepspec-speculative-client`.

- [x] Wire `scripts/openclaw-local-server.mjs`.
  - In the existing DeepSeek chat path, build the same payload used for the current DeepSeek request.
  - Before the plain DeepSeek call, check `PBK_DEEPSPEC_ENABLED === "true"` and `isDeepSpecConfigured`.
  - On speculative success, return the same normalized result shape the current DeepSeek path returns.
  - On speculative failure, record fallback metadata in logs without exposing keys, then call the existing DeepSeek path when `PBK_DEEPSPEC_FALLBACK_ENABLED !== "false"`.
  - If fallback is disabled, return the existing bridge error shape with `provider: "deepspec"` and no secret material.

- [ ] Add bridge fallback tests.
  - Extend or add a bridge smoke that covers: speculative success, speculative timeout fallback, speculative 500 fallback, disabled config, and fallback-disabled error.
  - Verify `npm.cmd run test:ava-assistant-chat` still passes because Ava Chat depends on this path.
  - Verify `npm.cmd run test:release-status-bridge` still passes.

- [ ] Add a DeepSpec data/eval harness for PBK prompts.
  - Create `scripts/deepspec-export-ava-dataset.mjs`.
  - Input sources: approved Ava assistant exchanges, call transcripts, deal analysis prompts, and strategist responses already persisted by PBK.
  - Redact emails, phone numbers, exact street addresses, seller names when not needed, tokens, and passcodes.
  - Output JSONL with `{ "messages": [...], "accepted_answer": "..." }`.
  - Add package script `deepspec:export-ava-dataset`.

- [ ] Add `docs/operations/ava-deepspec-runbook.md`.
  - Include vLLM launch example:

```bash
vllm serve <target-model> \
  --host 0.0.0.0 \
  --port 8000 \
  --speculative-config '{"method":"draft_model","model":"<draft-model>","num_speculative_tokens":5}'
```

- Include Render service env setup, health check, rollback, and benchmark commands.
- Document that Qwen/Gemma released drafts are not production-compatible with DeepSeek target traffic unless the serving stack explicitly supports the target/draft pairing.

- [ ] Add latency metrics.
  - Record `speculativeAttempted`, `speculativeUsed`, `speculativeFallbackReason`, `speculativeLatencyMs`, and total `deepseekLatencyMs`.
  - Surface aggregate fallback rate in the existing bridge health/debug endpoint without leaking prompts or secrets.
  - Keep the UI display simple: "Speculative lane ready/disabled/fallback" in operator diagnostics only.

- [ ] Run verification before rollout.
  - `npm.cmd run test:deepspec-speculative-client`
  - `npm.cmd run test:ava-assistant-chat`
  - `npm.cmd run test:release-status-bridge`
  - `npm.cmd run test:system-health-operator-view`
  - `npm.cmd run typecheck`
  - `npm.cmd run build`
  - `npm.cmd run doctor:local-env`
  - Hosted smoke: call `/status` on the Render bridge and verify DeepSeek remains ready with speculative disabled.

## Rollout

1. Ship env placeholders and docs with `PBK_DEEPSPEC_ENABLED=false`.
2. Deploy a separate vLLM service and validate it with non-PBK benchmark prompts.
3. Run PBK redacted prompt evals and compare median, p95, and fallback rate against the current DeepSeek live path.
4. Enable speculative decoding for a small internal-only bridge window.
5. Promote only if p95 latency improves and fallback/error rates stay within PBK production tolerance.

## Rollback

Set `PBK_DEEPSPEC_ENABLED=false` in Render and redeploy/restart the bridge. The bridge must continue using the existing DeepSeek path with no code rollback.
