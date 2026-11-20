# ATTOM MCP saved property records implementation plan

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for focused tasks and independent whole-branch review.

**Goal:** Activate the founder-approved ATTOM backend connection in the existing explicit property-intelligence workflow and present bounded, durable property datasets inside the original record design.

**Architecture:** The existing bridge composition stays intact. `property-intelligence.mjs` receives a lazy optional MCP reader, enabled only by `PBK_ATTOM_MCP_ENABLED=true` with the configured Render credentials. Each explicit unified refresh makes one `get_property_data` call selecting its 20 verified datasets, alongside the existing REST Basic Profile and cached listing seam. MCP comparables feed the existing comparison; REST sales are a fallback when MCP cannot supply valid comparable evidence. No raw payload viewer, new shell or alternative CRM lane.

**Tech stack:** Existing Node/MCP SDK, React/TypeScript, PBK CSS, Postgres JSON evidence.

## Approved requirements and verified contract

- Founder chose backend access keys, explicitly authorized creating the named tenant key and storing its Client ID/secret in the existing Render bridge. They are now stored and read back successfully; authenticated `tools/list` returned 9 tools. No credentials were committed or logged.
- The actual tool accepts `{property:{lookupMode:'splitAddress',address1,address2},datasets:[...]}`; `property` and `datasets` are required, additional properties forbidden. Datasets are a unique list of 1–20 verified enum values.
- One approved public sample returned status/property/requestedDatasets/results. Its 20 dataset statuses were 19 ok and permits not_entitled. Empty foreclosure history does not establish absence of distress.
- Dataset projections use only observed/documented fields. Unknown data must not be fabricated or stored as unrestricted JSON. At most 20 sections, 20 rows per section, bounded scalar values and caveats.
- Keep exact lead and structured address checks before and after reads. Reject parcel conflicts across dataset identities and REST/MCP evidence. Unlinked Analyzer results remain drafts.
- Search, disclosure, tabs, sorting, image viewing and selection trigger neither providers nor saves. All data calls stay behind Refresh/Analyze.
- Retain successful sections and original capture times on missing/failed/empty refreshes. Record a separate latest-attempt status. Preserve photos, manual facts, intentional comp clears and reviewed selections.
- Treat AVM/rent/equity as dated estimates, mortgage original amounts as recorded financing rather than payoff, and inferred ownership periods as inferred evidence. Do not overwrite ARV, MAO or negotiated terms.
- MCP default comps have their own actual source date window and a bounded ranked candidate set. Filter distance to the requested supported radius; show the actual saved window and a limited-coverage notice. Do not label the MCP window as the legacy REST last-30-day window.
- Preserve the Fraunces/Geist/Mono graphite/sky/amber shell and current tabs. Extend the record panel using searchable native disclosures and local group filters. Reuse the existing comp comparison and photo viewer.

## Shared section contract

Pure `src/app/utils/attomMcpSections.mjs` and `.d.mts` export dataset definitions and strict projection/hydration/merge helpers. A saved section is `{id,status,checkedAt,retrievedAt?,sourceGeneratedAt?,facts,rows,caveats,refreshStatus?}`. Facts/rows contain allowlisted scalar values only; labels/units/columns come from the trusted registry, never stored provider labels. `refreshStatus` describes a failed/empty later attempt without relabeling retained evidence as fresh. Known unavailable datasets render honestly. Comparables use a summary in the record panel; their full candidates use the existing Comps tab.

## Tasks

- [x] Backend transport, strict section registry and dataset adapter: TDD for actual request contract, identity mismatch, scalar validation, bounded rows, missing/failed statuses, exact actual comp window and safe estimates. Transport already has 15 passing tests and independent lifecycle review; retain those protections.
- [x] Existing record UI and strict saved hydration: original styling, no passive calls, source timestamps and unavailable/retained status, long-value/mobile containment, no duplicate comp/photo experience. Tests use fictional evidence.
- [x] Coordinator integration: optional lazy MCP source; REST facts retained; MCP comps or explicit REST fallback; no change to bridge source file/fingerprint. Persist sections and preserve prior successful sections by ID. Add Docker copies/import proof. Update comp window copy to reflect source metadata.
- [ ] Independent review, focused tests, build/type/lint, desktop Chromium and mobile WebKit/narrow browser flow, full candidate CI; release via existing approved GitHub/Netlify/Render flow, then enable the flag and perform isolated live exact-lead persistence checks. Check source time retention, sibling isolation, comps/photos and no outbound contact.

## Review focus

Cross-dataset parcel conflicts; failure retaining stale evidence without false freshness; tool response identity ambiguities; candidate cap and date-window truth; malicious saved JSON or provider URLs; passive controls causing requests; close/auth/session races; duplicate-address async writes; estimates becoming underwriting authority.

## Rulings

- Reuse existing Basic Profile alongside MCP rather than reducing existing 100-field coverage to the smaller MCP overview. This preserves populated fields; it costs one existing REST read per explicit refresh.
- Use the MCP comp source's actual dates, filtered radius and limited-coverage metadata. The source does not accept caller comp criteria; pretending it searched the legacy 30-day window would be misleading.
- Keep the bridge file unchanged by extending its existing imported coordinator seam, avoiding unrelated whole-bridge fingerprint changes.

## Validation receipt

- Independent whole-branch review found no remaining blockers after parcel alias, source-radius, LTV interpretation, partial-retention and frontend deadline fixes.
- Fifty MCP transport/adapter/coordinator/hydration/UI/client tests pass; broader focused evidence checks total 64 passing before the final added radius test. Typecheck, lint, build, Docker import proof (180 imports/121 files), hosted proxy guard and Analyzer mobile smoke pass. Desktop Chromium, WebKit390 and Chromium320 verify persistence, retained timestamps, local filters, phone overflow, reviewed comps/photos and duplicate-address isolation.
- A real backend qualification retrieved all20 selected datasets in one explicit public-sample call and10 usable comps. Permits were not entitled; empty foreclosure history and unavailable schools stayed honest. Timeline26 and valuation-history129 source rows were bounded to20 with explicit truncation metadata. No CRM or outbound writes occurred in that qualification.
- Hosted property enrichment requires the existing team token and goes directly to the existing Render origin, preserving CORS/auth and stripping host API-key authority. Its210-second bounded deadline covers worst-case authentication, handshake and60-second provider timeouts plus fallback; the POST is never replayed. Six client tests include a held65-second response and replacement-team-session protection. Other routes retain their existing budgets/proxy behavior.
- Source credentials are stored only in Render secret variables; local handoff used an ephemeral named pipe with no credential file or log. The browser runtime was reset after successful storage. The activation flag remains off until the reviewed code is deployed.

- Final regression preserves negative available equity and equity percentages in projection and saved hydration, while prices, debt and values remain nonnegative. Independent delta review found no blockers. The route smoke reproduced its exact-script contract failure; restored its original command and wired the MCP suite separately into the full UI release gate.
- Full npm run test:release-ui passed after the wiring correction, including production hardening, approval-safe bridge checks and all51 MCP tests. A local mixed-line-ending source-scan artifact was resolved by normalizing runtimeBridge.ts to repository LF without changing its Git content.
