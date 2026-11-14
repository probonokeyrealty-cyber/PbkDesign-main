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

- [x] Domain/security tests RED→GREEN: roles, draft/release isolation, optimistic revisions, source validation, withdrawal, inquiry idempotency, own-history, audit preservation.
- [x] Staging persistence and API: service-only state/CAS migration, individually verified auth, private-file checks, hosted API smoke tests.
- [x] UI: staff property log inside existing shell; buyer inventory/packet/saves/inquiries/login; responsive and keyboard controls.
- [x] Stage and verify: draft-only Netlify deploy, real staging Auth QA identities with no email delivery, staff→investor flow, unauthorized direct reads, files, revocation and reload.
- [x] Review whole branch, address material findings with regression tests, verify unchanged integrations and publish boundaries, provide staging links and proof.

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

## Final verification and rulings
- Final review: fresh read-only reviewer, 3d36bf6..e7728c2; seven Important findings, no Critical. All seven were fixed in one pass. Domain/client regression suite 16/16 green; release-version/capacity and missing client/body modules observed RED first. Browser RED→GREEN verified editable-during-save → disabled, offscreen error → focused alert, unguarded shell navigation → focused confirmation dialog.
- Hosted API v5 smoke passes: individual OTP; anonymous/pending denied; editor release denied; preview required; actual private PNG upload and SHA256 download match; public file denied; buyer notes excluded; three concurrent retries one receipt; other-investor isolation; stale save409; draft snapshot isolation; withdrawn record/file denial; live revoked session403; logout401. No emails, SMS, sales tasks or CRM writes.
- Hosted draft: https://pbk-investor-staging--pbkcenter.netlify.app. Latest frontend deploy 6af7c48ac22e9850f88b354d. Production remained 6af7b7b387bbca35f557eba7 throughout these draft deployments. Existing Netlify team protection stays enabled.
- Real Chrome staff→investor milestone: fictional property 100 Example Lane saved; reauthentication after reload recovered it; reviewer preview/release; mobile investor packet excludes internal QA note; arrow/Home/End tabs; save/own-history; one inquiry d4037132-9d02-488e-adad-87a0ae094c9b received and visible to staff after Refresh. Buyer viewport390 and320 had no horizontal overflow. Desktop1440 screenshot saved. No real property information posted.
- Typecheck, build, MCP typecheck, shell-route-aliases, Netlify cache-header and shell-production-boot checks pass. Broader bridge smoke was attempted only in an isolated state directory with external fetches blocked and credentials suppressed; it did not pass (offline workflow dependency, then fetch failed). No founder/production-readiness claim and no production bridge test writes.
- Browser upload chooser is blocked by Chrome extension file-URL permission. Storage upload/download passed via the hosted API; browser upload remains a manual recheck after that permission is enabled.
- Final: Ruling: rendered desktop/mobile and keyboard controls were exercised directly; dynamic OS reduced-motion toggling was not changed. The CSS disables animation/transitions under prefers-reduced-motion. Cost if wrong: OS-specific motion behavior needs a further manual check.
- Final: Ruling: signed downloads request60second expiry and withdrawal blocks new issuance; the remaining lifetime of an already issued link is accepted for this staging slice, not instant revocation. Cost if wrong: a copied link may work for up to60seconds.
- Final: Ruling: use provider OTP limits and bounded request readers; no load test against the shared Supabase project. Cost if wrong: abuse/scaling requires a dedicated environment before production.
- Final: Ruling: normalized storage, full lifecycle/criteria comparison/account administration, backups and outreach automation stay beyond the approved first slice. Cost if wrong: these must be implemented before expanding use.
- Final: Ruling: preserve existing Webflow public forms/CRM/Calendly and gradients without modifying or publishing them; this portal creates internal inquiries only. Cost if wrong: no automatic CRM follow-up from portal activity until separately requested.
- Final: Ruling: staff route retains surrounding operator shell; existing team gate still protects other routes and server authorization remains authoritative. This draft has no bridge functions and restrictive CSP. Cost if wrong: production integration requires a separate bridge authorization review before merge/deploy.
- Final: minor (deferred): a failed upload metadata commit can leave an unreferenced private storage object; no sensitive object is public, but an orphan cleanup job is future work.
- Final: minor (deferred): empty occupancy/condition values can display blank instead of Unknown.
- Branch kept isolated; no push, merge, production deploy, paid resource creation or public Webflow publication.

- Final post-fix Chrome submission receipt e9c17475-c019-4976-85f5-60b906191b04, version1; database verified exactly one inquiry. Selected navigation contrast verified ink rgb(16,47,66) / white. Final reviewer handoff page opened with the selected staff email; QA buyer signed out. Netlify connector independently confirms published production deploy unchanged.
