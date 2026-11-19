# Lead-linked Ava Chat Isolation Implementation Plan

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with fresh focused implementers, independent spec/code review and a final whole-branch review.

**Goal:** Preserve the correct lead's chat continuity without carrying another lead's draft, session or history into it.

**Architecture:** A pure URL/storage scope resolver and a keyed existing AvaChat session. Keep existing runtime, composer, global approval queue and cleanup paths.

**Tech Stack:** React/TypeScript, existing browser storage, Node tests and isolated Chromium/WebKit fixtures.

**Spec:** docs/superpowers/specs/2026-11-19-ava-lead-chat-isolation-design.md

## Global constraints

Original design and controls; no backend/CRM/provider/approval changes or new dependencies. General operator legacy storage stays intact. Linked data never falls back to global keys. Invalid explicit context fails closed. No automatic submit, research, microphone or speech.

## Review focus

URL aliases/duplicates/malformed IDs; initial hydration overwrites; same-route lead switching; late stream completion; old global data ownership; storage denial; existing approval behavior and mobile containment.

### Task 1: Lead scope and keyed continuity

- [x] Add isolated RED reproduction of current cross-lead continuity and pure URL/key validation tests.
- [x] Implement scope utility and keyed wrapper/session in existing AvaChat, scoped keys and restoration-gated safe persistence. Preserve existing normalization, approval/queue behavior and cleanup.
- [x] Verify pure scope tests and browser A→B→A/general continuity, explicit submit payload, late-stream isolation, passive zero submits and storage denial; type/lint. Independent task review.

### Task 2: Integration and release

- [x] Coordinator runs build, existing Ava Chromium/WebKit mobile smoke, focused scoped browser proof and plan-alignment check; inspect original-design screenshots and mobile overflow.
- [x] Wire narrowly scoped regression coverage into the existing browser-installed Release Qualification gate without adding browser dependencies to Founder-only Node gates.
- [ ] Independent whole-branch review; task branch/PR and all final-head release checks before merge. Verify merged source and live Netlify/Render revision using existing release seams. Composio key approval remains separate.

## Local verification

Actual-component RED confirmed A's draft, session and request history survived A→B before the fix. Node22 and independent review pass14focusedcases (5resolver,9actual-componentbrowser). A second real-CSS RED exposed the hidden storage notice; fixed-header status now stays visible with long restored histories at320/390 and includes keep-chat-open guidance.

Typecheck/lint, full UI release suite,95qualification-reader checks,43existing command/stream-client checks and plan alignment pass. Rebuilt full-shell Chromium1440/WebKit390/WebKit320 proof passes streaming, cancellation, history, mission/approval and untouched general storage. A quota-failure fixture confirms the notice, composer and Send are fully inside the viewport with no automatic POST. Desktop/mobile screenshots inspected; fixtures are fictional and isolated. Final review/CI/deployment remain pending.
