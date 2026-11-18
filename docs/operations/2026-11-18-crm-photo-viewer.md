# CRM full-screen photo viewer

Clicking the existing CRM gallery photo opens a viewport-filling viewer styled
with the original PBK typography, surfaces and buttons. Previous/next arrows and
arrow keys wrap through available photos. Zoom runs from fit (100%) to 400%; +,
minus and 0 also control zoom. Zoomed photos support mouse dragging and native
scroll/touch panning. Each new photo resets zoom and pan. Escape or Close returns
focus to the gallery.

The shared gallery supplies source selection and image fallback. No photo URLs,
saved property facts, underwriting, provider calls or CRM writes are introduced.
The viewer uses the existing Radix dialog for focus trapping and scroll locking.
At zoom boundaries, aria-disabled controls retain already-focused keyboard
handling while clamping their action; shortcuts are scoped to the open dialog.

Verification: production build, TypeScript, targeted ESLint, MCP typecheck,
isolated hosted runtime smoke, route/mobile/release-alignment checks, CRM evidence
regressions, and independent code review. `npm run test:property-photo-viewer`
covers desktop Chromium, iPhone WebKit and 320px Chromium: viewport bounds,
arrows/wrap, zoom limits/reset, pan, keyboard scope, focus return, reopen, one/zero
photos, image fallback and failed-photo removal while open, and no business
writes. Chrome visual inspection also used existing public source photos through
a read-only local fixture.

Final live screenshot review exposed an intrinsic CSS Grid sizing issue: the
image could force its grid row taller than the fit canvas. Explicit zero-minimum
tracks and image minimum sizes keep the whole photo contained at 100%, including
after resetting from 400%. The new fit-area overflow assertion failed before
this correction. Zoomed overflow remains intentional for panning.

Release follows the existing protected PR and Netlify/Render main-branch deploy
pipeline. Keep all-deployment staff SSO intact. Live verification should only
read an existing CRM property and exercise local viewer controls.
