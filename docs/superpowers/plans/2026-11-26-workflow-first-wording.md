# Workflow-First Wording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved daily workflow understandable without internal jargon.

**Architecture:** Extend the existing operator-copy utility and existing React
surfaces. Change presentation and labels only; retain all existing event handlers,
draft storage and approval/provider boundaries. Execute natively in this session.

**Tech Stack:** React, TypeScript, Vite, existing PBK CSS, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-workflow-first-wording-design.md`

## Global Constraints
Local only. Preserve fonts, palette, navigation, routes, storage keys and write
handlers. No deploy/push, lead edits, calls or outbound messages. Isolated samples
only; deny provider traffic and business writes in browser proofs.

## Review Focus
- Queue/approval labels never imply completed delivery.
- Approval confirmations retain preflight, disabled states and safe cancellation.
- Long labels fit at 320/390px without shrinking below current readable UI sizes.
- Lead edit cancellation and Analyzer navigation never replace existing drafts.
- Existing test selectors follow actual visible labels, not hidden compatibility copy.

## Task 1: Wording And Existing Controls
Files: `operatorCopy.ts`, `CommandCenter.tsx`, `Inbox.tsx`, `DecisionRail.tsx`,
`DealAnalyzerChrome.tsx`, `AnalyzerTab.tsx`, `App.tsx`, `LeadPortalHeader.tsx`.
- [x] Add failing copy tests for waiting/approved/delivery distinctions and decision labels.
- [x] Observe RED; implement only labels and shared copy helpers.
- [x] Keep all business handlers, routes and persistence code unchanged.
- [x] Run copy contracts and update existing label-specific regression assertions.

## Task 2: Responsive Polish And Proof
Files: `src/styles/faster-triage.css`, `src/styles/pbk-components.css`, `scripts/workflow-first-browser-smoke.mjs`.
- [x] Add failing browser assertions for explicit action names and mobile containment.
- [x] Add wrapping, 44px targets and focus styles scoped to existing workflow surfaces.
- [x] Verify desktop Chromium and mobile Chromium/WebKit with sample data and zero writes.
- [x] Verify approval cancel, edit cancel, drafts and saved notes/comps; capture screenshots.
- [x] Run build/typecheck and relevant existing regressions; review the diff.
- [x] Leave local changes uncommitted and unpushed for founder review.

Verification and the additional bridge-smoke startup limitation are recorded in
`docs/operations/2026-11-26-workflow-first-local-verification.md`.
