# PBK Launch Ready Status

Last reviewed: 2026-05-08

## Green For Launch

- OpenAI credits and live web search: ready.
- OpenAI fallback: ready. If quota fails, Rex/Ava return a labeled PBK Brain fallback instead of hanging.
- Deepgram browser voice: ready.
- ElevenLabs TTS: ready.
- DocuSign production endpoints: ready.
- Lead Portal strategy placement: ready.
- Founder Approval Board wording: ready.
- Provider APIs desktop overflow: fixed.
- Inbox page scroll behavior: fixed.
- Render bridge: live.
- Netlify frontend: live.
- GitHub `main`: clean and pushed.
- Hosted state backend: Postgres.
- Local founder gate: `npm run test:founder` passing.
- Hosted smoke: `npm run test:hosted` passing.

## Remaining Human-In-The-Loop Proofs

### 1. One Real Answered Deepgram Phone Proof

Status: not completed.

Reason: this requires a real answered phone call with speech.

Safe proof steps:

1. Confirm the operator is available to answer.
2. Keep provider writes approval-gated.
3. Trigger one approved outbound call or call Ava through the inbound Telnyx route.
4. Speak for at least 10 seconds.
5. Verify transcript/sentiment in bridge activity and `pbk_intent_events`.

### 2. TOTP Enforcement

Status: code-ready, not enforced.

Reason: enabling TOTP before authenticator enrollment can lock protected routes.

Safe enrollment steps:

1. Run:

```powershell
node .\scripts\generate-totp-secret.mjs
```

2. Save the generated secret in a password manager.
3. Add the `otpauth://` URL to an authenticator app.
4. Set `PBK_TOTP_SECRET` in Render.
5. Keep `PBK_TOTP_REQUIRED=false`.
6. Redeploy Render.
7. Verify a code against `/api/security/totp/verify`.
8. Only then set `PBK_TOTP_REQUIRED=true` and redeploy.

## Optional Upgrades

### LiteLLM Proxy

Status: optional.

Purpose: route model calls through a proxy/fallback layer to reduce cost and avoid future quota interruptions.

PBK already supports an OpenAI-compatible base URL:

- `PBK_OPENAI_BASE_URL`
- `PBK_OPENAI_API_KEY`

Requirement: the proxy must support `/v1/responses` and web search pass-through if you want Rex live web search through that proxy.

### Bytebot Worker

Status: optional advanced automation.

Purpose: give Ava a desktop automation worker for county records, probate portals, title pulls, and UI-only sites.

Recommended launch posture:

- Add Bytebot as a controlled MCP worker.
- Keep destructive desktop automation approval-gated.
- Start with one task: open a county records site and retrieve a single property record.

### Nightly Ava Learning

Status: workflow template added.

Import:

- `n8n-lite/pbk-nightly-ava-learning.workflow.json`

This runs Ava memory learning every night and posts a summary through `pbk_send_update`.

## Remaining Provider Gap

- `PBK_BATCHDATA_API_KEY`: optional BatchData enrichment/skip-trace key.

## Launch Decision

PBK is launch-ready for supervised, approval-gated operation.

Do not announce fully autonomous operation until:

- One real answered Deepgram phone proof is complete.
- TOTP is enrolled and verified before enforcement.
- First live campaign is run under approval mode and reviewed.
