# E2B Cloud Inventory Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Ava/Rex an explicitly triggered, scoped cloud-inventory read through the existing Composio bridge.

**Architecture:** Add a fixed E2B profile to the existing read-only MCP connection lifecycle. Keep separate instances, credentials, status and immutable session pins; reuse Command Center Settings and legacy runtime summaries.

**Tech Stack:** Node 22, MCP SDK, existing React/legacy PBK shell, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-e2b-cloud-inventory.md`.

## Global constraints

- Default off; no passive provider calls, business writes, sandbox jobs or production activation.
- Only `E2B_LIST_SANDBOXES`, fixed `{limit: 100}`, Ava/Rex only.
- Show first-page count and pagination honestly; no IDs/metadata/logs.
- Preserve QA-contact isolation and original PBK design.

## Review focus

- Cross-profile/account/session drift must fail before execution.
- Extra tools, caller overrides and schema changes must fail closed.
- Disabled/configuration-missing checks must not fall through to other providers.
- Late results cannot restore disconnected readiness; evidence expires.
- Loading Settings and mobile layouts must not invoke Composio.

### Task 1: Scoped adapter and agent route

Files: `scripts/lib/composio-connection.mjs`, `scripts/composio-cloud.node-test.mjs`, `scripts/openclaw-local-server.mjs`, fixture/bridge tests.

- [x] Add failing tests for default-off/no passive I/O, exact args and bounded safe output, profile/account isolation, strict tools/scope and command denials.
- [x] Generalize only the shared lifecycle around two fixed profiles; retain QA behavior.
- [x] Route explicit cloud commands before the QA route, using a separate connection instance.
- [x] Pass focused tests and real isolated bridge/MCP fixtures with business collections unchanged.

### Task 2: Existing status surfaces and qualification

Files: `src/app/routes/Settings.tsx`, `index.html`, Settings browser smoke, `package.json`, operations doc.

- [x] Add the existing-pattern E2B inventory card and legacy summary with truthful disabled/read-verified states.
- [x] Build, run Settings browser checks at desktop/iPhone/320px and verify zero passive cloud calls.
- [x] Run existing bridge/MCP/Docker qualification and inspect diff before committing.
- [x] Document restricted-session provisioning and activation limits; do not deploy production.

## Execution ledger

- Ruling: branch from the existing Composio staging tip `04ce33b`, preserving the separate PR #46 branch and production main. This avoids transplanting QA staging credentials/code into production.
- RED: cloud module import failed for missing factory. Bridge status tests failed for missing cloud field; Settings browser test failed for absent cloud card. GREEN: adapter/protocol/bridge tests and desktop/iPhone/320px Settings checks passed after implementation.
- Baseline: parallel execution initially exceeded two existing 15-second bridge startup deadlines. An isolated startup probe passed in6995ms, and serial integration passed without changing timeout/guard behavior. The Composio script now runs test files serially.
- Independent reviewer: no critical/important findings; both minor coverage suggestions (paginated tool manifest, mixed configured profiles) implemented and passed.
- Ruling: stop before new scoped project-key provisioning and hosted activation. The existing E2B provider key is not a Composio runtime key; do not extract CLI credentials, reuse production catalog credentials or broaden them to bypass this boundary.
- Final qualification:41/41 focused tests, full app/MCP typecheck, nine bridge-isolation tests, isolated offline bridge smoke and Docker import closure passed. Settings current-source build/browser checks passed on desktop Chromium, iPhone WebKit and320px WebKit, including zero passive cloud calls and reload. Final independent review of implementation and activation proposal found no critical/important issues.
