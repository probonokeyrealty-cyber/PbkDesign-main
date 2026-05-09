# PBK First Live Deal Runbook

Use this runbook before the first real seller conversation that can become a contract.

## 1. Hosted Bridge

Run:

```powershell
npm run test:hosted
```

Pass criteria:
- `/health` returns `ok: true`.
- `authRequired` is `true`.
- hosted state backend is `postgres`.
- hosted revision matches the current repo revision.

## 2. DeepSeek Strategist Lane

Run a protected strategist smoke through `/invoke` with `avaAskStrategist`.

Pass criteria:
- result is `deepseek`, not `local_fallback`.
- the returned strategy includes `script`, `rule`, and `fallbackChain`.
- no API key appears in logs, state, or browser output.

## 3. TOTP Enrollment Before Enforcement

Open Settings -> `Enroll TOTP`.

Pass criteria:
- enrollment endpoint reports `configured: true`.
- operator scans or manually enters the otpauth URL.
- operator verifies one current 6-digit code.
- `/api/security/totp/status` reports `safeToEnforce: true`.

Only after that, set `PBK_TOTP_REQUIRED=true` in Render and redeploy/restart. Do not enforce before verification.

## 4. Live Data Audit

Run:

```powershell
npm run test:live-data-audit
```

Pass criteria:
- lead table is bridge-backed.
- lead detail edit saves through `PATCH /api/leads/:id`.
- campaigns add/remove leads through bridge actions.
- Brain library, market pulse, and reading suggestions render from runtime state.
- recordings page replaces static samples after runtime sync.

## 5. Desktop App

Run:

```powershell
npm run desktop:install
npm run desktop:dist
```

Pass criteria:
- installer appears under `electron-desktop/dist`.
- app opens the hosted PBK dashboard.
- tray/hotkey window opens without crashing.

## 6. Public Chat Widget

If the marketing site is this repo, deploy `public/ava-chat-widget.js` with Netlify.

If the marketing site is a separate repo, paste this snippet there:

```html
<div id="pbk-ava-public-chat"></div>
<script>
  window.PBK_PUBLIC_AVA_CHAT_ENDPOINT = "/.netlify/functions/public-ava-chat";
</script>
<script src="/ava-chat-widget.js" defer></script>
```

Pass criteria:
- public chat answers FAQs.
- public chat can save a lead request.
- public chat cannot make calls, send SMS/email, or send contracts.

## 7. One Real Deepgram Phone Proof

Make one answered call to an Ava-connected Telnyx number and speak at least 20 seconds.

Pass criteria:
- call appears in dashboard Live Calls or Activity Log.
- transcript lands from Deepgram.
- sentiment/intent fields are present.
- recording appears in Call Recordings after the Telnyx recording webhook completes.

## 8. Non-Provider Load Smoke

Run:

```powershell
npm run test:load:bridge
```

Pass criteria:
- 50 concurrent `/health` checks return success.
- no provider writes are invoked.
- p95 latency is acceptable for hosted bridge status checks.

## Stop Conditions

Pause before the first live deal if:
- DeepSeek still falls back because auth is invalid.
- TOTP is enforced before enrollment verification.
- the live phone proof has no transcript.
- lead edit saves locally only instead of through the bridge.
- approval mode or the kill switch is not visible in Settings.
