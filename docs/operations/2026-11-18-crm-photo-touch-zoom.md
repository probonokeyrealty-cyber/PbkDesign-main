# CRM photo pinch and double-tap zoom

Pinch scales the photo canvas from 100–400%, retaining the content point under
the fingers and supporting centroid movement at the bounds. Two short nearby
taps toggle between 200% and fit. One finger pans a zoomed photo; clear horizontal
swipes still navigate at fit. Mouse drag, scroll/wheel, buttons, keyboard and
Radix focus behavior retain their existing seams and PBK styling.

The photo viewport alone uses `touch-action: none`; `usePhotoTouchGestures` now
owns touch pan as well as scale, tap and swipe. The surrounding app retains its
normal browser gestures. Cancellation, extra contacts, photo changes and the
first pinch-finger release discard pending gesture state. Only a fresh primary
contact can restart after cancellation/completion, so remaining/replacement
fingers cannot become another pinch, swipe or tap.

`npm run test:property-photo-touch-zoom` extends the isolated existing viewer
fixture. Browser cases exercise focal anchoring, scale caps, translation while
capped, fit reset, replacement fingers, third contacts, cancellation, long or
moved taps, photo changes, custom pan, fit-only swipe and no business writes.
Narrow Chromium uses native CDP touch input; WebKit and desktop Chromium exercise
synthetic pointer cases. This is browser emulation, not a physical-device test.

No new dependency, route, saved data, CRM write or provider action is introduced.
Keep the existing all-deployment staff SSO and protected PR/main release flow.
