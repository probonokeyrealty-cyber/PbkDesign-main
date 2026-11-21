# Proof-First Analytics Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct analytics evidence end to end and polish its existing lead inspection workflow locally.

**Architecture:** Shared pure financial/stage helpers feed the existing bridge analytics builders and frontend view model. Read responses carry explicit financial coverage and period metadata; the UI and CSV withhold unsupported values. Existing routes, providers, state stores, and approval handlers stay unchanged.

**Tech Stack:** Existing Node ESM, React/TypeScript, Vite, PBK CSS, Node test runner, and Playwright Chromium/WebKit.

**Spec:** `docs/superpowers/specs/2026-11-21-proof-first-analytics-design.md`

## Global Constraints

- Local isolated export only; no push, merge, deployment, provider requests, or live data/draft access.
- Preserve PBK assets, typography, exact IDs, approvals, duplicate protection, and existing draft stores.
- Tests use synthetic state and temporary browser contexts; reject writes and external network.
- No migration, state reset, financial backfill, or provider-handler edit.
- Missing financial evidence is not zero; recorded revenue is not proof of paid cash.

## Review Focus

- Signed/unsigned/assigned/incomplete and contradictory labels cannot manufacture closed deals.
- Missing, zero, invalid, negative, and mixed-basis money must retain their evidence state.
- Legacy responses without evidence metadata cannot manufacture a revenue/cost ratio.
- Partial/fallback data and mismatched periods cannot produce authoritative financial summaries.
- Exact-ID drilldowns, range return, draft storage, and error recovery must survive mobile navigation.

### Task 1: Financial evidence and bridge reporting

**Files:** create `src/app/utils/analyticsEvidence.mjs`, `scripts/analytics-evidence.node-test.mjs`; modify read-only analytics builders in `scripts/openclaw-local-server.mjs`; add isolated bridge regression coverage.

**Interfaces:** shared `normalizeDealStage(value)`, `isClosedDealStage(value)`, `readAnalyticsMoney(value)`, `recordedDealRevenue(record)`, and `summarizeRecordedRevenue(records)` return explicit nullable values and coverage, without mutating input.

- [x] Write and run regressions showing the current assigned-stage and estimated-profit/amount failures.
- [x] Implement exact stage aliases and explicit recorded-revenue parsing; preserve zero versus missing.
- [x] Wire bridge read builders to helpers; add period and revenue/cost coverage metadata and separate estimated AI costs.
- [x] Prove isolated bridge GETs do not modify sample protected state and that guards reject external provider access.

### Task 2: Frontend, CSV, and workflow polish

**Files:** modify `src/app/routes/analyticsRuntimeLogic.js`, `src/app/routes/Analytics.tsx`, necessary response types in `src/app/utils/runtimeBridge.ts`, scoped Analytics CSS, and existing analytics tests.

**Interfaces:** the existing `buildAnalyticsViewModel` supplies nullable monetary values, financial evidence state, source/period context, and a conservatively gated recorded-revenue/AI-cost ratio. `buildAnalyticsCsv` exports the same values/bases without coercing unknown into zero.

- [x] Add failing normalization/CSV regressions for legacy/partial data, zero, mixed costs, stage collisions, and mismatched periods.
- [x] Implement evidence gating, remove invented per-row costs, and name metrics precisely.
- [x] Reuse PBK layout; add concise evidence status/details and truthful missing/loading/failure labels.
- [x] Preserve exact lead IDs and range/focus return on existing drilldown navigation.
- [x] Run focused reporting, wiring, range, and safety tests; retain all substantive checks when updating obsolete financial assumptions.

### Task 3: Local browser proof and review

**Files:** create a local-only synthetic analytics preview fixture/browser proof and verification notes; update relevant existing browser assertions for the new evidence contract.

- [x] Run typecheck and production build in the isolated export.
- [x] Verify desktop Chromium 1440px, Chromium 320px, and mobile WebKit 390px; save and inspect screenshots.
- [x] Exercise partial/empty/error data, CSV, range races, exact-ID lead handoff/back, unchanged draft fingerprints, and zero provider/lead writes.
- [x] Request one independent whole-change review; fix important findings with regression tests.
- [x] Start the read-only local preview and provide its URL, test counts, remaining limits, and changed-file list. Do not push or deploy.

## Local Execution Rulings

- Execute directly in this session under the founder's explicit instruction to build locally; do not introduce another planning-approval round.
- Keep artifacts in the already isolated export. Its parent worktree is dirty, so never use implicit git staging or commit from this export.
- No commits are made in this task; local-only review is the requested delivery.
- Contract dates are creation-cohort evidence, not closing dates. Label that basis and withhold a closing-period revenue/cost ratio until actual comparable closing-date evidence exists. Recorded entries are not independently verified payments.
