# Mobile Chat Density Plan

## Implementation Steps

1. Add a failing regression contract to `scripts/mobile-workspace-regression-smoke.mjs`.
2. Add route-aware shell classing in `ParadiseLayout.tsx` for `/inbox/conversations` and `/ava-chat`.
3. Update `pbk-components.css` so normal pages keep mobile bottom padding, while chat routes remove shell scrolling and avoid duplicate insets.
4. Update `AvaChat.tsx` to use shell-provided height and add mobile-specific classes for quick commands and advisory text.
5. Run focused smoke tests, typecheck/build if practical, and browser-verify mobile widths.

## Risk Controls

- Keep changes scoped to mobile media queries or chat-route classes.
- Preserve desktop columns and desktop composer controls.
- Avoid fixed-position composers; use grid rows so keyboard and browser chrome are easier to reason about.
