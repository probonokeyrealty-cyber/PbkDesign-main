# Today start action implementation plan

> **For agentic workers:** Use superpowers:executing-plans and track each step below.

**Goal:** Make the first useful action on Today clear without changing the existing call, approval, or CRM workflow.

**Architecture:** Derive the action from visible call and approval state and resolved rows in the existing ranked queue. Reuse the contextual call row and section jumps. Render queue availability as status text.

**Tech stack:** React, TypeScript, CSS, Playwright, Vite.

**Spec:** `docs/superpowers/specs/2026-11-20-daily-workflow-ux-design.md`

## Constraints

- Preserve the PBK shell, visual tokens, exact lead handoff and approval behavior.
- Use only existing reads and page links. Fixture tests block provider reads and writes.
- Keep the action and queue usable at 320px and 390px.

## Review focus

- A hidden widget, unresolved row or unconfirmed approval cannot drive the primary action.
- Loading, unavailable, incomplete fallback and confirmed empty queues have distinguishable text.
- An observed call ending changes the action to review. A reviewed call moves to secondary emphasis.
- Keyboard navigation moves focus to the section on request. Data changes preserve focus.
- Returning from an exact-ID lead preserves the existing queue anchor.

## Task: implement and verify Today

- [x] Add fixture scenarios to `scripts/faster-triage-browser-smoke.mjs` for call, approval, ranked work, loading, fallback, clear, and unavailable states. Extend its existing exact-ID, overflow and network checks.
- [x] Run `node scripts/faster-triage-browser-smoke.mjs` and confirm it fails on the missing Today action.
- [x] Update `src/app/routes/CommandCenter.tsx` to assign one starting action, resolve queue destinations before rendering, and render a status for unavailable or empty queues. Preserve section links, review handlers and queue return state.
- [x] Update `src/styles/faster-triage.css` using existing Today row and PBK tokens for the responsive treatment.
- [x] Run the browser regression, Today approval browser checks, queue and mobile smoke, build, typecheck, isolated hosted smoke, and two-lead Ava voice regression.
