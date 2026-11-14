# PBK Private Investor Portal and Property Log

Status: proposed build design; private-investor approach selected by the founder on November 13, 2026. This document does not claim that the portal has been implemented or deployed.

## Outcome

PBK staff can enter a house once, save and revise it privately, review the investor-facing packet, then release it to approved investors. Approved investors can browse released properties, save a property and send a nonbinding inquiry. PBK can see and respond to that inquiry in the same property log, with history preserved.

The first acceptance milestone is a real staging vertical slice: staff saves a draft → reviewer releases a version → approved investor reads that version → investor sends one inquiry → staff sees one durable inquiry and its audit trail. Another marketing-only prototype does not satisfy this milestone.

## Verified starting point

- Claude chat `https://claude.ai/chat/e1e4ff8b-4359-4793-9d1c-6e87cde43d4f` contains the four-screen fictional workspace and a Blue Keyline design handoff. Its earlier instructions explicitly excluded authentication, storage, a live feed and a new backend.
- The native Webflow `/investors` page contains that local walkthrough plus a separate functioning investor application and Calendly prompt. Buy Box QA reached one HighLevel contact, one assigned owner and one dated task.
- The Webflow CMS currently shows Investor Resources (3 draft resources), Blogs (9 items) and Services (51 items), with no house-inventory collection.
- The active PBK application repository is `C:/Users/Dell/Documents/New project 2/PbkDesign-main`. It already has the React frontend, founder shell, Render bridge and persistence seams. No private-investor portal implementation was found in the focused source search. Existing staff/operator credentials are not investor credentials.
- The active repo contains unrelated uncommitted changes. Implementation must use an isolated worktree and must not reset or include those changes.

## Architecture decision

Keep Webflow as the public entry point and design/content surface. Build the authenticated portal as an application, with the property-posting log inside the existing PBK operator application rather than a second internal dashboard. Reuse the existing runtime/persistence conventions after inspecting their contracts. Do not put private inventory or packet files in a publicly published Webflow collection.

Proposed default identity layer: managed, individual email login with invitation/approval and a separately checked membership record. Prefer an already configured PBK identity provider if it supports individual identities and server-verifiable sessions. If none exists, the proposed provider is Supabase Auth, subject to staging configuration review. Do not use the founder bridge token, a shared team passcode, a query-string access code or browser-only hiding to grant investor access. This identity choice must be confirmed by implementation discovery before any resource is provisioned.

Staging uses its own database/schema namespace, private storage prefix/bucket, test identities and allowed origins. Production data, credentials, email delivery, domains and Webflow publishing remain untouched until a separate release instruction. Authentication/persistence integration is a prerequisite to calling the staging portal working; a test-only adapter must never be enabled on a hosted public service.

## Roles and access

| Role                     | Access                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous                | Public Webflow page and existing application only; cannot fetch private inventory, addresses, files or offers                           |
| Pending/revoked investor | Own access status only; no inventory or file access                                                                                     |
| Approved investor        | Released active property versions, approved packet files, own saved properties and own inquiries/offers                                 |
| Staff editor             | Create and revise drafts, upload permitted media, inspect assigned property/inquiry records; cannot release without reviewer permission |
| Staff reviewer/admin     | Review and release/withdraw versions, approve/revoke membership, assign owners and review activity                                      |

Authorization runs on every server request and file issuance. A client-supplied role or investor ID is never trusted. Investors cannot edit properties, retrieve internal notes, see other investors' offers or obtain a draft by guessing its ID. Approval changes are audited. No invitations or notifications are sent automatically during development.

## Staff property log

List view: search by address/property ID, filter market, owner, status and review state; show address, asset, asking price, owner, last update, released version and inquiry count. Provide Add property, Open draft, Preview as investor and History actions. On mobile, rows become labeled cards; actions remain at least 44px.

Editor sections: Property, Numbers, Photos and packet, Investor description, Internal notes, Review and release. Explicit Save draft with unsaved-change protection; a failed save retains entered values and displays an actionable error. Do not silently overwrite another editor's changes: version-conflict response requires reload/compare.

| Field group       | Fields and rules                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity/location | Stable property ID, display title, full address, city, state, ZIP, market; numeric ZIPs are strings                                                                      |
| Property          | Asset type, beds, baths, living area, lot area, occupancy, condition; null means unknown, never zero by substitution                                                     |
| Numbers           | Asking price, rehabilitation estimate, ARV estimate, optional notes; estimates carry source and checked date, currency is USD stored as integer cents                    |
| Media             | Licensed/owned photos with alt text, display order and rights attestation; private packet files with title, MIME type, size, visibility and version                      |
| Investor content  | Summary, known issues, diligence notes, access instructions appropriate for investors, source/date labels and explicit unknown states                                    |
| Internal only     | Staff owner, seller/contact details, acquisition/contract costs, negotiation notes, internal documents and reviewer comments; excluded from investor response projection |
| Workflow          | Status, version, last editor/time, review checklist, reviewer/time, release/withdraw history                                                                             |

No fabricated listings, returns or performance claims. Sample records stay clearly marked fictional and are staging-only. Source lookups remain read-only references and never overwrite entered facts automatically. Do not copy Zillow/MLS imagery without rights.

### Property lifecycle

`Draft → Ready for review → Available → Under review → Under contract → Sold` with Withdrawn available as a reviewer action. Reopening a withdrawn/sold record requires an explicit review. Draft edits to an already released property do not change the investor view until a new version is reviewed and released.

Release is a server-side permission-checked action that snapshots a buyer-safe version. Checklist: required identity/property fields, owner, asking price or explicit price-on-request decision, media rights, estimate labels/sources/dates, no internal/seller data in buyer copy, and preview completed. Do not promise title clearance or guaranteed returns. Withdrawal stops new fetches and new file issuance; it does not delete inquiries, audit history or versions.

## Investor workspace

Navigation: Inventory, Saved properties, My inquiries/offers, Buy Box, Account. Inventory supports market, asset type, price range and availability filters, sorting and a truthful empty state. The details view separates Overview, Property record and Photos. Show source/date and Unknown where facts are absent; the Match/Differs/Unknown legend explains that comparison is informational and not a purchase recommendation or offer.

Keep the existing public Buy Box as the intake source. Do not require re-entering criteria already collected. A verified member's criteria can be linked using an explicit staff-reviewed mapping; do not merge contacts or grant access based on an unverified email match. Until this mapping exists, link to the working public application and describe the manual review accurately.

First release uses a short property inquiry: property/version, verified investor identity, message, optional proposed price/timing, and an idempotency key. It is explicitly nonbinding and creates no contract or reservation. Show a durable receipt/reference and an own-history view; failed requests retain inputs. No counteroffer/acceptance contract workflow or proof-of-funds uploads in the first slice.

## Data and audit boundaries

Logical records: memberships, properties, property_draft_versions, property_releases, property_assets, saved_properties, investor_inquiries and append-only activity_events. Persist actor, action, property/inquiry/version ID and timestamp for edits, review, release, withdrawal and status changes. Staff history is read-only; do not hard-delete activity during normal use.

Use buyer-safe response projections, not a full property object with hidden UI fields. Files remain private: validate allowed type/size, store generated object IDs, and issue short-lived signed downloads only after membership and current release checks. No public CDN packet URL. Signed-link expiry/revocation limits must be documented and tested; choose a maximum 60-second TTL for the first release. Never put shared tokens in local storage or URLs. Authenticate/re-authorize on reload, session expiry and approval revocation; private responses use no-store caching.

For inquiry creation, a unique investor + idempotency-key constraint returns the original receipt on a retry; different payload reuse is rejected. Separate deliberate inquiries are separate actions. The first slice records an internal inquiry once and does not automatically send emails/SMS or create extra CRM sales tasks. A later explicit integration can map approved investor activity into HighLevel using stable external IDs and idempotent delivery.

## Brand, accessibility and existing systems

Use PBK blue `#3299DA` for large accents/keylines/focus, ink `#102F42` for readable text and primary button fills, pale blue `#EAF4FB`, white and restrained black. Existing Webflow gradients remain byte-for-byte unchanged. Gold review badges and the guide HighLevel connection remain staging-only. The public Buy Box form IDs/names/submission handling and HighLevel/Calendly integrations stay unchanged.

Desktop reference 1440px; mobile 390px, with a 320px overflow check. Native semantic controls, visible focus, labeled errors, keyboard tab/arrow controls, dialog focus management and reduced-motion support. Photos use real approved assets or honest empty states. No fabricated review badges or unverified statistics.

## Definition of working staging

1. An authorized staff test user saves a fictional property; reload returns the saved draft, with no investor visibility.
2. An editor without reviewer permission cannot release it, including via direct API request.
3. A reviewer previews and releases version 1; an approved investor sees only its buyer-safe fields and approved media.
4. Anonymous, pending, revoked and a different investor cannot retrieve unauthorized records/files or another investor's inquiry, including by direct ID.
5. A staged draft revision remains private until reviewed; withdrawal removes availability and new packet downloads while retaining history.
6. An inquiry and network retry produce one durable record/receipt; staff sees it and the investor sees only their own history.
7. Desktop/mobile controls, validation, save failures, stale versions, keyboard flow, reduced motion and no-overflow checks pass.
8. Public Buy Box/Calendly remain reachable, no production publish occurs, and no real outreach is triggered.

## Delivery order

First build the authenticated staging draft/release/read/inquiry slice with the property log. Then add saved-property filters, the richer packet comparison view and offer-status history. Add CMS export/public teasers, automatic matching, deal alerts and CRM opportunity automation only as later explicit work. A portal login button is not shipped as functional before the protected backend is verified.

## Approval boundary and dependencies

This design needs founder review before implementation. The approved direction is private investors; approval of this document confirms the first slice and the separate staff/investor permissions. Builder choices include exact module layout and visual spacing. Outstanding implementation dependencies are configured staging individual auth, a separate private data/storage namespace, staff/reviewer test identities and real inventory/media supplied later. Use fictional staged records while testing. No paid resource creation, production migration, member invitations or public release is implied by approval of the build design.
