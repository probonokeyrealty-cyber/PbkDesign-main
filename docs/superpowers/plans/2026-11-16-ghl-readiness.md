# HighLevel Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement in this session. The founder chose execution rather than another approval round.

**Goal:** Build a tested, read-only HighLevel review package for completeness, ownership, and dated next steps.

**Architecture:** Consume explicit record snapshots and native field definitions. Evaluate without provider access; generate local reports and native view recipes. No change to the existing UI, live CRM, or approval bridge.

**Tech Stack:** Existing Node ESM, node:test, JSON configuration.

**Spec:** docs/superpowers/specs/2026-11-16-ghl-readiness-design.md

## Global Constraints

- Production untouched; no provider writes, task creation, outreach, merges, or enrollments.
- Preserve DND; exclude QA from operational queues.
- Unknown facts remain unknown. No invented owner, consent, date, or underwriting.
- Keep private snapshots/reports in .pbk-local.
- Reuse existing native fields, pipelines, and PBK approval architecture.

## Review Focus

- Missing/ambiguous custom-field definitions must fail visibly rather than map the wrong field.
- One contact owning multiple houses must retain separate property accountability.
- Completed tasks and unrelated contact tasks must not masquerade as the current property next step.
- Date-only deadlines and invalid offset timestamps must not receive invented precision.
- Repeat snapshots and potential duplicates must never produce duplicate operational entries or writes.

### Task 1: Native field contract and pure evaluator

**Files:** config/ghl/wholesale-readiness.v1.json; scripts/lib/ghl-readiness.mjs; scripts/ghl-readiness.node-test.mjs.

**Interfaces:** evaluateReadiness(snapshot, {now, timeZone}) returns coverage, accountability, restrictions, diagnostics, and ID-only review queues. Snapshot contains contacts, opportunities, tasks, fieldDefinitions, tasksComplete.

- [x] Write failing tests for completeness, restrictions, identity, and due/task semantics.
- [x] Run node --test scripts/ghl-readiness.node-test.mjs; confirm missing behavior fails.
- [x] Implement field resolution and pure evaluation; no network or provider client.
- [x] Run tests and verify input remains unchanged across repeated runs.

### Task 2: Local preview runner and native view recipes

**Files:** scripts/preview-ghl-readiness.mjs; docs/operations/2026-11-16-ghl-readiness.md; synthetic fixtures in scripts/fixtures/ghl-readiness.json.

**Interfaces:** CLI accepts --input, --output-dir, --now; writes report.json/report.md only beneath .pbk-local. No write/deploy flag. Uses evaluateReadiness from Task 1.

- [x] Add failing CLI tests for repeatability, argument validation, privacy destination restriction, and no source mutation.
- [x] Implement runner and document the minimum snapshot contract and native worklist recipes.
- [x] Run the full readiness test file plus the existing lead intelligence tests.
- [x] Run synthetic and retained QA evidence previews; verify QA appears only in excluded diagnostics.

### Task 3: Review and record proof

- [x] Have a fresh reviewer inspect only this slice for safety and semantic mistakes.
- [x] Fix important findings with a failing regression test first.
- [x] Record commands, counts, limitations, and exact deployment status in the operations note.
- [x] Leave unrelated existing work and production unchanged; do not push or deploy.
