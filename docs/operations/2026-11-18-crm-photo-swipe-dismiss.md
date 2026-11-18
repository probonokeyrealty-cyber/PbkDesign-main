# Swipe down to close property photos

At fit zoom (100%), release a single-finger downward drag of at least 80px that
is predominantly vertical (1.5×) to close the existing photo viewer. A horizontal
intent detected during the gesture prevents dismissal. Short, upward, ambiguous,
cancelled, multi-contact and residual pinch gestures cannot dismiss. Zoomed
dragging retains photo panning; horizontal fit swipes still change photos.

Dismissal controls the existing Radix dialog root. Focus return to the gallery,
scroll unlocking, Close/Escape and fresh zoom/gesture state on reopen use its
normal lifecycle. The existing help text is updated inside the original design.
No CSS redesign, new dependency, provider action or business write is added.

`npm run test:property-photo-dismiss` runs all viewer/swipe/touch-zoom regressions
and new dismissal cases on desktop Chromium, iPhone WebKit and 320px Chromium.
Native Chromium touch checks dismissal, navigation and zoomed downward pan;
synthetic pointer cases cover cancellation, horizontal-first L paths and pinch
residuals. Tests also check focus, body scroll unlocking, reopen and a single
photo. These are browser-emulated gestures, not physical-device tests.

Release uses the existing protected main/Netlify/Render pipeline and staff SSO.
Live verification exercises viewer controls read-only and compares saved data.
