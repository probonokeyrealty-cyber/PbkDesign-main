# Targeted Readiness Repairs Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. Require regression tests and independent review. Steps use checkbox syntax for tracking.

**Goal:** Repair proven schema/security and evidence-wiring gaps without touching production or relaxing safety gates.

**Architecture:** Explicit targeted migration; existing bridge/Postgres evidence paths; validated per-channel fleet policy. No new app or alternative approval system.

**Tech Stack:** Node ESM, PostgreSQL/PGlite, existing Jest and bridge smokes.

**Spec:** docs/superpowers/specs/2026-11-16-targeted-readiness-repairs-design.md

## Global Constraints

- No production writes/deployments, seller calls/messages, delivery retries or dispatch unlocks.
- Authentication/approval gates and PBK-only scope remain unchanged.
- No raw seller content in evidence receipts; no guessed or retroactively fabricated success.
- Preserve unrelated work and existing UI.

## Review Focus

- RLS must not accidentally grant access, force owner lockout, leak another tenant or rewrite approvals/dispatches.
- Missing recording/learning columns and partially applied schema must fail explicitly or converge safely.
- Memory receipts must not certify historical execution from caller claims or length alone.
- Timing policy cannot merge channels, confuse first token with completion or cap long replies.
- Fixture/test evidence cannot become organic operating history, canary or seller-delivery proof.

## Tasks

- [x] 1. Schema/security: explicit migration/runner and 31 disposable role/tenant tests implemented; final independent review includes schema/security.
- [x] 2. Memory: signed bounded store, 75 regressions and genuine-execution wiring implemented; independent memory review GO.
- [x] 3. Fleet: validated policy and bridge wiring implemented; reviewer missing-milestone finding reproduced red and fixed green (140 focused tests).
- [x] 4. Bridge/runtime packaging, test commands, explicit migration boundaries and mandatory guarded real-Postgres CI proof integrated.
- [x] 5. Run focused regressions, unit suites, typecheck/lint/build, isolated bridge smokes and import closure; resolve independent whole-branch review findings.

## Execution Ledger

- Branch: codex/targeted-readiness-repairs, based on merged 8cea9ae.
- Ruling: build only; previous deployment authorization does not authorize this branch's release or a production security migration.
- Ruling: old short transcripts stay unverified without actual execution evidence; do not lower thresholds or fabricate recovery.
- Ruling: controlled qualification/audit refresh and organic/canary evidence are separate operations, not automatic green status.
- Ruling: enable default-deny RLS without adding permissive tenant policies or FORCE; preserve the existing privileged owner contract, fail on unexpected ACL/role/schema drift.
- Verification so far: typecheck/lint/build, 140 Docker imports across 105 files, isolated no-delivery reconciliation smoke, 500 focused tests (2 conditional old Postgres skips), 31 PGlite migration cases.
- Three dedicated Neon Postgres runs passed the actual migration/repeat/receipt/tamper proof. Temporary branches were deleted; both guarded runs independently confirmed 404. The final run also used explicit verified driver fields before fixture reset.
- Existing six-suite disposable Postgres qualification passed, and its temporary branch was independently confirmed deleted (404).
- Final independent review GO after reproducing and fixing a connection-URI override hazard in the disposable fixture. New guard regressions: 28 passed; latest eight-suite focused run: 352 passed, 1 conditional Postgres skip (covered in the dedicated Postgres qualification).
- Full unit verification: 67 suites passed, 1678 tests passed, 12 database-conditional skips. The original in-band run stalled inside PGlite WASM error handling and was stopped; the complete retry passed in 71 seconds with `--maxWorkers=2 --workerIdleMemoryLimit=128MB`, runtime URLs scrubbed, and a structured local report. No assertions, test selection or CI gates were weakened.
