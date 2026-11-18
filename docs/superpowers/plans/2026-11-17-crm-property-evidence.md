# CRM Property Evidence Implementation Plan

**Goal:** Make saved address lookup photos and important source details visible in the existing CRM property workspace.

**Architecture:** Keep the PBK shell, bridge lookup, Save Deal API and property tabs. Persist a bounded, address-scoped listing snapshot beside the existing ATTOM snapshot in the serialized deal. Reuse the gallery and property-record comparison rather than creating another CRM or provider integration.

**Tech Stack:** Existing React/TypeScript, PBK CSS tokens, Radix tabs, Playwright and Node tests.

**Design:** The existing property overview gains a photo-led evidence section with saved listing provenance and a compact parcel summary. The Photos tab retains the full gallery. Property record opens the saved ATTOM comparison immediately, with an explicit refresh for current records. Sources, capture dates, missing photos and conflicting facts stay truthful. Photos remain external listing URLs, not copied assets. Saved lead fields and underwriting remain operator-controlled.

**Constraints:** Preserve original PBK design, approval gates, shared/fresh draft isolation, provider adapters and mobile containment. No new business writes from lookup or page viewing. No new paid scraping, outreach, database migration or provider settings. Ignore snapshots for another address; sanitize URLs and bound snapshot size.

## Tasks

- [x] Add failing regressions for listing snapshot sanitization, address mismatch, canonical save/reopen and visible CRM photos/records with provider reads unavailable.
- [x] Implement snapshot helpers and capture through the existing lookup/Save Deal seam; detach snapshots when address changes.
- [x] Enhance the existing property overview, gallery fallback and saved ATTOM comparison using PBK tokens.
- [x] Verify build, typecheck/lint, focused persistence and browser regressions at desktop, 390px WebKit and 320px Chromium; run required hosted/runtime smoke in its existing isolated mode.
- [x] Independently review the complete diff, fix material issues, and record validation plus any data-coverage limitations.

## Review focus

Address edits must never show another property's snapshots. Zero/clear/manual fields and ARV/comps must remain unchanged. Malformed or unsafe image/source URLs must not render. Missing/stale provider data must retain clearly labeled saved evidence. Broken photos and long addresses must fit phone widths and keep gallery controls accessible.
