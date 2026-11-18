# CRM Photo Touch Zoom Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with a focused implementation pass and independent review.

**Goal:** Pinch the photo itself from 100–400%, and double-tap between 200% and fit, inside the existing PBK viewer.

**Design:** Keep the scrollable canvas and existing controls. A focused hook owns touch contacts, two-finger scale/focal point, one-finger pan, fit-only swipe, and short nearby double taps. Scope `touch-action: none` to the photo viewport so the browser cannot steal image pinches. Wheel/scroll and mouse drag remain available. Pinch completion, cancellation, extra contacts and photo changes must never become a swipe or tap; require all fingers to lift before another gesture. Keep the tapped/pinched content point under the fingers, including centroid motion at scale bounds. No new dependency or business write.

**Files:** New `usePhotoTouchGestures.ts` holds touch lifecycle; `PropertyPhotoViewer.tsx` applies anchored zoom through its existing layout effect; existing CSS owns containment. A browser-case helper extends the current isolated swipe/viewer fixture.

- [x] Observe failing double-tap/pinch browser regression before implementation.
- [x] Implement anchored pinch/double-tap and custom touch pan; retain swipe, buttons, keyboard and focus.
- [x] Verify native Chromium touch, WebKit pointer cases, bounds, focal anchoring, residual/cancelled/third-finger/long-tap/drag rejection, reset/photo changes, fit and no business writes.
- [x] Run build, typecheck/lint, hosted smoke, Chrome inspection and independent review.
- [ ] Pass protected release checks, deploy, and verify the live viewer read-only.
