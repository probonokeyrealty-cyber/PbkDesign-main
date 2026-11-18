# Comp photo comparison implementation plan

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for focused implementation and independent review.

**Goal:** Compare recorded sales side by side with address-bound photos, prices, size and distance; explicitly save up to three reviewed comps to the current lead.

**Architecture:** Extend the existing Comps tab and recordedSales envelope. The existing explicit property-intelligence refresh may read cached listing evidence for each bounded sales candidate. No scrape jobs, new providers, automatic refreshes or new persistence stores. Preserve the existing exact lead/address save guard.

**Design:** Keep the sales table for scanning and add selected comparison cards above it, using the existing graphite panels, sky selection accents and mono metrics. Cards stack on phones without page overflow. Selecting is local only; Save selected comps replaces the reviewed set intentionally. Reopen restores saved selected IDs. Photo evidence carries its own comp address and capture time; missing or mismatched evidence displays unavailable. Existing saved evidence survives cache misses. These implementation choices follow the user's request to proceed while preserving the original design.

**Approaches:** An external comparison route would duplicate the property workspace. Table-only thumbnails would not provide side-by-side review. Selected inline cards fit the requested workflow and existing design.

**Tech Stack:** Existing React/TypeScript, CSS tokens, Node bridge and Postgres JSON envelopes.

## Constraints and review focus

- No source request or CRM write from mount, selection, sorting, radius changes, or tab changes.
- Only the explicit refresh loads source evidence; saves capture exact lead ID and expected structured address.
- Bound cached photo reads to twenty candidates and sanitize source URLs; never use subject photos for another property.
- Do not erase reviewed/manual comps or old valid photo evidence on source failure.
- No production settings, authentication or outreach changes.

## Tasks

- [x] Add address-bound comp photo snapshots in the existing explicit enrichment flow, with mismatch/cache-failure tests.
- [x] Add selected comparison cards, persisted-selection hydration and explicit-save tests; verify 1440/390/320px and no passive requests.
- [x] Independent review, typecheck/build and affected runtime regressions; document results and prepare reviewable release.

## Verification

39 focused Node tests passed. Chromium 1440px, WebKit 390px and Chromium 320px passed comparison, max-three selection, wrong-address photo rejection, fullscreen zoom, canonical save/reopen, failure retention, duplicate-address isolation, passive-request and overflow checks. Typecheck, ESLint, production build, MCP typecheck, isolated bridge smoke, hosted-proxy smoke and Docker import closure passed. Independent review caught and verified the fix for missing source timestamps: comp photos require actual capture time. Reviewed selected comps outside the current sales window are prioritized within twenty cache reads/four workers. No whole-bridge edits or integrity fingerprint changes.
