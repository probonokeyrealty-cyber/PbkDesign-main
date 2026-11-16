# Property Intelligence

## Scope

Extends the existing Deal Analyzer address field and Lead Portal Property tabs. Staff routes and bridge authentication remain protected. No customer outreach, lead creation, automatic lead writes, or automatic valuation is performed.

Operators can explicitly select one to three recorded sales and save them through the existing canonical lead PATCH. This replaces the three analyzer comp slots, retains a bounded source/date snapshot in the lead analyzer payload, and marks analysis stale. The same lead opens in Analyzer with these comps restored. A changed subject address blocks an in-flight save and prevents old research comps from hydrating another property. No separate CRM database or authorization path is introduced.

Call Mode separates Talk, Numbers and Follow-up using the existing Radix tabs, retaining mounted controls and notes while switching views. A seller/property header links back to the canonical lead. Claude reviewed this flow; the [Atomic CRM](https://github.com/marmelab/atomic-crm) and [shadcn combobox](https://github.com/shadcn-ui/ui) repositories informed interaction patterns only, not a replacement backend or new framework dependency.

Claude reviewed the desktop/mobile interaction layout on November 15, 2026. The existing PBK design system is retained. Google supplies address predictions only; ATTOM supplies verified property facts and recorded sales. No PropStream API or MLS integration is represented as connected.

## Configuration

- Existing ATTOM connection: `PBK_ATTOM_LOOKUP_ENABLED=true` and `ATTOM_API_KEY` on the Render bridge.
- Address suggestions: save a dedicated Places API (New) server credential as `PBK_GOOGLE_PLACES_API_KEY`, then explicitly set `PBK_ADDRESS_AUTOCOMPLETE_ENABLED=true` after deploying this code. Do not reuse the Gemini key or expose the server credential in frontend build variables.
- Google billing and the autocomplete integration were approved by the owner. The dedicated `PBK Bridge Places` key is saved only in Render, restricted to Places API (New) and the bridge's verified outbound ranges (`74.220.50.0/24`, `74.220.58.0/24`). The existing website key was left unchanged. A desktop negative check returned `API_KEY_IP_ADDRESS_BLOCKED`; successful requests must be verified from the hosted bridge.
- Restrict the key to Places API (New); review provider quotas, server network restrictions, and the required Google Terms/Privacy links before launch. Suggestions are not cached or persisted. The selected address is used only for the operator's property transaction. The compact dropdown includes Google Maps attribution.
- `PBK_PROPERTY_TIMEZONE` defaults to `America/Los_Angeles`; sales cover today and the previous 29 calendar days in this timezone. Retrieval timestamps remain UTC.

## Behavior

Address suggestions use a 350ms debounce, minimum four characters, a session token, and a maximum of five predictions. The picker supports arrow keys, Enter and Escape. Users can always leave an address typed manually. The lookup icon verifies a fully typed street/city/state/ZIP using ATTOM without Google.

Selecting a complete US address retrieves ATTOM facts. Only empty numeric property fields, ZIP and empty land lot fields are populated. Existing values, values edited in flight, pricing, ARV, repairs, financing, and comps remain unchanged. The UI shows the ATTOM source/date and fields added. Stale responses are discarded.

The Comps tab loads only when opened. Radius is explicitly selected from 0.5, 1, 2 or 5 miles (default 1). The adapter requests sale transactions sorted newest first, validates transaction dates and distance, excludes the subject, deduplicates parcels, and returns at most 20 priced sales. At most three 100-record pages are inspected under a 6.5-second shared deadline. A limited provider window is labeled. It never silently widens the date window or radius. Public records can lag closings; these are not MLS sold listings and are not guaranteed valuation-quality comparables.

## Protected Bridge Routes

- `POST /api/property-data/address-suggestions`: query/session token or selected place ID/session token.
- `POST /api/property-data/attom-preview`: structured property address, existing route.
- `POST /api/property-data/attom-sales`: structured address plus selected radius.

All use the existing bridge/team authorization gate and return `Cache-Control: no-store`. Provider failures return allowlisted status categories rather than upstream diagnostics. API keys and ownership records are not projected into these responses.

## Verification

```powershell
node --test scripts/attom-recent-sales.node-test.mjs scripts/address-suggestions.node-test.mjs scripts/lead-comps.node-test.mjs
node scripts/property-intelligence-browser-smoke.mjs
node scripts/property-crm-roundtrip-smoke.mjs
node scripts/manual-lead-replay-durability-smoke.mjs
node --test scripts/state-write-queue.node-test.mjs
node scripts/lead-property-workspaces-browser-smoke.mjs
node scripts/render-docker-imports-smoke.mjs
npm run typecheck
npm run build
```

Browser tests use synthetic records and block all external requests. They cover 390px/1440px, light/dark contrast, keyboard selection, preserved edits, stale replies, failed comp saves and retry, clearing old-property comps, delayed lead-switch responses, Call Mode note persistence and view switching, empty results, timeouts, and overflow. The replay durability test deliberately makes an isolated storage file unwritable, proving a failed save cannot turn into a false-success replay.

The round-trip script defaults to a disposable isolated bridge. Live mode requires explicit operator authorization, `PBK_PROPERTY_QA_LIVE=1`, `--live`, and the existing bridge credential in the environment. It only writes fixed `pbk-qa-property-workflow-*` fixtures labeled `[PBK QA]` with no phone/email and denied contact permissions. It refuses any address collision with another lead. It checks correct-lead persistence/read-back, unchanged control lead, and HTTP 409 for a mismatched property. Fixtures are retained for audit; it never deletes existing leads or invokes outreach. Comp-save action provenance is separate from the lead acquisition source.

Hosted Google suggestions, selected-address details, ATTOM facts, and 12 recent sales were verified using ATTOM's public Denver sample address. The live canonical lead round-trip also passed with three selected sales; a manual create initially returned HTTP 500, while subsequent controlled saves succeeded. Do not treat this as a guarantee of uninterrupted database availability. Final release checks must verify the deployed commit, bridge/Postgres readiness, unauthenticated rejection, and Netlify staff SSO scope `all`.

Further live writes reproduced `postgres_state_persist_required` with `Connection terminated unexpectedly`. Render reports the database on `basic_256mb`, and database logs show repeated backend processes killed by signal 9 and recovery mode. This is consistent with resource pressure, not proof of a missing comp schema. State snapshots were about 9 MB. The bridge now serializes/coalesces full-state writes: pending cumulative snapshots can merge, active writes cannot overlap, and every waiter receives its actual batch result or error. A burst test confirms 51 requests need two writes with maximum concurrency one. This reduces pressure but does not promise a 256 MB database cannot fail; infrastructure upgrades require owner billing approval.
