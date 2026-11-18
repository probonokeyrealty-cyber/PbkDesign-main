# CRM property photos and saved lookup evidence

Enhances the original PBK property workspace: overview gallery, thumbnail selection,
source links, asking price, days on market, parcel/APN, lot area, annual tax and
recorded transfer. The existing Photos and Property record tabs remain.

The existing Analyzer lookup captures a bounded listing snapshot beside its
ATTOM snapshot. Explicit Save Deal carries both through the existing serialized
deal/CRM patch. Manual lookup captures evidence without changing typed numbers.
Snapshots for a different address are ignored and an address edit detaches them.

The Property record tab initializes its existing comparison from saved evidence.
Explicit refresh remains read only. A failed refresh retains clearly labeled
saved photos/records; successful photo refresh is labeled separately from the
saved capture time. Missing photos and broken source images remain honest.
Listing photos and recorded transfers do not become ARV or sold comps.

## Validation

- Build, application typecheck, MCP typecheck and focused ESLint.
- `npm run test:crm-property-evidence`: unit/persistence/address/URL bounds plus
  desktop Chromium, 390px WebKit and 320px Chromium browser verification.
- `PBK_ANALYZER_BUILD_DIR=dist node scripts/analyzer-address-autofill-browser-smoke.mjs`:
  one bundled request, manual refresh persistence, scalar edit protection,
  canonical repeated saves, address detachment and clear/reentry.
- Existing 62 draft storage/isolation tests.
- `npm run test:hosted`: existing isolated sample runtime smoke, not real provider delivery.
- Independent review: fixed manual snapshot persistence, refresh provenance and
  same-address refreshed comparison; no remaining material findings.
- Chrome visual check used local built assets and read-only cached public
  property facts/photos, not a real CRM mutation. All six source photos loaded.

## Coverage limits

Read-only cache inspection found listing photos in 99 of 220 existing property
entries. Coverage depends on the existing data adapters. Some cached images are
small source previews; no higher-resolution photographs have been invented or
copied from another property. This change does not add scraping jobs, provider
purchases, messages/calls, migrations, or a second dashboard.
