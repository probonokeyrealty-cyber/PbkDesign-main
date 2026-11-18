# Lead Property Intelligence Implementation Plan

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for focused implementation and independent review.

**Goal:** Preserve the original PBK property workspace while making explicitly requested property intelligence durable, lead-scoped, and useful in the Analyzer.

**Architecture:** One explicit bridge enrichment request gathers existing cache-backed listing/photos, ATTOM basic profile and recorded sales. Saved CRM enrichment is bound to exact lead ID and expected address; unlinked Analyzer results remain local drafts until linked. Browsing tabs and editing addresses never starts enrichment. Existing manual facts and reviewed comps win over suggestions.

**Tech stack:** Existing React/TypeScript UI, Node bridge, Postgres raw lead persistence, ATTOM adapters.

## Design decisions
- Keep Overview, Property record, Photos and Comps in the existing Property workspace.
- Expand current basic-profile fields only where returned: parcel/building, ownership/mailing, taxes/assessment, recorded transfer and original mortgage. Unknown means unknown; loan original amount is never current payoff and assessed values never become ARV.
- Refresh property intelligence is explicit and saves evidence for one captured lead/address. Analyze also gathers evidence before readiness/math. No background enrichment on tab open, radius edit or address edit.
- Keep saved photos and records on provider failure. Retain prior snapshot timestamps for retained facts; label automatic sale candidates as suggestions requiring review. Never use subject transfers or asking prices as sold comps.
- Unlinked addresses remain saved drafts (confirmed by user), with no address-only CRM lead creation.
- Preserve photo gestures, original design tokens, existing approvals and Rex/Brain boundaries.

## Tasks
- [ ] Bridge coordinator: exact-ID/address validation, dedupe, persisted partial evidence, recent sales and safe comp suggestions; regression tests for races/duplicates/failures.
- [ ] Records: extend verified basic-profile projection and strict snapshot hydration; useful grouped record UI with honest source labels; adapter/evidence tests.
- [ ] Client integration: explicit-only requests, saved CRM refresh, persistent comps/photos, draft/analyzer enrichment and hydration, in-flight identity/manual-edit protection.
- [ ] Independent review; focused node tests, typecheck/build, runtime/hosted smoke and BrowserOS mobile containment; release using existing CI and deployment protections.

## Validation
Exercise two leads with the same address, address changes during requests, partial provider failures, manual comp preservation, unlinked draft reload, linked lead reload, no requests on passive browsing, and 320/390px layouts. Production evidence must not claim unobserved outcomes or alter real seller data.
