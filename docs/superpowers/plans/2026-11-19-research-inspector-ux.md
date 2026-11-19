# Research Inspector UX Implementation Plan

> REQUIRED WORKFLOW: Use superpowers:executing-plans inline and request an independent whole-branch review at completion.

**Goal:** Make explicit research inspection easier to understand inside the original PBK UI.

**Architecture:** Presentation-only extension of AgentResearchTools; existing fixed invocation/projection and subject isolation stay authoritative.

**Tech Stack:** React, existing PBK CSS, isolated Playwright component and Fleet fixtures.

**Spec:** docs/superpowers/specs/2026-11-19-research-inspector-ux-design.md

## Global constraints

No provider/admin writes, new navigation, automatic invocation, tool execution, new dependencies or backend changes. Preserve current identity reset, error redaction and previous snapshot retention.

## Review focus

Guidance must describe the actual state without implying readiness; local time must preserve timezone and exact ISO; loading must remain accessible; mobile containment must survive longest guidance; passive UI must make zero invokes.

### Task 1: Status clarity and visual hierarchy

- [x] Add focused browser tests for fixed state guidance, semantic tone, busy announcement and readable exact timestamps; observe expected failure.
- [x] Add trusted status guidance, local time formatting, compact badge/header and semantic chip styling in existing component/CSS only.
- [x] Run component suite, typecheck/lint/build and full Fleet desktop/mobile proof. Inspect screenshots.
- [ ] Independent whole-branch review, address blockers, then commit/PR and required CI. Release only after checks pass; leave Composio disabled pending dedicated key approval.

## Verification

Two new browser cases failed before implementation; all26 passed afterward and independently in review. Typecheck/lint/build passed. Full Fleet fixture passed Chromium1440, WebKit390 and Chromium320, including explicit-only inspection, previous-result retention, selection isolation and existing approval controls. Desktop screenshot inspected; original PBK visual tokens retained. Independent whole-branch review found no actionable issues. CI and release are pending.
