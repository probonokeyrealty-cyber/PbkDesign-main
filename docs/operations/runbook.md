# PBK Production Runbook

Use this runbook when any Command Center control, live call, provider action, or
agent response feels stale, silent, duplicated, or incorrect.

## Fast Debug Order

1. Check bridge health: `GET /health`.
2. Check maturity: `GET /api/production/maturity`.
3. Check circuits: `GET /api/circuit/status`.
4. Check runtime archive: `GET /api/runtime/archive`.
5. Check the affected page's source label and freshness.
6. Check the seller timeline for proof, failure, retry, or reconcile state.
7. Check canonical lead identity by normalized phone/email.
8. Check provider logs for the specific action.
9. Add the failure as a smoke test or Ava IQ case.

## Required Action States

Every critical control must move through an honest state:

```text
idle -> sending -> succeeded
idle -> sending -> failed_with_reason -> retry
idle -> sending -> provider_unknown -> reconcile_required
```

If a button does not emit one of these states to the UI, timeline, or runtime
archive, treat it as a production gap.

## Common Silent Errors

| Area              | Symptom                                  | Check                                     | Fix                                                                         |
| ----------------- | ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Bridge            | UI loads but actions fail.               | `/health` and Render logs.                | Verify env vars, restart deploy, inspect bridge errors.                     |
| Maturity          | System says ready but incidents hide.    | `/api/production/maturity`.               | Fix listed blockers before shipping.                                        |
| Runtime archive   | Failure disappears after retry.          | `/api/runtime/archive`.                   | Confirm `activity_log` write path and fallback buffer.                      |
| Provider circuits | Provider repeatedly times out.           | `/api/circuit/status`.                    | Inspect provider env, rate limit, auth, timeout.                            |
| Ava calls         | Repetitive or context-poor replies.      | Activity trace and turn contract.         | Confirm final-turn dedupe, fact ledger, and contract fallback.              |
| DeepSeek          | Frequent fallback.                       | Look for provider timeout/empty response. | Check API key, model id, live timeout, rate limit.                          |
| Telnyx SMS        | 409 or no timeline event.                | Provider result and manual-send metadata. | Ensure manual one-to-one send path bypasses approval but keeps DNC/consent. |
| Lead identity     | Same caller creates new seller.          | Normalized phone/email match.             | Merge to canonical lead and fix resolver.                                   |
| Contracts         | Send appears done but no envelope proof. | DocuSign status and HMAC events.          | Verify HMAC secret, webhook URL, template, signer email.                    |
| Campaigns         | Fallback/demo-looking data.              | `/api/campaigns` source label.            | Fix table, migration, permission, or bridge fallback reason.                |

## Live Call Debug

Check:

- caller phone matched to existing lead
- final transcript turn exists
- duplicate turn suppression ran
- turn contract selected intent/objection
- active skill fired or explicitly did not match
- DeepSeek success or contract fallback label
- ElevenLabs/Telnyx playback proof
- timeline event projected

If Ava repeats herself, add the seller snippet to the Ava IQ bench.

## Provider Debug

For each provider action, collect:

- request id or idempotency key
- provider
- endpoint/tool
- lead id/thread id/call id
- request timestamp
- result timestamp
- provider proof
- retry/reconcile state
- timeline event id

No provider action should silently disappear.

## Release Debug

Before calling production ready:

- `npm run test:production-hardening`
- `npm run test:bridge`
- `npm run test:founder`
- `gh run list --branch main`
- hosted `/health`
- hosted `/api/production/maturity`

For a launch-ready step-by-step list, use
[launch-checklist.md](./launch-checklist.md).

Related files:

- `PBK_HEALTH_MONITORING_RUNBOOK.md`
- `TROUBLESHOOTING.md`
- `RELEASE_CHECKLIST.md`
- `docs/operations/production-readiness.md`
