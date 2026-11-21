# PBK Leads roster navigation implementation plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development for multi-agent implementation when assigned. Track each step below.

**Goal:** Add a labeled, direct link to each exact lead workspace and restore roster context on return.

**Architecture:** Reuse the existing Leads rows, workspace link, and validated lead return state. Capture the return position when the link is used and retain the link as the focus target.

**Tech stack:** React, TypeScript, CSS, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-leads-roster-navigation-design.md`

## Checks and implementation

- [x] Extend the existing queue browser test. Verify the separate preview still selects a row, open a different lead directly, and verify the canonical route and saved comps. Check the restored search, filter, page and focus on desktop and mobile, with zero property refreshes or business writes. Confirm it fails at the new link.
- [x] Make the existing mobile link visible in text and share the same action in desktop rows. Preserve native link behavior and capture the current scroll on in-app navigation. Style it with existing PBK tokens and check 320px and 390px containment.
- [x] Run the queue and Ava evidence regressions, inspect the built roster in Chromium and WebKit, verify the build and typecheck, and inspect the local diff.
