# Ava DeepSpec Runbook

DeepSpec is PBK's optional speculative-decoding lane for Ava/Rex DeepSeek traffic. It is a latency accelerator only. It does not change Ava's action authority, approval policy, CRM write policy, contract gates, or provider-send rules.

## Production Rule

Keep `PBK_DEEPSPEC_ENABLED=false` until a private vLLM-compatible endpoint proves it is faster and stable on PBK prompts.

Speculation runs inside the inference server, which must load both the target weights and a compatible draft/speculator. PBK cannot add target-token verification around the hosted `api.deepseek.com` API. The existing endpoint client routes requests to an already configured server; it does not enable speculation there.

Render hosts PBK's bridge, not the GPU inference service in this proposal. Render's published compute plans specify CPU/RAM and do not document the claimed $19-49/month GPU option. A separate GPU host, a target/draft pairing supported by the selected engine version, and measured cost are prerequisites. See [Render compute plans](https://render.com/docs/compute-plans), [DeepSpec supported families](https://github.com/deepseek-ai/DeepSpec), and [vLLM speculative decoding](https://docs.vllm.ai/en/stable/features/speculative_decoding/).

The interactive Ava chat path explicitly passes `speculative: false`. Operator chat now uses a shared 30-second model budget and up to 4096 output tokens so detailed explanations can complete, with no fixed word/sentence cap. Seller phone-turn timing remains separate. Enabling the speculative env flag does not accelerate `/api/assistant/chat`. Conversation wording, history continuity, and token streaming are separate concerns from speculative decoding.

Do not claim a 10x production gain until PBK benchmarks show it across p50, p95, fallback rate, and answer quality. Speculative decoding can reduce decode latency, but Ava's full turn also includes prompt prefill, network, bridge work, tool planning, provider calls, JSON validation, approval checks, speech, and UI rendering.

## Environment

```text
PBK_DEEPSPEC_ENABLED=false
PBK_DEEPSPEC_ENDPOINT=
PBK_DEEPSPEC_API_KEY=
PBK_DEEPSPEC_PROVIDER=vllm
PBK_DEEPSPEC_TARGET_MODEL=deepseek-v4-flash
PBK_DEEPSPEC_DRAFT_MODEL=
PBK_DEEPSPEC_NUM_SPECULATIVE_TOKENS=5
PBK_DEEPSPEC_TIMEOUT_MS=900
PBK_DEEPSPEC_FALLBACK_ENABLED=true
```

`PBK_DEEPSPEC_ENDPOINT` must point to an OpenAI-compatible server that exposes `/v1/chat/completions`. PBK does not send speculative server config per request; the vLLM service must be launched with speculation already enabled.

## vLLM Service Shape

Example only:

```bash
vllm serve <target-model> \
  --host 0.0.0.0 \
  --port 8000 \
  --api-key "$PBK_DEEPSPEC_API_KEY" \
  --speculative-config '{"method":"draft_model","model":"<draft-model>","num_speculative_tokens":5}'
```

Required before enabling:

- `/v1/chat/completions` returns an OpenAI-compatible chat completion.
- `/v1/models` shows the expected target model.
- `/health` or equivalent health probe passes.
- `/metrics` or service logs expose speculative acceptance and latency data.
- The draft/speculator is compatible with the target model and chat template.
- Tool/function-calling behavior is tested separately if that route is used.

Qwen/Gemma DeepSpec checkpoints are useful for local integration proofing, but they are not production drafts for DeepSeek target traffic unless the serving stack explicitly supports that pairing.

## Dataset Export

Create a redacted PBK prompt/answer JSONL for DeepSpec evaluation or draft-model data prep:

```bash
npm run deepspec:export-ava-dataset -- --out .pbk-training/deepspec/ava-speculative-dataset.jsonl
```

The exporter redacts emails, phones, exact street addresses, secrets, credentials, and obvious seller/contact identifiers. It writes local files only and never changes Render, OpenClaw, DeepSeek, CRM, Slack, SMS, email, or DocuSign state.

Use explicit input files when testing:

```bash
npm run deepspec:export-ava-dataset -- --input .pbk-training/ava-training-data.jsonl --out .pbk-training/deepspec/ava-speculative-dataset.jsonl
```

## Benchmark Gate

Run these before any production flip:

```bash
npm run test:deepspec-speculative-client
npm run test:deepspec-bridge-fallback
npm run test:deepspec-export-ava-dataset
npm run test:deepspec-benchmark-gate
npm run test:ava-assistant-chat
npm run test:release-status-bridge
```

Then benchmark current DeepSeek versus the speculative endpoint on the same redacted prompts. Track:

- p50, p90, p95, and p99 end-to-end Ava chat latency.
- DeepSpec endpoint latency.
- Baseline DeepSeek endpoint latency.
- accepted speculative tokens, rejected tokens, acceptance length, and acceptance rate.
- fallback rate and reason: timeout, HTTP error, malformed response, reasoning-only, empty response, not configured.
- JSON/schema validity, tool-call validity, answer non-empty rate, and approval-gate compliance.

Write the benchmark summary to JSON and run the executable promotion gate:

```bash
npm run deepspec:benchmark-gate -- .pbk-training/deepspec/benchmark-summary.json
```

Promotion criteria:

- p95 is materially better than baseline.
- fallback rate stays inside PBK tolerance.
- no answer-quality regression on golden Ava/CRM/approval prompts.
- provider-send and contract gates remain unchanged.

## Canary

1. Deploy the vLLM service with private auth.
2. Set `PBK_DEEPSPEC_ENDPOINT`, `PBK_DEEPSPEC_API_KEY`, and model env vars in Render.
3. Leave `PBK_DEEPSPEC_ENABLED=false`.
4. Run offline and canary benchmarks.
5. Enable for an internal-only window with `PBK_DEEPSPEC_FALLBACK_ENABLED=true`.
6. Watch `llm_deepspec_attempts`, `llm_deepspec_accepts`, `llm_deepspec_fallbacks`, and `llm_deepspec_latency_ms`.
7. Promote only after stable benchmark and live canary proof.

## Rollback

Set:

```text
PBK_DEEPSPEC_ENABLED=false
```

Restart the Render bridge. The bridge will use the existing DeepSeek path without code rollback.
