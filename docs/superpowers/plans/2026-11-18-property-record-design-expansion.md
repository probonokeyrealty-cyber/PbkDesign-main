# Property record design and data expansion

> REQUIRED WORKFLOW: Use `superpowers:subagent-driven-development` for focused implementation and independent review.

**Goal:** Make the existing property workspace more informative and beautiful using Claude's original design context, real decorative assets, and all useful documented ATTOM record fields available through the configured connection.

**Architecture:** Preserve the existing explicit property-intelligence coordinator and exact lead/address persistence. Expand the Basic Profile projection and strict rehydration together. Investigate the observed ATTOM MCP `get_property_data` selected-dataset contract and prepare a bounded read-only integration only from verified schemas. Do not copy browser credentials or represent a browser login as hosted authorization.

## Design

Claude's original design chat was consulted directly on November 18. Recommended direction: a compact record masthead with captured-field count/source timestamp, searchable collapsible groups, in-row provenance, and a decorative survey plate. Keep Fraunces/Geist/JetBrains Mono and graphite/sky/amber tokens. Existing Overview/Property record/Photos/Comps and original shell stay in place. The alternative provenance side pane is deferred because per-field historical edits are not supported. No new Apply action or APN lookup is promised.

A real generated survey-plate graphic fits a 220x88 desktop / 120x56 mobile slot and hides at 320px. It is static, aria-hidden and decorative; it never represents a parcel boundary, map or subject property. Existing real property photos are unchanged.

## Constraints

- Typing/searching/collapsing/navigation never fetches providers or saves data.
- Refresh and Analyze are explicit. Exact current lead ID and structured address are checked before and after provider retrieval.
- Missing or failed sources retain prior saved facts, photos, reviewed comps and their capture times.
- Records remain evidence: original loan amounts are not payoff balances; source estimates never overwrite ARV/MAO/offers or reviewed comps.
- No new paid subscription or broader OAuth grant without the required authorization. A configured browser Workbench is not a production credential.
- No raw unrestricted provider payload viewer or credentials in frontend, files or logs.

## Verified sources

- ATTOM Basic Profile dictionary: https://api.developer.attomdata.com/docs
- MCP OAuth and coverage: https://support.attomdata.com/articles/5769219187-mcp-v2
- Existing signed-in Workbench exposes `Get Property Data` and selected datasets including identity, overview, ownership, histories, comparables and estimates. The renewed session completed one explicit request for ATTOM’s published sample address with all 20 datasets selected. The response was partial: 19 datasets returned ok, including empty foreclosure history; permits returned not_entitled. Browser authorization is not a Render credential.
- Claude design conversation: https://claude.ai/chat/1f94828f-e766-4a2c-82c7-82463c84b05e

## Tasks

- [x] Expand documented Basic Profile fields with bounded sanitization, signed coordinates, explicit DTOs and strict saved-record hydration. Tests prove invalid data rejection and persistence.
- [x] Generate and integrate the decorative survey plate; add masthead, populated/available counts, local search and accessible record groups within the existing Property record tab. Verify dark/light and 1440/390/320px containment.
- [ ] Verify `get_property_data` request/response metadata through the authorized ATTOM surface. Integrate the existing bridge records seam when a legitimate hosted credential is available; otherwise make the precise connection requirement reviewable without borrowing browser sessions.
- [ ] Independent review, build/type/lint, evidence and mobile/browser regressions; run release checks and deploy only the verified scope using existing authorized release flow.

## Verification and connection receipt

- Existing REST Basic Profile scope now supports 100 allowlisted fields; 53 were added without additional provider requests.
- Independent review found no remaining Basic Profile/UI blockers. Lot depth/frontage are documented in feet; elevation remains unitless.
- Targeted adapter tests: 10/10. Focused node regressions: 42/42. Build, typecheck, lint, Docker imports and lead-portal route passed. Desktop Chromium, mobile WebKit at 390px and narrow Chromium at 320px passed persistence, exact-lead isolation, manual refresh and passive-controls checks.
- Full local Jest was interrupted due resource contention and is not reported as passed; final revision requires Founder CI.
- ATTOM public metadata confirms backend access-key client_credentials at /token, or public PKCE browser login. Endpoint: https://mcp.intelligence.attomdata.com/metadata. No browser credentials were copied.
- MCP results use status/property/requestedDatasets/results. Each result has dataset/status/data plus resource/dictionary provenance. The private sample is excluded from Git; do not commit owner names or source payloads.
- MCP remains unconnected in the hosted bridge. The release contains the verified REST/UI scope only; no unsupported MCP success or automatic enrichment is advertised. A backend access key or explicit dashboard OAuth integration is the remaining connection requirement.
