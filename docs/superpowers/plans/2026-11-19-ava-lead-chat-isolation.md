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

- [ ] Add isolated RED reproduction of current cross-lead continuity and pure URL/key validation tests.
- [ ] Implement scope utility and keyed wrapper/session in existing AvaChat, scoped keys and restoration-gated safe persistence. Preserve existing normalization, approval/queue behavior and cleanup.
- [ ] Verify pure scope tests and browser A→B→A/general continuity, explicit submit payload, late-stream isolation, passive zero submits and storage denial; type/lint. Independent task review.

### Task 2: Integration and release

- [ ] Coordinator runs build, existing Ava Chromium/WebKit mobile smoke, focused scoped browser proof and plan-alignment check; inspect original-design screenshots and mobile overflow.
- [ ] Wire narrowly scoped regression coverage into the existing browser-installed Release Qualification gate without adding browser dependencies to Founder-only Node gates.
- [ ] Independent whole-branch review; task branch/PR and all final-head release checks before merge. Verify merged source and live Netlify/Render revision using existing release seams. Composio key approval remains separate.
