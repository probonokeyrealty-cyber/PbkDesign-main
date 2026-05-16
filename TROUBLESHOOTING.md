# PBK Troubleshooting Guide

Use this guide when PBK is live but one feature is not behaving correctly.

For the current launch bug inventory, see `BUG_TRACKER.md`.
For local Ollama/nanobot fallback notes, see `OLLAMA_NOTES.md`.

## First Check

Run:

```powershell
npm.cmd run test:hosted
```

Then check hosted health:

```powershell
$h = Invoke-RestMethod -Uri https://pbk-openclaw-bridge.onrender.com/health
$h.providers
```

## OpenAI Web Search

Symptom:

- Provider says ready, but search returns quota error.

Meaning:

- PBK is wired correctly.
- OpenAI account billing/quota is blocking the call.

Fix:

- Add credits or raise the OpenAI project budget.
- If a key was exposed in a browser snapshot, rotate it.
- Update `PBK_OPENAI_API_KEY` directly in Render.
- Redeploy Render.

Expected result:

- `openAiWebSearch.ready = true`
- Direct `openAiWebSearch` returns `result: live`

Fallback behavior:

- If OpenAI fails, Rex/Ava return a clearly labeled PBK Brain fallback instead of hanging.

## BatchData Missing

Symptom:

- Health shows `batchdata: missing 1 env`.

Fix:

- Set `PBK_BATCHDATA_API_KEY` in Render.
- Redeploy Render.

Impact:

- Skip trace and BatchData-powered enrichment remain unavailable until configured.

## OpenClaw Gateway Diagnostics

Symptom:

- Hosted health shows the OpenClaw brain gateway as `standby`.

Meaning:

- This is expected when hosted Render is in heartbeat-only mode and no fresh local heartbeat has arrived.
- Hosted Render should not direct-dial a local loopback OpenClaw gateway.

Fix:

- Run `npm.cmd run openclaw:heartbeat:once` from the local machine when you want the hosted bridge to see a fresh local gateway.
- Do not set a loopback `OPENCLAW_GATEWAY_URL` in Render.
- Keep direct gateway URLs empty in hosted production unless a real reachable tunnel is intentionally configured.

Expected result:

- `npm.cmd run test:live-data-audit` continues to pass the heartbeat-only checks.
- `/api/gateway/status` reports `heartbeat_only`, `outbound_heartbeat`, or a fresh heartbeat without `ECONNREFUSED` noise.

## ElevenLabs Not Speaking

Check:

- `PBK_ELEVENLABS_API_KEY`
- `PBK_ELEVENLABS_TTS_ENABLED=true`

Then:

- Redeploy Render.
- Test `/api/voice/tts` through the dashboard voice panel.

## Deepgram Browser Voice

Check:

- `PBK_DEEPGRAM_API_KEY`
- `PBK_BROWSER_VOICE_ENABLED=true`
- Browser mic permission granted.
- Private bridge key saved in dashboard Settings.

If browser voice works but phone proof is incomplete, place one real answered call and speak for a few seconds.

## PDF Endpoint 502

The hosted PDF renderer can occasionally return a transient `502`.

Fix:

- Retry `npm.cmd run test:hosted`.
- If it fails twice, redeploy Render.
- If it still fails, check Render logs around `/api/documents/pdf`.

## TOTP Lockout Risk

Do not set `PBK_TOTP_REQUIRED=true` until the admin has saved the authenticator secret.

Safe sequence:

1. Generate `PBK_TOTP_SECRET`.
2. Store the secret in a password manager.
3. Enroll it in an authenticator app.
4. Set `PBK_TOTP_SECRET` in Render.
5. Set `PBK_TOTP_REQUIRED=true`.
6. Redeploy.
7. Verify login immediately.

## Provider Writes

SMS, email, calls, and contracts should stay approval-gated.

If a provider write happens without approval:

1. Set kill switch/read-only mode.
2. Check recent bridge activity.
3. Review Slack approval events.
4. Do not resume writes until the cause is understood.
