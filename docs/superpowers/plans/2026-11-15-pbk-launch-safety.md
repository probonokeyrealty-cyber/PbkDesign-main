# PBK Launch Safety Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. Each task requires failing regressions, minimal fixes, and review.

**Goal:** Make the existing PBK execution paths fail closed on missing underwriting evidence, mismatched approvals, failed nurture sends, and absent readiness proof.

**Architecture:** Preserve the bridge as authority. Extend the existing approval dispatch, nurture state, calculator inputs, and maturity helpers; no new providers or orchestration framework. Local isolated tests must never use production credentials or contact sellers.

**Tech Stack:** Node ESM, existing Jest/node smoke tests, React/Vite for the existing mobile composer verification.

**Spec:** `docs/operations/2026-11-15-pbk-team-launch-assessment.md`, Approach A, selected by the owner.

## Global Constraints

- Keep all provider/admin writes approval-backed; preserve existing explicit manual authorization rules.
- Keep DNC, quiet-hours, kill-switch, shared dispatch leases and authentication unchanged or stronger.
- No new secrets, paid services, external memory export or production provider calls.
- Work on `codex/pbk-launch-safety`, based on latest fetched main; preserve concurrent changes and untracked output.
- No production deployment is authorized by selecting the implementation priority alone.

## Review Focus

- Approval IDs supplied directly to invoke must not authorize modified actions or bypass dispatch consumption.
- Missing/zero/malformed money inputs and stale cached analysis must never be promoted to verified deal truth.
- Provider acceptance is not delivery; failure, pending approval and unknown outcomes must not silently complete nurture.
- Missing/stale/wrong-revision evaluations and same-version canaries must not become green evidence.
- Composer source assertions must follow the actual responsive implementation without removing overflow protection.

## Task 1: Nurture Outcome Safety

Files: `scripts/nurture-agent.mjs`, focused `scripts/nurture-outcome-safety.test.mjs`, existing nurture smoke if its contract changes.

- [x] Reproduce failed/pending/unknown send progression and SMS payload mismatch with an isolated fake SQL adapter and real module logic.
- [x] Normalize SMS to the existing body/message contract; preserve the current step and record an honest unsuccessful/pending outcome instead of advancing. Prevent automatic repeated sends while awaiting approval/reconciliation.
- [x] Test successful terminal proof, transient/permanent failures, missing invoke adapter, approval-pending, ambiguous acceptance, and repeat processing.
- [x] Run focused Jest and existing nurture tests; review changed paths.

## Task 2: Analyzer Missing-Input Safety

Files: existing analyzer helper/bridge handler and new isolated analyzer regression smoke.

- [x] Reproduce incomplete analysis returning hashed ARV/repairs and persisting a completed run.
- [x] Remove address-hash estimates from operational analysis. Return `analysis_incomplete` with missing inputs, no operational numeric projection/cache write. Preserve explicit zero repairs and complete supplied inputs.
- [x] Test missing ARV, missing repairs, zero repairs, invalid/negative inputs, complete calculator inputs, and unchanged canonical lead state after failure.
- [x] Run analyzer-sync/property roundtrip and isolated bridge checks; review callers that consume the summary.

## Task 3: Exact-Action Approval Execution

Files: bridge guard/replay/override paths, a focused authorization helper if needed, isolated approval regression smoke.

- [x] Prove unrelated/changed/consumed approved IDs reach the general guard today.
- [x] Replace status-only guard bypass with exact approved action validation and the existing shared-lease dispatch path; no direct provider handler bypass.
- [x] Test wrong tool, changed recipient/body/amount, missing binding, consumed action, identical retry, and protected offer override. Preserve explicit trusted manual paths without accepting arbitrary approval IDs.
- [x] Run provider dispatch, approval-unison, safety and bridge tests; review replay and lifecycle callers.

## Task 4: Truthful Maturity Evidence

Files: `scripts/production-maturity-loop.mjs` or focused existing-seam helper, related tests, parent-owned bridge integration; agent measurement changes only if warranted by evidence.

- [x] Reproduce packaged failed-call/canary defaults becoming passes without executed evidence.
- [x] Require timestamped, revision-matched evaluation evidence; absence is unknown/not-ready. Same-version references cannot establish canary promotion.
- [x] Separate latency kinds rather than applying a phone/startup budget to full long-form completion; preserve slow samples and honest unknown states.
- [x] Test missing/stale/future/wrong-revision evidence, real failures, controlled-vs-operational provenance and long generation with valid first-token observations.
- [x] Run maturity and fleet suites, then inspect the bridge's actual response in an isolated process.

## Task 5: Integration And Release Verification

- [x] Reproduce current composer CI assertion, inspect responsive CSS/markup, make the smallest faithful correction and retain desktop/mobile containment checks.
- [x] Review the full diff independently; fix important issues with regression tests.
- [x] Run full unit suite, typecheck, lint, build, founder gate, packaging and bridge isolation checks. Record unrelated failures explicitly.
- [x] Run read-only hosted smoke separately; it verifies the deployed version, not local changes. No seller-contact drill or browser speech playback is performed without the operator's approval.
- [x] Write verification evidence with exact commands/results and remaining live-release requirements. Do not push/deploy without authorization.

## Progress

- Initial baseline: existing worktree verified; fast-forwarded to fetched main `a277e5c`; created `codex/pbk-launch-safety`.
- No provider writes, production settings, or keys changed.
- Tasks 1-4: implemented and independently reviewed. Full unit result: 54 suites, 912 passed, 8 skipped. Chromium desktop/390px/320px passed.
- Ruling: existing evaluation writers do not produce attested revision-bound failed-call/canary proof; runtime reports unavailable rather than trusting caller data. Wiring trusted qualification evidence remains a release prerequisite, not a fabricated pass.
- Ruling: nurture callbacks do not reconcile terminal receipts yet; unresolved steps remain paused for manual reconciliation, with no automatic resend.
- Ruling: source-based release fixtures referenced old pre-streaming markup and the pre-queue persistence wrapper. Updated their assertions/adapters to test current behavior without altering the product UI or weakening safety tests.
- Task 5: completed local verification. Founder checks were reconciled across resumed runs, not one uninterrupted wrapper invocation. The final unit rerun, launch-safety smokes, typecheck, lint, build and Docker import closure passed. See `docs/superpowers/verification/2026-11-15-pbk-launch-safety.md` for exact results, skipped database qualification and remaining release conditions.
- At the local verification handoff, no commit, push, merge, deployment or worktree cleanup had been performed. The owner subsequently authorized pushing `codex/pbk-launch-safety` and opening a PR against `main`; that authorization does not include merging into `main` or production deployment.
- PR preparation synchronized the feature branch with `origin/main` at `0dfcab6`, preserving the newer CRM/triage work. Two test conflicts and two policy/copy fixture mismatches were resolved. Fresh combined-tree unit, build/typecheck/lint, resumed release/runtime, packaging and Chromium 1440px/390px/320px checks passed; full PR CI and the recorded live qualification requirements remain separate.
