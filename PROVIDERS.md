# PBK Providers — going from stubs to live

The bridge wraps four outbound providers behind tool handlers (`telnyx_call`, `telnyx_sms`, `sendDocuSign`, `skipTrace`, `slackNotify`). Each provider has the same shape:

- **Without env vars set** → handler runs in stub mode: records activity, returns a synthetic result, marks `live: false`.
- **With env vars set** → handler fires the real outbound HTTPS call. Returns `live: true` plus the provider response.

`/health.providers.<name>` reports `{configured, ready, missing}` for each — call it as the first step of any provider debugging.

## Telnyx (voice + messaging)

**Already wired by Codex (commit `c2b9f1c`).** Keep this section for completeness.

### What you need

- Telnyx account with at least one phone number and one Voice Application + Messaging Profile.
- Two-factor auth secured.

### Env vars (Render dashboard → service → Environment)

| Key | Value |
|-----|-------|
| `PBK_TELNYX_API_KEY` | Telnyx API key (starts with `KEY...`) |
| `PBK_TELNYX_FROM_NUMBER` | E.164 from-number (e.g. `+16145550100`) |
| `PBK_TELNYX_CONNECTION_ID` | Voice Application ID (numeric) |
| `PBK_TELNYX_MESSAGING_PROFILE_ID` | Messaging Profile ID |
| `PBK_TELNYX_WEBHOOK_URL` | Optional. Defaults to `$PBK_PUBLIC_BASE_URL/api/webhooks/telnyx` |
| `PBK_PUBLIC_BASE_URL` | `https://pbk-openclaw-bridge.onrender.com` |

### Verify

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health \
  | jq '.providers.telnyx'
```

Expect `configured: true`, `messagingReady: true`, `voiceReady: true`.

### Test outbound SMS (uses real Telnyx)

```bash
curl -s -X POST https://pbk-openclaw-bridge.onrender.com/invoke \
  -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"telnyx_sms","params":{"to":"+1614YOURNUM","body":"PBK live SMS test"}}' \
  | jq .
```

If `result.telnyx.live` is `true`, real SMS sent. Check the recipient's phone.

### Webhooks back to the bridge

Configure your Telnyx Voice Application's webhook URL to:

```
https://pbk-openclaw-bridge.onrender.com/api/webhooks/telnyx
```

The bridge's `mapTelnyxWebhook` handler maps Telnyx events into bridge `eventType`s (`call-control`, `message-status`, etc.) so live calls/messages update the activity feed in real time.

---

## Deepgram (voice transcription + sentiment)

Deepgram is wired through the official JavaScript SDK for both prerecorded smoke tests and Telnyx media-stream transcription.

### Env vars

| Key | Value |
|-----|-------|
| `PBK_DEEPGRAM_API_KEY` | Deepgram project API key |
| `PBK_DEEPGRAM_MODEL` | `nova-2` by default for prerecorded smoke tests |
| `PBK_DEEPGRAM_LIVE_MODEL` | `nova-2-meeting` by default for live streams |
| `PBK_DEEPGRAM_TELNYX_ENCODING` | `mulaw` for Telnyx PCMU streams |
| `PBK_DEEPGRAM_TELNYX_SAMPLE_RATE` | `8000` for Telnyx PCMU streams |
| `PBK_TELNYX_MEDIA_STREAM_TOKEN` | Random shared token appended to Telnyx `stream_url` |
| `PBK_DEEPGRAM_STREAM_CALLS` | Set `true` only after the public bridge stream URL is verified |
| `PBK_DEEPGRAM_ANALYZE_RECORDINGS` | Optional post-call recording transcription/sentiment |

### Verify

```bash
npm run deepgram:smoke
```

Expect `provider: "deepgram"`, `mode: "live"`, a transcript preview, and a sentiment object.

For provider readiness:

```bash
curl -s http://127.0.0.1:8788/api/deepgram/health
```

### Telnyx live media stream

When the bridge is public, configure Telnyx media streaming to:

```
wss://<bridge-host>/api/webhooks/telnyx/media?token=<PBK_TELNYX_MEDIA_STREAM_TOKEN>
```

The bridge forwards Telnyx `media.payload` frames to Deepgram and saves final transcript/sentiment rows into `unified_messages`. Keep the stream token set before exposing the WebSocket endpoint publicly.

Deepgram itself does not require a dashboard-side "connection" for this PBK flow. The required connection is on the Telnyx side: Telnyx streams audio to PBK's WebSocket, and PBK opens the authenticated Deepgram live transcription socket with `PBK_DEEPGRAM_API_KEY`.

---

## DocuSign (envelope send via JWT auth)

### What you need

A DocuSign developer (sandbox) or production account, RSA keypair, and impersonation consent for the user. ~15 minutes one-time setup.

### Step 1 — create the integration

1. Sign in to https://admindemo.docusign.com (sandbox) or https://admin.docusign.com (production).
2. Navigate to **Apps and Keys** (left sidebar under Integrations).
3. Click **Add App and Integration Key**.
4. Name: `PBK Bridge`. Save.
5. Note the **Integration Key** — that's `PBK_DOCUSIGN_INTEGRATION_KEY`.

### Step 2 — generate RSA keypair

Locally on your machine:

```powershell
# Windows PowerShell
openssl genrsa -out pbk-docusign-private.pem 2048
openssl rsa -in pbk-docusign-private.pem -pubout -out pbk-docusign-public.pem
```

Open `pbk-docusign-public.pem` in a text editor, copy the entire content (including the BEGIN/END markers).

In DocuSign Admin → your integration → **Service Integration** section → **Add RSA Keypair** → paste the public key → save.

The private key (`pbk-docusign-private.pem`) goes into Render as `PBK_DOCUSIGN_PRIVATE_KEY`. Render's env var UI accepts multiline strings — paste the full PEM, including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`.

### Step 3 — grant impersonation consent

Construct the consent URL:

```
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INTEGRATION_KEY>&redirect_uri=https://www.docusign.com
```

(For production, replace `account-d.docusign.com` with `account.docusign.com`.)

Open it in a browser, sign in as the operator user, click **Allow**. After redirect, the consent is recorded — close the tab.

### Step 4 — find user ID + account ID

In DocuSign Admin → **Settings** → **Apps and Keys** → click your integration. Below the integration key:

- **User ID** (UUID format) — that's `PBK_DOCUSIGN_USER_ID`.
- **API Account ID** — that's `PBK_DOCUSIGN_ACCOUNT_ID`.

### Step 5 — set Render env vars

| Key | Value |
|-----|-------|
| `PBK_DOCUSIGN_INTEGRATION_KEY` | (from step 1) |
| `PBK_DOCUSIGN_USER_ID` | (from step 4) |
| `PBK_DOCUSIGN_ACCOUNT_ID` | (from step 4) |
| `PBK_DOCUSIGN_PRIVATE_KEY` | full PEM body (from step 2) |
| `PBK_DOCUSIGN_AUTH_HOST` | `account-d.docusign.com` (sandbox) or `account.docusign.com` (prod) |
| `PBK_DOCUSIGN_REST_BASE` | `https://demo.docusign.net/restapi` (sandbox) or `https://www.docusign.net/restapi` (prod) |

Render auto-redeploys after env var save.

### Verify

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health \
  | jq '.providers.docusign'
```

Expect `configured: true`, `ready: true`, `missing: []`.

### Test envelope send

```bash
curl -s -X POST https://pbk-openclaw-bridge.onrender.com/invoke \
  -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "sendDocuSign",
    "params": {
      "leadName": "Test Seller",
      "address": "123 Main St, Test City, OH",
      "amount": 75000,
      "template": "assignment",
      "signers": [{"name": "Test Seller", "email": "you@example.com"}]
    }
  }' | jq '.result'
```

Expect `docusign.live: true` and a non-empty `envelope.envelopeId`. Check the signer's inbox for the DocuSign email.

The bridge auto-generates the deal package PDF as the envelope document — same code path as `/api/documents/pdf`.

---

## BatchData (skip-trace)

### What you need

A BatchData account with skip-trace credits. https://batchdata.com → **Get API Key**.

### Env vars

| Key | Value |
|-----|-------|
| `PBK_BATCHDATA_API_KEY` | bearer token from BatchData dashboard |
| `PBK_BATCHDATA_BASE_URL` | `https://api.batchdata.com` (default; override only for staging) |

### Verify

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health \
  | jq '.providers.batchdata'
```

Expect `configured: true`, `ready: true`.

### Test skip-trace

```bash
curl -s -X POST https://pbk-openclaw-bridge.onrender.com/invoke \
  -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "skipTrace",
    "params": {
      "address": "1600 Pennsylvania Ave NW",
      "city": "Washington",
      "state": "DC"
    }
  }' | jq '.result'
```

Expect `batchData.live: true` and a `contact` object with `phone`/`email`/`phones`/`emails` populated.

If `live: false`, check `batchData.error` — most often it's a credit balance issue or a malformed address.

---

## Slack (incoming webhook + interactive approvals)

PBK supports two Slack paths:

- Incoming webhook for simple alerts and notifications.
- Bot token + interactive endpoint for Approve / Reject buttons on approval requests.

### What you need

A Slack incoming-webhook URL for the channel you want PBK alerts in.

### Step 1 — create the webhook

1. https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name: `PBK Bridge`. Pick the workspace.
3. Left sidebar → **Incoming Webhooks** → toggle on.
4. **Add New Webhook to Workspace** → pick the channel (e.g. `#pbk-alerts`) → **Allow**.
5. Copy the **Webhook URL** (starts with `https://hooks[.]slack[.]com/services/...`).

### Env vars

| Key | Value |
|-----|-------|
| `PBK_SLACK_WEBHOOK_URL` | Incoming webhook URL for simple notifications |
| `PBK_SLACK_BOT_TOKEN` | Slack bot token with `chat:write` for interactive approval messages |
| `PBK_SLACK_APPROVAL_CHANNEL_ID` | Channel ID where PBK should post approval cards |
| `PBK_SLACK_SIGNING_SECRET` | Slack app signing secret for `/api/slack/interactions` verification |

### Verify

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health \
  | jq '.providers.slack'
```

Expect `configured: true`, `ready: true`.

### Interactive approvals

Set the Slack app's Interactivity Request URL to:

```text
https://<bridge-host>/api/slack/interactions
```

When `PBK_SLACK_BOT_TOKEN` and `PBK_SLACK_APPROVAL_CHANNEL_ID` are set, `createApproval` posts a Block Kit approval card with **Approve** and **Reject** buttons. Those buttons call the bridge's existing `approval-callback` path, so campaign/provider writes still obey PBK's approval-gated state machine.

### Test direct notify

```bash
curl -s -X POST https://pbk-openclaw-bridge.onrender.com/invoke \
  -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"slackNotify","params":{"text":"PBK live Slack test :rocket:"}}' \
  | jq '.result'
```

Expect `slack.live: true` and a Slack ping in your channel.

> **Note**: this is the bridge's *direct* Slack-from-tool path — separate from the n8n "PBK Bridge Health Alerts" workflow which handles Slack alerts on workflow failures. Both can coexist; they hit Slack differently and serve different purposes.

---

## Quick smoke-test all four providers at once

After setting env vars and waiting for Render to redeploy:

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health \
  | jq '.providers | to_entries | map({name: .key, configured: .value.configured, ready: (.value.ready // .value.messagingReady // .value.voiceReady)})'
```

Output should show `configured: true` for each provider you've set up.

## Troubleshooting

**`PBK_DOCUSIGN_PRIVATE_KEY` returns "secret_or_private_key must have a value"**
- The PEM didn't paste cleanly. Make sure it includes `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` and that newlines preserved.

**DocuSign auth returns `consent_required`**
- Step 3 (impersonation consent) wasn't completed for this user. Open the consent URL in a browser, sign in as the same user whose UUID is in `PBK_DOCUSIGN_USER_ID`, click Allow.

**Telnyx returns `Invalid messaging_profile_id`**
- The messaging profile ID env var has the wrong value. In Telnyx dashboard, **Messaging → Messaging Profiles**, copy the UUID from the row's URL.

**BatchData returns `401 Unauthorized`**
- Re-check the API key. BatchData uses Bearer auth — the bridge sends `Authorization: Bearer $PBK_BATCHDATA_API_KEY`.

**Slack webhook returns `no_text` or `404`**
- Webhook URL is malformed or revoked. Recreate the webhook in Slack admin.

**`/health.providers.X.ready` is `false` even after setting env vars**
- Render may still be on the old deploy. Wait ~3 minutes, then re-curl. If still false, manual deploy in Render dashboard.
