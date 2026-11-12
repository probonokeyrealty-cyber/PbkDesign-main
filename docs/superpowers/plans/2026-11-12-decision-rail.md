# Decision Rail

Local implementation of the selected Claude Decision Rail, scoped to Today's existing Review queue and confirmation dialog.

- Render Action, Evidence, Review and Receipt as one shared, presentational component.
- Derive progress from the existing selection, preflight, decision request and acknowledgement. Do not add dispatch callbacks or relax locks.
- Keep cancelled and changed requests distinct from submitted decisions. Treat lost responses as unconfirmed, never as safe retries.
- A receipt is a bridge decision acknowledgement only, not proof of provider delivery. It is session-local and not a replacement for durable approval history.
- Keep the existing design tokens; use compact four-column desktop and two-column mobile rails, non-color state labels, and an ordered accessible list.
- Test queue unavailability, keyboard Cancel, double-click dispatch, changed evidence, successful acknowledgement and uncertain provider responses at 1440px and 390px with isolated fixtures.
- No deployment, live approvals, provider requests or lead writes.

Preview: `node scripts/decision-rail-local-preview.mjs`, then `/command-center` on the reported local URL. The first demo request acknowledges once; the second returns an unconfirmed response. All other writes are blocked. State lasts only until the fixture server restarts.
