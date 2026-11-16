# Executed Readiness Qualification

## Approved Direction

The owner selected the existing Postgres eval store and a fixed founder-only
qualification runner. Authentication and provider approval gates stay unchanged.
No seller calls, SMS, emails, contracts or campaign sends are permitted.

## Approach

Use `pbk_eval_runs`, not another database or settings flag, as the durable result
store. The server executes fixed no-contact policy/behavior checks, records both
success and failure, signs the resulting metadata, and reads back the newest
record for readiness. Do not accept submitted reports, scenario lists, timestamps,
revisions or pass flags through HTTP/invoke/settings. Verified GitHub Actions
results may supply the disposable-Postgres and browser qualification outcomes;
Postgres remains the runtime source of truth.

Alternatives considered: using CI artifacts as the primary runtime authority
would add another storage/retrieval path; accepting settings or caller reports
would not establish execution provenance. The owner chose the existing-store
approach.

## Evidence Boundaries

- A successful controlled regression is real execution proof for that regression,
  not an organic seller conversation or delivery receipt.
- Failed-call turn-contract cases and behavioral checks can satisfy controlled
  evaluation gates with explicit scope/provenance.
- Silent-error policy regression does not prove absence of operational errors.
  Keep the operational silent-error audit unverified until that audit exists.
- Independent operational canary, seller delivery and organic fleet measurements
  remain blocked when their evidence is absent. Do not invent latency budgets.
- Bind every record to the deployed full Git revision, execution times, unique
  run identity and complete case results. Reject legacy, tampered, expired,
  future, wrong-revision or incomplete proof. Never substitute an older pass for
  the latest failure.
- Store only non-sensitive qualification metadata, never seller transcripts,
  contact data, credentials or raw command output.

## Runtime Integration

Expose a fixed POST under the existing admin namespace. Require the direct
founder bearer credential and reject team/proxy delegation, query parameters and
nonempty bodies. Reuse the existing Postgres connection and bounded transaction
patterns; serialize qualification execution without altering provider leases.
Readiness must report storage/readback failures as unavailable, not success.

The reader validates a domain-separated server signature using the existing
server credential; this does not change authentication settings or expose keys.
No new provider, orchestration service or frontend screen is introduced.

## Qualification Work

Run the eight previously skipped Postgres integration cases on a disposable Neon
branch with production database variables scrubbed. Run Chromium and WebKit
against isolated browser fixtures. Independently review the existing controlled
agent guard before executing its no-contact, fixture-only workflow and freshness
aging checks. Preserve any failure as evidence; do not weaken tests to obtain a
ready flag.

Code publishing and rollout remain subject to the existing reviewed PR and
explicit deployment process. The earlier PR #10 deployment approval does not
silently authorize an unrelated release.
