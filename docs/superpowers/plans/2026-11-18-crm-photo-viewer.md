# CRM Photo Viewer Plan

REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` with a focused implementation pass and independent review.

**Goal:** Add an in-app full-screen photo viewer with zoom and previous/next arrows inside the original PBK gallery.

**Design:** Reuse the existing Radix modal dependency and PBK surface, button, typography and accent tokens. Clicking the gallery photo opens a viewport-filling modal. Show a photo count, left/right arrows, zoom in/out, fit/reset and close. Arrow keys navigate; +/− zoom, 0 resets, Escape closes. Start at fit (100%), cap zoom at 400%, and reset zoom/pan for each new photo. Allow mouse drag and native touch/scroll panning when zoomed. Keep high-resolution source selection, original-image fallback and source links. No new route, provider API, CRM write or external photo-copy service.

**Files:** `PropertyPhotoViewer.tsx` owns the dialog and view controls; the existing shared `AnalyzerListingPhotos` supplies the selected image and existing fallback/load handlers. Extend PBK CSS locally and the existing isolated gallery browser harness with a viewer mode.

## Verification

- [x] Observe failing browser regression for missing viewer, then implement the minimal UI.
- [x] Check full-screen containment, arrows/wrap, keyboard controls, zoom bounds/reset, panning, Escape, focus trap/return, reopen and one/zero-photo cases.
- [x] Check source fallback, broken images and no business writes at desktop, 390px WebKit and 320px Chromium.
- [x] Run build, typecheck/lint, existing gallery/runtime checks, Chrome proof and independent review before release.

**Constraints:** Preserve the original PBK shell/design, private-site protection, saved photo identity, draft isolation and approval gates. Viewer navigation must never alter saved facts or create CRM/provider actions.
