# CRM Photo Swipe Dismiss Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with a focused implementation pass and independent review.

**Goal:** A clear downward swipe closes the existing full-screen photo viewer at fit zoom, preserving PBK styling and all other gestures.

**Design:** Extend the existing touch hook with an 80px downward, predominantly vertical (1.5×), single-contact gesture evaluated on release. Require fit at both start and release. Track initial horizontal intent so an L-shaped horizontal gesture cannot dismiss. Short/upward/ambiguous/cancelled/multi-contact gestures cannot dismiss; zoomed dragging remains pan. Control the existing Radix root's open state so gesture dismissal uses its normal focus-return and scroll-unlock lifecycle. Keep Close/Escape and the existing design; update only the help text. No business writes, provider calls or new dependency.

- [x] Observe failing swipe-dismiss browser regression.
- [x] Implement fit-only dismissal in the existing hook and Radix lifecycle.
- [x] Verify native Chromium touch and WebKit cases: close/reopen/focus/scroll unlock, short/upward/diagonal/horizontal/cancelled/pinch-residual gestures, zoomed pan, one/zero photos, and all existing viewer/touch controls.
- [x] Build, typecheck/lint, hosted smoke, Chrome inspection and independent review.
- [ ] Pass release gates, deploy through the existing main pipeline, and verify the live viewer read-only.
