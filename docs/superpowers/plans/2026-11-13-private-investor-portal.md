# Private Investor Portal Implementation Plan

> Execute sequentially with superpowers:executing-plans. The founder approved the design and staging implementation on November 13, 2026.

**Goal:** Working private staging property draft → release → investor inquiry → staff receipt.
**Architecture:** Add a property-log route to the existing operator shell and a separate buyer entry. A staging-only Supabase Edge Function validates individual Auth sessions and reads live membership permissions. An isolated, service-only staging state aggregate uses compare-and-swap revision commits so property releases, inquiries and audit records commit atomically. Private Storage holds approved packet assets. Existing runtime, CRM and Webflow code remain untouched.
**Tech stack:** Existing React/Vite; dependency-free domain module; Supabase Auth/REST/Storage and Edge Functions.
**Spec:** ../specs/2026-11-13-private-investor-portal-design.md

## Constraints

- No production deploy, migrations to existing tables, notifications or real lead changes.
- New data objects use pbk_investor_staging names. No grants to anonymous/authenticated database roles.
- Buyer payloads are explicit projections; server role/membership checks precede every action.
- Auth tokens stay in memory; staging backend has no bypass login or shared founder-token path.
- Signed assets expire in 60 seconds. No public packet bucket.
- Public Buy Box, Calendly, gradients, badges and guide integration remain unchanged.

## Tasks

- [ ] Domain/security tests RED→GREEN: roles, draft/release isolation, optimistic revisions, source validation, withdrawal, inquiry idempotency, own-history, audit preservation.
- [ ] Staging persistence and API: service-only state/CAS migration, individually verified auth, private-file checks, hosted API smoke tests.
- [ ] UI: staff property log inside existing shell; buyer inventory/packet/saves/inquiries/login; responsive and keyboard controls.
- [ ] Stage and verify: draft-only Netlify deploy, real staging Auth QA identities with no email delivery, staff→investor flow, unauthorized direct reads, files, revocation and reload.
- [ ] Review whole branch, address material findings with regression tests, verify unchanged integrations and publish boundaries, provide staging links and proof.

## Review focus

- Same inquiry retried concurrently must return one receipt.
- Saving a revision must not change a released snapshot.
- Expired/revoked sessions and role spoofing must fail closed.
- A private file cannot be downloaded merely by knowing its object ID.
- Mobile validation errors and long addresses must remain usable.

## Ledger

- Approved private portal and first staging slice; no further design approval required.
- Ruling: use the existing Supabase project with a new isolated staging aggregate and bucket rather than incur unapproved branch/project charges. Existing tables and functions remain unchanged. Cost if wrong: shared project availability still affects staging.
- Ruling: reuse the runtime's JSONB aggregate pattern with atomic revision commits for this initial slice; cap document size and return a capacity error without losing history. Cost if wrong: high-volume inventory will require normalized storage later. No production-readiness claim is made by a staging release.
- Ruling: staff log is a route in the existing React operator shell; the legacy shell gets an entry link to the same route. Buyer UI is intentionally separate from the private operator shell.

- Deployment blocker verified in Netlify UI: project dashboard restricted for non-payment; draft API returns405. No production deployment attempted. Local UI and isolated hosted backend QA continue.

- Deployment investigation: checked-in Netlify site ID referred to retired pbkcommandcenter. Current active pbkcenter uses the same repository (87711eb9-2a9f-40b4-92c6-0f8075151ff0). Target only a new draft of active project, preserving its published deploy.
