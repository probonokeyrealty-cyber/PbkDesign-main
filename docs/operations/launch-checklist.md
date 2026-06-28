# Production Launch Checklist

Run this checklist before a production launch, after a provider change, or after
any live-call intelligence change.

## 1. Local Verification

```powershell
npm.cmd run test:production-hardening
npm.cmd run test:bridge
npm.cmd run test:ava-governed-skill-router
npm.cmd run test:agent-fleet
```

Expected:

- every command exits `0`
- no hidden fallback or stale-truth failure appears
- bridge smoke reports `ok: true`

For a full release gate:

```powershell
npm.cmd run test:founder
```

## 2. GitHub CI

Expected:

- the current PR has `Founder Verify` as `completed success`
- the current PR has `Tooling Verify` as `completed success`
- the current PR has `Hosted Founder Smoke` as `completed success`, including protected mobile proof
- the current PR has `PBK Agent Evals` as `completed success` when the release touches Ava, approvals, CRM, memory, skills, provider actions, or migrations

Do not launch over a fresh failing workflow unless the failure is understood,
documented, and unrelated to the release.

## 3. Hosted Bridge Health

```powershell
Invoke-WebRequest -UseBasicParsing https://pbk-openclaw-bridge.onrender.com/health
```

Expected:

- HTTP `200`
- `ok: true`
- production providers marked ready or honestly optional/degraded

## 4. Production Maturity

```powershell
Invoke-WebRequest -UseBasicParsing https://pbk-openclaw-bridge.onrender.com/api/production/maturity
```

Expected:

- HTTP `200`
- `ready: true`
- `runtimeArchiveReady: true`
- `providerCircuitsReady: true`
- `failedCallEvalReady: true`
- `canaryPromotionReady: true`
- no blockers

## 5. Provider Circuits

```powershell
Invoke-WebRequest -UseBasicParsing https://pbk-openclaw-bridge.onrender.com/api/circuit/status
```

Expected:

- HTTP `200`
- `ready: true`
- `openProviders: []`
- DeepSeek, Telnyx, Deepgram, ElevenLabs, DocuSign, and Instantly are closed
  unless the action being launched does not depend on the open provider.

## 6. Runtime Archive

```powershell
Invoke-WebRequest -UseBasicParsing https://pbk-openclaw-bridge.onrender.com/api/runtime/archive
```

Expected:

- HTTP `200`
- `ready: true`
- writer is `postgres:activity_log`
- fallback buffer is visible and normally empty

## 7. Source Truth

Check source labels for the surfaces involved in the release:

- Command Center: `/state`, `/api/founder/work-queue`
- Agent Fleet: `/api/agents/registry`, `/api/agents/health`
- Campaigns: `/api/campaigns`
- Unified Inbox: conversation/timeline endpoints
- Analyzer: `/api/analyzeDeal` and analyzer state bridge

Expected:

- authoritative source or labeled fallback
- record count/freshness visible
- no stale data powering a high-stakes action

## 8. Live Call Smoke

Place one controlled inbound test call.

Verify:

- caller phone resolves to canonical lead or explicitly creates one
- final transcript turn appears
- Ava does not reply to partial speech
- turn contract detects intent/objection
- active skill or fallback reason is logged
- DeepSeek response or contract fallback is traceable
- ElevenLabs/Telnyx playback proof appears
- timeline event is written
- no duplicate seller timeline is created

## 9. Seller Message Smoke

Send one manual SMS/email only to a safe test contact.

Verify:

- selected sender identity is visible
- `source: manual` path does not create an approval task
- DNC/STOP/consent checks still run
- provider proof or failure appears
- outbound message projects into the seller timeline
- idempotency prevents duplicate sends

## 10. Contract/PDF Smoke

Use a test lead/deal.

Verify:

- analyzer fields hydrate correctly
- PDF generates with expected deal fields
- chosen seller email exists
- sender identity exists
- DocuSign readiness is true before envelope send
- envelope proof or failure projects into timeline

## Launch Decision

Launch only when all release-relevant checks are green. If a check fails, use
`docs/operations/runbook.md` and add a regression test before marking the issue
closed.

Related tests:

- `npm run test:production-hardening`
- `npm run test:bridge`
- `npm run test:founder`
- `npm run test:ava-governed-skill-router`
- `npm run test:agent-fleet`
