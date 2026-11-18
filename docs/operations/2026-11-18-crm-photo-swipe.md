# CRM photo swipe navigation

The existing full-screen photo viewport accepts a single-finger horizontal
swipe at fit zoom (100%). Swipe left for next and right for previous; navigation
wraps through available photos. Release must travel at least 48px and be more
horizontal than vertical (1.5×). Short, vertical, cancelled and multi-contact
gestures do not change photos. Photo and zoom changes clear pending gestures.

Fit mode owns horizontal touches through `touch-action: pan-y pinch-zoom`.
Zoomed mode retains native horizontal/vertical panning and pinch gestures. The
existing mouse drag, arrows, keyboard controls, image fallback, focus behavior
and PBK visual tokens stay shared. Existing help text explains swiping at 100%.
No library, route, saved data, CRM write or provider action is added.

`npm run test:property-photo-swipe` extends the isolated viewer/browser fixture.
It covers both directions/wrap, rejected gestures, a single photo, all existing
fit/zoom/fallback/focus cases and no business writes. Chromium at 320px uses
browser-native touch input for navigation, vertical rejection and zoomed pan;
desktop Chromium and iPhone WebKit also exercise synthetic touch pointer edge
cases. This is browser emulation, not a physical-device test.

Release uses the existing protected PR/main pipeline and private Netlify site.
Verify the published viewer with read-only photo gestures; retain staff SSO and
the existing approval gates.
