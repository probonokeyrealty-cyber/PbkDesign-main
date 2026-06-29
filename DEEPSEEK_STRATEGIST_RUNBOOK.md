# PBK DeepSeek Strategist Runbook

## Purpose

The DeepSeek strategist lane gives Ava and Rex a coaching brain for edge cases: unfamiliar objections, personal rapport calibration, repair-heavy negotiations, and counteroffers outside current authority.

It is advisory only. Provider writes, contracts, calls, SMS, and final offer changes stay approval-gated.

## Render Environment

Set these in Render private environment variables:

```text
PBK_DEEPSEEK_API_KEY=<private DeepSeek key>
PBK_DEEPSEEK_BASE_URL=https://api.deepseek.com
PBK_DEEPSEEK_MODEL=deepseek-v4-pro
PBK_DEEPSEEK_FALLBACK_MODEL=deepseek-v4-flash
PBK_STRATEGIST_PROVIDER=deepseek
```

Do not commit the API key.

Optional speculative-decoding lane, disabled by default:

```text
PBK_DEEPSPEC_ENABLED=false
PBK_DEEPSPEC_ENDPOINT=<private vLLM or compatible OpenAI API base>
PBK_DEEPSPEC_API_KEY=<private endpoint token>
PBK_DEEPSPEC_PROVIDER=vllm
PBK_DEEPSPEC_TARGET_MODEL=deepseek-v4-flash
PBK_DEEPSPEC_DRAFT_MODEL=<DeepSeek-compatible draft checkpoint>
PBK_DEEPSPEC_NUM_SPECULATIVE_TOKENS=5
PBK_DEEPSPEC_TIMEOUT_MS=2500
PBK_DEEPSPEC_FALLBACK_ENABLED=true
```

Do not point production DeepSeek traffic at a Qwen/Gemma draft checkpoint. The public DeepSpec release includes Qwen3 and Gemma drafts, which are useful for local evaluation and integration proofing, but Ava production needs a DeepSeek-compatible draft or a dedicated vLLM speculator service.

## Tools

`avaAskStrategist`

Use when Ava confidence drops, a seller raises a novel objection, or a live call needs veteran guidance. The bridge stores the request in `pbk_learning_requests`, stores durable rules in `pbk_knowledge`, and falls back to the local PBK playbook if DeepSeek is unavailable.

`pbk_teach_ava`

Turns approved coaching into permanent Ava knowledge and memory. Strategic/core behavior updates require the protected admin passcode or an approval queue item.

`recordRepairs`

Stores line-item repair estimates in `pbk_repair_items` and PBK memory.

`sendNegotiationApproval`

Creates a rich negotiation approval with MAO, repairs, seller ask, recommendation, estimated spread, and Ava final script.

`avaOverrideOffer`

Records an approved final offer and returns Ava's exact delivery script. Requires an approved approval id or protected passcode. If neither is provided, it queues approval instead of changing the offer.

## Smoke Test

Run locally:

```powershell
npm run test:strategy
```

Expected result:

- DeepSeek may be missing locally; the local PBK playbook fallback should answer.
- Repair items should store.
- Negotiation approval should queue.
- Offer override should block without approval/passcode and queue approval safely.

## Safety Rules

- Never hardcode keys.
- Never let DeepSeek directly authorize a provider write.
- Never let a strategy response exceed MAO without approval.
- Store only durable rules that help Ava listen, qualify, protect PBK, and return to the seller's goal.
