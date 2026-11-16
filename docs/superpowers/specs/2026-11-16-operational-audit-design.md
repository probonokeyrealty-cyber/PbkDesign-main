# Durable Operational Audit

## Approved Direction

The owner selected a 24-hour durable Postgres audit plus current health/security checks, signed persistence, and fail-closed readiness. No seller calls/messages or authentication/approval-setting changes are permitted.

## Data And Boundaries

Use fixed aggregate SELECTs against the existing PBK runtime archive, provider dispatch, dead-letter, conversation projection, and safety/QA records, plus current database security/catalog and runtime configuration checks. Tenant/workspace scope is PBK only. Collect counts and timestamp bounds; never persist transcripts, contact information, credentials, raw exception messages, or provider payloads.

An empty table or zero in-memory SLO counters cannot establish monitoring coverage. Report missing tables, failed queries, missing timestamps and unverified monitoring continuity explicitly. A 24-hour query window alone does not prove 24 hours of collection. Keep the operational audit blocked unless required source coverage and monitoring continuity are genuinely verified. Do not create monitoring activity or synthetic seller interactions to manufacture that evidence.

## Execution And Persistence

Reuse the bridge's Postgres pool and existing public.pbk_eval_runs store, using a separate operational-audit suite/source and domain-separated HMAC with the existing server credential. Bind the sanitized report to deployed revision, run ID, fixed observation window and original timestamps. Persist passing, failed and incomplete executions and independently verify readback. Reject unsigned, stale, future, wrong-revision, tampered or incomplete records; never fall back to an older pass after a newer failure.

Add a direct-founder-only empty POST under the existing admin namespace. Reject team/proxy delegation, query overrides and caller reports. Netlify must not delegate founder authority to this route. Do not change global authentication, approval mode, approvals, provider permissions or seller records.

Record a durable pending receipt before collecting. Finalize only that receipt after collection; if collection times out, its completion clock is invalid, or final persistence fails, the pending/failed newest receipt must continue blocking older passes. Diagnostic receipt INSERT/UPDATE is the only permitted write. Never manufacture completion timestamps or hold a pooled connection while invoking a collector that needs the same pool.

## Readiness

Display verified audit results and source coverage separately from controlled regressions. Supply silentErrors evidence only from a verified server-executed audit receipt, with passed=false whenever any required check/coverage is failed or unverified. Missing storage or readback means unavailable, never healthy. Preserve independent canary, seller-delivery and organic fleet/latency gates.

## Delivery

Use regression-first tests, disposable Postgres round trips, isolated bridge/proxy boundary checks, full release CI and independent security review. Publication/deployment requires separate explicit owner authorization; PR #12's rollout approval does not authorize this release. Live execution must use the exact reviewed deployed revision and produce no seller contact.
