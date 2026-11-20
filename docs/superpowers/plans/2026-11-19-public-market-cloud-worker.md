# Public Market Cloud Worker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, then a fresh independent whole-branch review.

**Goal:** An explicitly prepared and approved Rex public-market brief executes in a bounded E2B worker and returns to the existing Brain research panel.

**Architecture:** Fixed worker program plus injectable public-SDK driver; sealed admin-task ticket and durable started marker in the bridge; existing research-job/status surfaces. Default-off and no production deployment.

**Tech stack:** Node22, E2B public SDK2.64.0, node:test, existing PBK React/legacy UI and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-public-market-cloud-worker.md`.

## Global constraints

- Public market data only; no CRM/lead/model/provider credentials in the workload.
- One approved task, one60-second network-disabled sandbox, fixed code, mandatory cleanup.
- Existing approval and Brain lanes; current Composio inventory privileges unchanged.
- Default-off, staged code only until concrete credential/usage activation approval.

## Review focus

- Forged/replayed/modified approvals must not run providers.
- Create/execute/cleanup timeouts and late responses must not report false success.
- Untrusted source text is data; output must bind to the exact input and sources.
- Settings, command preparation, callbacks and Retry must never run a sandbox.
- Persist started status before provider execution; crash/restart cannot replay it.

### Task1: Bounded worker and driver

Files: `scripts/lib/public-market-worker.mjs`, `scripts/fixtures/public-market-program.mjs`, focused node tests, package/lock.

- [x] Write failing tests for normalization, input/output binding, default-off, fixed SDK options, no caller code, output bounds and cleanup failures/timeouts.
- [x] Implement the fixed program and public-SDK driver with injectable create/search functions.
- [x] Pass worker execution and policy tests without live providers.

### Task2: Approval-backed bridge and research jobs

Files: bridge, worker controller, isolated bridge fixture/tests.

- [x] Test prepare-only behavior, sealed ticket, replay/override denial, durable-start marker and provider failure.
- [x] Route the explicit Rex command and approved admin action before generic/model fallback.
- [x] Persist only bounded job/result metadata; pass real isolated bridge tests with business collections preserved except intended admin/research records.

### Task3: Existing surfaces and qualification

Files: Settings, runtime types, legacy Brain/status, browser smoke and operations proposal.

- [x] Add truthful worker readiness and E2B job labels; re-prepare instead of executing Retry.
- [x] Build/typecheck and exercise desktop/iPhone/320px with no passive provider requests.
- [x] Run regression and independent review. Draft PR against the inventory branch follows final verification.
- [x] Request only the remaining concrete credential and bounded staging activation approval after implementation is reviewable.

Verification: focused24/24, existing Composio41/41, isolated bridge/offline workflow, app/MCP typechecks, lint, build, Docker107 imports, Brain and Settings desktop/iPhone/320px passed. Independent review findings were fixed; see the staging operations proposal for the remaining approval. No live worker or deployment proof is claimed.
