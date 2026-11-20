# Operational Audit Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. Require regression tests and independent review.

**Goal:** Run a real, no-contact 24-hour operational audit and feed signed durable results into readiness without inventing coverage.

**Architecture:** Fixed aggregate Postgres collector; separate signed audit receipts in pbk_eval_runs; existing bridge admin/maturity and proxy boundaries.

**Tech Stack:** Node ESM, pg, Jest, existing bridge and Postgres eval storage.

**Spec:** docs/superpowers/specs/2026-11-16-operational-audit-design.md

## Global Constraints

- No seller contact, provider sends, approvals, authentication changes or real lead edits.
- No caller-supplied evidence or observation-window overrides.
- Aggregate-only receipts; PBK tenancy; never persist raw payloads/errors or credentials.
- Missing/zero telemetry is not verified monitoring continuity. No automatic operational promotion.
- Preserve unrelated output/ and use codex/operational-audit-readiness from main 9649bb4.

## Tasks

- [x] Collector: tests first for fixed 24-hour bounds, tenant scope, failed/missing tables, empty sources, unsafe counts and privacy; implement bounded read-only aggregate queries and explicit coverage gaps. Worker observed 21 RED failures, then 24 GREEN checks against disposable embedded Postgres; independent review pending.
- [x] Store: tests first for HMAC, exact revision, expiry/window validation, newest failure, DB failure and independent readback; implement separate operational-audit namespace using existing pool/eval storage. Final worker tests: 75 passed, one conditional Postgres case skipped locally and passed on disposable Neon. P1 pending-admission fix independently reviewed GO.
- [x] Integration: fixed direct-founder POST, proxy denial, original observation timestamps in maturity; preserve controlled/canary/fleet semantics; add Docker and isolated boundary tests. RED/GREEN observed; proxy 53, readiness 67, CI reader/gate 94 passed. Isolated bridge and Docker closure passed. Exact collector/store clock forwarding preserves the original window.
- [ ] Verify: focused/full tests, disposable Postgres execution, build/typecheck/lint, independent security review. Publish/deploy only with explicit approval and green CI.
- [ ] Execute: exact-deployed no-contact audit, signed readback/live readiness verification, unchanged gates, redacted receipt of actual results and remaining gaps.

## Review Focus

- Zero observations cannot pass retrospective monitoring coverage.
- Query failure must remain visible, not become an empty successful result.
- Source records from other tenants or controlled fixtures must not certify PBK operations.
- Timestamps, signatures and latest-record ordering must remain durable across rereads.
- No SQL writes outside diagnostic receipt persistence and no provider dispatch paths.

## Review Progress

Parent integration static review: GO, no auth/provider-write changes. Proxy, operational-only readiness and four-suite CI gate regressions each ran RED/GREEN. Typecheck, lint and production build passed. Isolated audit bridge smoke and Docker closure passed (131 imports, 101 files).

Store review found P1: timeout, invalid completion clock or failed final persistence could leave an older pass authoritative. Fixed and re-reviewed GO: persist a pending admission before collecting, then finalize only that receipt; pending/failure blocks older passes. Collector P2 fixed: post-cutoff legitimate writes are excluded from fixed-window counts, not treated as future clocks; genuine future detection uses the database read clock. Final collector tests: 29 passed (five regression failures before the fix).

Disposable Neon execution: 194/194 tests passed across the four workflow suites, zero skipped/failed. Deleted branch independently returned HTTP 404. Final collector review cleared database read-clock and missing completion-clock corrections; collector now passes 33 tests. Whole-branch static review: GO.

Full local suite before the final collector corrections: 60 suites, 1,219 passed, 10 external-DB skips. Final rerun: 59 suites passed, one report-gate child-process test failed, 1,222 passed and 10 skipped; isolated rerun of that entire report-gate suite passed 94/94. These are not represented as a green final full run. Fresh CI is mandatory before merge/deploy. One local heartbeat recovery subprocess exceeded its five-second fixture deadline; standalone bundled-Node rerun passed without changing assertions or deadlines. Final production-hardening rerun is in progress.

The owner explicitly authorized publishing the branch/PR, then merging/deploying after CI and security review pass, followed by live 24-hour audit/readback/readiness verification. Authentication and approval settings remain unchanged, and no seller contact is authorized. No publication or live durable-audit execution has occurred yet.
