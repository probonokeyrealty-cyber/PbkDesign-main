# Private Investor Live Release Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with a fresh whole-release review before production publication.

**Goal:** Publish the approved private investor portal live with a staff-only property log and verify the complete lifecycle without changing public forms or staging-only guide/badge features.

**Architecture:** Reuse the tested portal/domain/auth/storage implementation with explicit live and staging profiles. Live has a distinct service-only aggregate, private bucket and function; live staff use the existing protected pbkcenter shell and approved investors use the dedicated pbk-investors sign-in shell. Carry forward existing approved real memberships only, preserving roles; do not migrate QA properties, sessions, inquiries or invitations.

**Tech Stack:** Existing React/Vite, Supabase Auth/Postgres/Storage/Edge Functions, Netlify.

**Spec:** User request in this chat on November 14: publish the private portal live, keep property log staff-only, retest desktop/mobile/uploads/approval/revocation, preserve CRM/Calendly and staging-only badge/guide boundaries. Existing feature scope is in 2026-11-13-private-investor-portal.md.

## Global Constraints
- Preserve gradients and existing PBK design; no redesign, marketing publication or outreach.
- No new paid database/project. Use isolated live resources in the existing Supabase project.
- Keep Netlify team protection on all pbkcenter deployments; the public investor build contains no operator shell or server functions.
- Every private action validates Auth, current approved membership, role and registered expiring session. Files remain private with 60-second signed links.
- Keep staging storage, membership, URLs and deployments unchanged by live setup.
- Integrate latest origin/main before publishing the existing staff dashboard; never publish a stale dashboard snapshot.

## Review Focus
- Staging-only identities, unregistered sessions and cross-environment property/file IDs must not authorize live access. Auth issuer is shared: the same verified identity can register separately only where it has an approved target membership; roles never come from the client or another profile.
- Staff credentials on investor origin and investor credentials on staff-only actions must fail.
- Expired/logged-out/revoked sessions fail closed; pre-issued file link expiry is explicitly measured.
- No QA data or user-editable claims seed live access. Existing real membership roles are preserved.
- A concurrent main release must be preserved through integration rather than overwritten.

## Tasks
- [x] Integrate origin/main into isolated branch; reserve dedicated live project. No existing deploy changed.
- [x] RED→GREEN tests for explicit profiles, exact-origin policy, live seeding and environment isolation; refactor shared handler and add live build/copy.
- [ ] Add service-only live aggregate/commit/private bucket; seed existing approved real members only; deploy isolated backend and protected candidate builds.
- [ ] Run build, typecheck, portal tests, required founder release checks and hosted isolation/upload/lifecycle QA. Fresh whole-release review; fix material issues.
- [ ] Publish dedicated investor build and latest integrated staff dashboard through normal Git release; configure exact live Auth return URLs with required UI action-time approval.
- [ ] Chrome desktop/mobile full lifecycle, real file picker uploads, one inquiry, approval/revocation, expired PDF denial; withdraw QA house and revoke QA investor, preserve history. Record proof and final URLs.

## Ledger
- User explicitly authorizes live publication; no additional publish confirmation is required by local skill rules. Browser authentication-setting confirmation remains action-time when applicable.
- Current branch merged origin/main (53ecb51) as 4bd8fdf, preserving the concurrent agent-fleet work. Reserved live Netlify project 98e22ea2-79b2-4dd3-ae7c-b3835bc5f0bb, initially team-protected/empty.
- Ruling: use existing protected production shell for staff and a separate buyer-only live origin, extending the tested seams. Cost if wrong: production shell requires the ordinary integrated release gates.
- Ruling: live inventory starts empty, real approved account permissions are carried forward exactly, all test content remains synthetic and is withdrawn after QA. Cost if wrong: staff must post real properties explicitly before investors see inventory.

- Backend live function v1 deployed; protected buyer candidate 6af8698223e2b2e444e68f8f ready. Existing staff deployment was unchanged by that deployment. Hosted live API regression passed 22 checks with synthetic QA only; house withdrawn, audit retained. PNG/PDF download hashes matched. No email or CRM notifications sent.
- Independent reviewer found no additional critical/high portal-code issue; confirmed newer main 103219c must be integrated before staff publication. Known SMTP/custom-email and live Auth allowlist remain launch blockers.
- Broad founder suite stops at existing Windows Jest discovery: rootDir in testMatch does not match Windows normalized paths. Targeted 31 portal tests, typecheck, lint and minimum release gates passed before reintegration; will rerun minimum gates after final merge.
