# Queue Return Context

Implement the first navigation slice of the approved Claude Decision Rail prototype locally.

- Keep the existing queue and lead screens; carry return context in React Router history state, not global storage or query parameters.
- Restore Leads search, filter, page, selected lead, and focus when returning through the workspace Back control.
- Recognize Today-origin lead links and label Back accordingly. Preserve the source scroll position.
- Validate return paths against Today and Leads; direct links and malformed state fall back to Leads.
- Do not change lead saves, approvals, dispatch, ATTOM, ARV, comps, or production settings.
- Test with synthetic leads at desktop and mobile widths. Block all writes and outside network traffic.

Implementation order: failing queue regression, route-state contract, route integration, browser regression, typecheck and unit checks.
