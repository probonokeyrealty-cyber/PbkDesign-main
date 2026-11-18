# Address-to-CRM command center enhancement

## Design context

Reviewed the original Claude conversation, “Visualizing your brilliant moments”:
https://claude.ai/chat/1f94828f-e766-4a2c-82c7-82463c84b05e

Its latest correction calls for extending existing components and displaying
verified evidence without invented readiness, contact permission, duplicate
windows, or a second dashboard. This change retains the PBK shell, source cards,
listing photo gallery, underwriting, canonical CRM API, and approval behavior.

## Implemented locally

- A complete operator-edited US address waits 800ms and makes one HTTP request.
  The existing property-data endpoint composes cached listing information with
  the existing exact-parcel ATTOM preview adapter when `includeRecords=true`.
- Available basic facts fill empty fields. Operator edits, including zero and
  cleared fields, stay protected. Asking prices and recorded sales do not become
  ARV or sold comps. ATTOM tax, parcel and sale evidence has its own source panel.
- The CRM handoff section accepts seller name, phone and email. Explicit Save
  keeps a local copy, creates an unlinked lead when required contact information
  is present, retains its canonical ID, then uses the existing analyzer patch.
  Missing contact information leaves the save local. Queued approval stays queued.
- A creation idempotency key survives retries. Concurrent Save clicks share a
  pending lock. Analyzer-originated creation refuses ambiguous existing matches
  instead of merging another lead by contact or address.
- Editing an address detaches the old lead identity and creation key. Leaving a
  saved/linked property clears its seller contact fields. Confirmed Clear resets
  manual-field protection so a new property's blank facts can fill normally.
- The serialized deal carries the matched ATTOM record snapshot into local save
  and the CRM handoff. No real seller was created or modified during verification.

## Verification

Use the isolated browser test against built assets:

```powershell
npx vite build --outDir output/address-autofill-build
node scripts/analyzer-address-autofill-browser-smoke.mjs
node --test scripts/analyzer-property-preview.node-test.mjs scripts/analyzer-crm-identity.node-test.mjs
npm run typecheck
npx eslint src/app/App.tsx src/app/components/AnalyzerListingLookup.tsx src/app/components/AnalyzerTab.tsx src/app/utils/runtimeBridge.ts --max-warnings=0
node scripts/analyzer-lead-sync-smoke.mjs
node --check scripts/openclaw-local-server.mjs
```

The browser harness blocks external HTTP and WebSockets, supplies synthetic
property/CRM responses, and checks desktop Chromium, 390px WebKit and 320px
Chromium. It checks request counts, partial edits, explicit zeros/clears, stale
responses, source evidence, CRM payloads, double-click/repeated saves, canonical
identity detachment, local-only missing-contact saves, and clear-then-new-property.

An independent review identified identity reuse, explicit-zero overwrite, and
protected fields surviving Clear. Each has a focused regression and local fix.
The existing ATTOM Jest suite must run with Jest's VM-module runner, not Node's
test runner; it passed all five cases with its configured runner.

## Availability and release boundary

This is one frontend request, not a claim that every provider returns every fact.
Listing coverage uses the existing cache; missing listings are reported rather
than triggering research/import jobs. ATTOM requires the existing enable flag,
credentials and provider availability. Repairs, sold comps and other unsupported
inputs remain operator-supplied. No new provider purchase, nationwide data
coverage, skip tracing, or revenue outcome is implied.

No push or deployment was performed. A release needs the frontend and bridge
changes together, existing repository checks and release authorization. Keep
`pbkcenter` protected on all deployments. Other chats' Ava, privacy and workflow
changes were outside this enhancement.
