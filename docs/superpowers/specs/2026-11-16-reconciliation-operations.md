# Reconciliation Operations

## Release Boundary

The evidence-bound path is built locally. Publishing, deployment and production
execution require separate founder authorization. No additional key is required;
the path uses the bridge's existing founder authority and Postgres pool.

## Run After An Authorized Release

Use the direct bridge endpoint, not the Netlify proxy:

```powershell
$headers = @{ Authorization = "Bearer $env:PBK_BRIDGE_API_KEY" }
Invoke-RestMethod -Uri "$env:PBK_BRIDGE_URL/api/admin/reconciliation/run" `
  -Method Post -Headers $headers -ContentType 'application/json' -Body '{}'
```

The body must be exactly an empty JSON object. Do not supply record ids, reports,
receipt payloads, retries, resolution flags or query parameters. Team and proxy
delegation headers are rejected even when empty. Authentication settings, approval
decisions and delivery permissions are not changed by this diagnostic endpoint.

Read the existing `/api/production/maturity` endpoint afterward and inspect
`backlogReconciliation`. `verified: true` means the newest signed diagnostic
receipt was read back and still matches current source rows. It does not mean that
deliveries or full worker recovery were verified; `launchQualified` stays false.

## Interpret The Evidence

- `dispatchesLocked` counts all noncompleted dispatch records, including legacy
  records without binding hashes. Every record remains `manual_review_locked`.
- `qaRecovered` requires an exact event-specific QA record and full original
  transcript match. A similar call id or truncated transcript is insufficient.
- `memoryVerified` requires a matching real nonsynthetic embedding and exact
  original transcript hash/text. A short transcript is not a durable skip receipt.
- `deadLettersOpen` does not decrease merely because QA or memory is verified.
  Every original failure remains `review_required` with `fullRecovery: unverified`.
- `verified: false` means no diagnostic receipt can currently be trusted. Changed
  source rows, newer pending/failed admissions, bad signatures, missing tables,
  row/byte limits, expiration, revision mismatch or timeouts all fail closed.

The version-one path cannot close dead letters, unlock dispatches, retry delivery,
call a provider, run QA jobs, change approvals, create coaching follow-ups, or
change worker configuration. Complete external-delivery reconciliation requires a
separate, authenticated delivery-proof adapter and the existing approval controls;
an inline `providerProof` claim is not sufficient.

## Local Verification

```text
npm run test:backlog-reconciliation-bridge
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/backlog-reconciliation-collector.test.mjs scripts/backlog-reconciliation-store.test.mjs scripts/backlog-reconciliation-integration.test.mjs
```

Real-Postgres tests run only through the existing disposable Neon evaluation
harness, which scrubs runtime database URLs and deletes its temporary branch.
Never point these tests at Render's production database or use `--inject-runtime-db`.
