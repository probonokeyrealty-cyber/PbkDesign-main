# Mobile Chat Density Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with one focused implementation pass per task and review between tasks.

## Implementation Steps

- [ ] Add a failing regression contract to `scripts/mobile-workspace-regression-smoke.mjs`.
- [ ] Add route-aware shell classing in `ParadiseLayout.tsx` for `/inbox/conversations` and `/ava-chat`.
- [ ] Update `pbk-components.css` so normal pages keep mobile bottom padding, while chat routes remove shell scrolling and avoid duplicate insets.
- [ ] Update `AvaChat.tsx` to use shell-provided height and add mobile-specific classes for quick commands and advisory text.
- [ ] Run focused smoke tests, typecheck, build, and `npm run test:mobile-browser-proof:preview`; release is blocked if mobile proof fails.

## Risk Controls

- Keep changes scoped to mobile media queries or chat-route classes.
- Preserve desktop columns and desktop composer controls.
- Avoid fixed-position composers; use grid rows so keyboard and browser chrome are easier to reason about.
