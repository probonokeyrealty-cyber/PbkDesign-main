# Evidence-Bound Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist source-bound internal recovery receipts without unlocking unknown deliveries or weakening launch gates.

**Architecture:** Fixed read-only source collection feeds a separately signed suite in the existing Postgres evaluation store. The existing founder-only bridge boundary runs it and production maturity reads current evidence; provider executors and source rows are untouched.

**Tech Stack:** Node ESM, pg, existing HMAC/canonical JSON/transaction helpers, Jest/PGlite, existing bridge smoke harness.

**Spec:** `docs/superpowers/specs/2026-11-16-evidence-bound-reconciliation.md`

## Global Constraints

- Authentication and approval gates remain unchanged.
- No seller calls, messages, delivery retries, provider reads/writes, or tool invocations.
- Never modify source rows or promote partial recovery to delivery/launch proof.
- PBK scope only; persist opaque references, enums, counts and keyed fingerprints only.
- No push, merge, deployment, or production execution in this build task.

## Review Focus

- Similar call ids or truncated transcripts must not prove exact original recovery.
- A changed original/proof row or a newer failed/pending attempt invalidates old evidence.
- Read-only collection, timeouts and pool size one must not leak connections or hang.
- Fake inline provider proof and pending approvals must never unlock a dispatch.
- Supplemental recovery counts must not clear existing audit/canary/approval gates.

### Task 1: Fixed Evidence Collector

**Files:** Create `scripts/backlog-reconciliation-collector.mjs` and `.test.mjs`.

**Interfaces:** Implement the collector and strict validator exactly as in the spec.

- [x] Write failing real-SQL/PGlite tests for exact QA binding, changed sources, tenant isolation, fake provider proof, missing tables, overflow, timestamps, timeouts and read-only rollback.
- [x] Observe expected RED failures before implementation.
- [x] Implement fixed bounded source reads and redacted keyed bindings.
- [x] Run the collector suite GREEN and inspect output for sensitive-data leakage.

### Task 2: Durable Signed Receipt Store

**Files:** Create `scripts/backlog-reconciliation-store.mjs` and `.test.mjs`.

**Interfaces:** Implement execute/read with the spec's callback injection; consume Task 1 validator. `collect` takes `{ now }` and returns the collector result. Reader requires fresh successful collection and exact reconciliation equality.

- [x] Write failing tests for exact signatures, tenant/revision/row binding, current-source validation, latest pending/invalid wins, late completion, expiration, CAS, failed storage and single-client-pool release.
- [x] Observe RED, implement separate signed suite with pending admission and independent readback, then run GREEN.
- [x] Include optional disposable-Postgres coverage using existing PBK test URL conventions, never a production URL.

### Task 3: Founder Boundary And Readiness Integration

**Files:** Modify `scripts/openclaw-local-server.mjs`, `netlify/functions/pbk-bridge-proxy.ts`, existing founder-boundary tests, relevant package/Docker dependency declarations. Create `scripts/backlog-reconciliation-bridge-smoke.mjs` and integration tests as needed.

Also extend `.github/workflows/release-qualification.yml` and its structured-report gate regression to require the new store's disposable-Postgres coverage with zero skipped tests.

The success-path gap is covered by `scripts/backlog-reconciliation-integration.test.mjs`: run the actual maturity snapshot in an isolated context and bind real source/QA/memory fixtures through the collector and store in a schema-scoped disposable database. The CI report gate now requires six suites.

- [x] Write failing founder/proxy and maturity tests, observe RED.
- [x] Wire fixed empty-body founder POST and supplementary source-current maturity evidence.
- [x] Add tests proving partial recovery leaves existing audit failures blocked and cannot invoke executors.
- [x] Run focused suites and isolated bridge smoke GREEN.

### Task 4: Verification And Review

- [ ] Run collector/store/boundary/readiness regressions serially, plus typecheck, lint, build, bridge syntax and dependency-closure checks.
- [ ] Obtain independent security/spec/code review; fix substantive findings with regression tests.
- [ ] Record actual results and remaining limitations; preserve unrelated `output/` and do not publish.
