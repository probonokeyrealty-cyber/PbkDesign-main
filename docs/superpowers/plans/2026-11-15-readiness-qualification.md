# Readiness Qualification Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. Each task requires failing regressions, minimal fixes, and review.

**Goal:** Execute no-contact qualification and connect authenticated, revision-bound results to readiness without fabricating operational proof.

**Architecture:** Extend the bridge and existing `pbk_eval_runs` store. Fixed runner, signed metadata, newest-record readback and explicit controlled/operational distinctions; no new auth or provider-write authority.

**Tech Stack:** Existing Node ESM, Postgres/pg, Jest, Playwright and GitHub Actions; Neon only for disposable integration tests.

**Spec:** `docs/superpowers/specs/2026-11-15-readiness-qualification-design.md` (owner approved the short design in chat).

## Global Constraints

- No seller calls/messages, provider writes, approval decisions or real lead edits.
- Preserve authentication, Approval mode, DNC/consent/quiet-hours/kill-switch and existing approval dispatch.
- No caller-submitted qualification reports or pass flags; no operational promotion from controlled fixtures.
- Reject stale/wrong-revision/tampered/latest-failed evidence. No fallback to older successful runs.
- Preserve unrelated work and untracked `output/`. Work from main `6fafce0` on `codex/readiness-qualification`.

## Task 1: Reusable Executed Checks

Files: `ava-real-call-eval-pack.mjs`, `behavior-tests.mjs`, `silent-error-governance-smoke.mjs`, focused new tests.

- [x] TDD: importing checks must not execute/print; explicit runners return actual per-case execution results, including failures.
- [x] Export `AVA_REAL_CALL_EVAL_SCENARIO_IDS` and `runAvaRealCallQualification()` with `ok,total,passed,failed,results` (rows: `id,executed,passed,reason`). Preserve CLI behavior and every existing assertion.
- [x] Export `runBehaviorQualification()` returning non-hosted executed checks; preserve hosted CLI checks separately.
- [x] Export `runSilentErrorPolicyQualification()` with actual controlled policy regression results, not operational launch proof.
- [x] Run focused regressions and original smoke commands; review.

## Task 2: External Qualification Proof

Files: `.github/workflows/release-qualification.yml`, `release-qualification-ci.mjs`, focused tests.

- [x] Add disposable-Neon tests for `conversation-store.test.mjs` and `provider-action-dispatch.test.mjs`; require zero skipped/failed tests in the structured Jest report.
- [x] Add isolated Chromium/WebKit browser checks after a build. Do not use seller data or production DB/provider secrets.
- [x] Export `loadQualificationCiEvidence({revision,token,fetchImpl,now,timeoutMs})`: fixed repository/workflow, bounded HTTPS reads, exact head revision/repository, newest run only, complete required job steps, fresh execution times.
- [x] Return controlled outcome metadata only; reject skipped, incomplete, old, wrong-repository/revision and failed results. Do not accept arbitrary URLs or run IDs from request input.
- [x] Run red/green unit tests and validate workflow structure; review. Public fixed-repository reads work without adding a key.

## Task 3: Signed Postgres Runner And Reader

Files: `release-qualification.mjs`, focused tests; bridge admin/maturity integration and Docker allowlist.

- [x] Test signature tampering, wrong tenant/revision/source, missing/expired/future evidence, latest failure, DB failure, empty/partial cases and no caller overrides.
- [x] Fixed server runner executes Task 1, collects Task 2's trusted CI outcome, stores sanitized signed metadata in `pbk_eval_runs`, and verifies independent readback.
- [x] Domain-separate signing from authentication; never persist/print secret material. Serialize runs and use bounded existing Postgres transactions.
- [x] Founder-only admin POST accepts only `{}` and no query; deny team/proxy access without changing global permission settings.
- [x] Load the newest validated report into maturity. Controlled failed-call/behavior evidence stays explicit; policy-only silent-error results do not clear operational audit/canary/fleet gaps.
- [x] Run isolated bridge/storage/auth regression smokes and Docker closure; review. Review findings received and reproduced: transaction-start ordering and original CI expiry. Both have regression fixes; final re-review pending.

## Task 4: Execute Remaining Checks And Verify

- [ ] Independently review exact deployed controlled-agent guard before a no-contact run; verify durable readback and freshness aging.
- [x] Run disposable Postgres integrations, then verify branch cleanup. Latest three-suite run: 118 passed, zero skipped/failed, including actual delayed-transaction ordering; deleted branch independently returned 404.
- [x] Run real Chromium/WebKit fixtures in a supported environment; preserve failures or unavailable evidence honestly. Chromium 1440 and WebKit 390 passed locally; exact-revision CI remains required.
- [x] Run full unit, typecheck/lint/build, affected release checks and read-only hosted checks. Fresh full suite: 58 suites / 1,094 passed / 9 external-DB tests skipped locally; disposable Neon separately executed the skipped scope. Lint and full production hardening passed. Exact-head CI remains the publication gate.
- [ ] Record evidence and remaining operational gaps. Publishing/merging/deployment follows the existing explicit approval process; do not reuse PR #10's earlier rollout authorization.

## Publication Authorization

The owner separately approved publishing this branch, opening a PR, merging and deploying after CI/security review pass, and executing the founder-only qualification with live readiness readback. No seller contact or authentication/approval settings changes are authorized.

## Prepublication Verification

- Focused qualification/proxy suites: 178 passed, one local external-Postgres test skipped (the same test passed on disposable Neon).
- Bridge isolation/full bridge smoke and MCP typecheck passed. Frontend typecheck passed; production build passed before the final backend-only corrections.
- Two full-unit attempts and a later lint attempt exhausted this Windows host's native/commit memory. These are not passes. Full CI, lint and build must pass before merge; no tests or gates were removed.
- Security review found and fixed proxy-to-founder delegation for both qualification routes. Store review reproduced transaction-start ordering and original-CI-expiry bugs; fixes are covered by red/green tests and the real Postgres interleaving run. Final exact-commit review remains required.

## November 16 Browser Follow-up

The WebKit CI run failed while waiting for a partial fixture response; its exact cause remains unconfirmed. The fixture now uses the production SSE helper rather than a separate transport implementation, retaining all assertions and timeouts and adding transport-only failure diagnostics. A subsequent narrow-screen run exposed a separate persistence-effect race: DOM completion preceded local-storage persistence. Waiting for the exact exchange's persisted completion fixes the test synchronization without weakening its metadata assertions.

After that correction, three consecutive no-retry runs passed Chromium 1440px and WebKit 390px/320px (nine browser/viewport runs). Independent review found no issue in the fixture changes and confirmed the guard/store/runner files were unchanged. Fresh full CI and exact merged/deployed identity review are still required before rollout and controlled-agent execution.
