# CRM Photo Swipe Implementation Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with a focused implementation pass and independent review.

**Goal:** Swipe left/right through photos in the existing full-screen CRM viewer without changing the PBK design.

**Design:** Reuse the viewer's pointer handlers and photo-selection/fallback seam. At fit (100%), a single touch moving at least 48px, predominantly horizontally, changes one photo on release and wraps at the ends. Vertical, short, cancelled and multi-touch gestures do not navigate. At higher zoom, retain native touch panning. Scope gestures to the photo viewport, preserve buttons/keyboard/focus and add concise swipe guidance to the existing help text. No new library, route, CRM write or provider action.

**Files:** `PropertyPhotoViewer.tsx` owns touch gesture state; the existing viewer CSS selects touch-action for fit versus zoom. Extend the isolated browser harness and add `test:property-photo-swipe`.

- [x] Observe a failing swipe browser regression on the current viewer.
- [x] Implement touch pointer handling and fit-only horizontal gesture ownership.
- [x] Verify both directions/wrap, rejected gestures, single photo, image failure, zoomed panning and fit/reset on Chromium/WebKit/320px. Use native Chromium touch input to check browser gesture routing, alongside synthetic event edge cases.
- [x] Build, typecheck/lint, hosted/runtime smoke and independent review; retain original design and no business writes.
- [ ] Run release gates, deploy through the existing protected main pipeline, and verify the live viewer read-only.
