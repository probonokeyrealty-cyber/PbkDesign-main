# PBK private portal staging verification

Investor staging entry (no Netlify team login): https://pbk-investors-staging.netlify.app

Protected staff property log: https://pbk-investor-staging--pbkcenter.netlify.app/property-log

## Current investor access separation

Investors use the new dedicated staging address above. The anonymous sign-in page is public, but inventory, packets, private file links and inquiries still require a verified, approved PBK investor identity. Pending and unknown users cannot read inventory. Staff identities are rejected on the investor entry; staff keep the existing Netlify-protected project and PBK staff-role checks. The public staging deployment contains only the buyer entry assets, a 404 page and security metadata. Its `/property-log`, `/index.shell.html`, `/api/health` and `/state` paths return 404. No command-center shell or provider functions were deployed there.

Netlify project `pbk-investors-staging` (`7d2d0593-795c-4cd6-a5ab-51abcf7b0d1f`), deploy `6af7cff476e236b1805b6fb2`; isolated staging backend v7. This release changed visitor access only on the new project. The existing `pbkcenter` project still requires Netlify team login on all deployments. The new project's main address is a staging environment even though Netlify labels its serving deploy context as production; no existing production frontend was deployed by this work.

Verified: 23 regressions, 22 hosted API checks, seven cookie-free HTTP checks, full standard build, isolated buyer build and typecheck. Chrome verified approved sign-in without a Netlify prompt, pending-user denial, desktop/390px packet controls with no horizontal overflow, private PDF opening and an internal no-outreach inquiry visible to the staff reviewer. Receipt `40dc63ff-399d-41ee-8282-7114f7707ba9` has exactly one database record. Staff and buyer QA sessions were signed out afterward. No new live CRM submission, appointment, email, SMS or sales task was created. Gradients, public CRM/Calendly forms, gold badges and the guide connection configuration were not changed.

Concurrent production activity: existing production was `6af7c732d1721e237426ebd8` both before and immediately after our isolated staging deployment. A separate CLI/main release titled “Ava Chat workbench: preserved history/context/drafts and guarded approvals” published `6af7d086370813a89ab209a6` at 2026-11-14T03:08:43Z while these browser tests were running. It was not this staging deployment and was left unchanged. Existing project visitor protection remained enabled.

Access evidence: `investor-access-verification.json`, `hosted-public-entry-retest.json`, `investor-entry-http-smoke.json`, `investor-public-access-desktop.png`, `investor-public-access-receipt.png`, `investor-pending-access-denied.png`, `investor-public-staff-receipt.png`.

### Approval and revocation retest — November 13

A separate synthetic, no-outreach investor (`pbk.qa.approval.20261113@example.com`) was initially denied, approved through the reviewer API, signed in through Chrome, and allowed to read the released fictional house and download the matching PDF. It was then revoked while both its API and browser sessions remained active. The existing token received 403 for session, house list, individual property, PDF signing, saved properties and inquiry history; removing Origin did not bypass membership. A new verified sign-in was also denied. The browser's PDF request was rejected, its private state cleared, and both house and download controls disappeared. Staff saw **Not approved** afterward.

The PDF URL issued before revocation remained usable until its pre-existing 60-second expiry, then Storage returned 400 with an expired-JWT error. Revocation blocks new access immediately; it cannot recall a PDF already downloaded or instantly invalidate an already-issued signed URL. No security behavior or deployment was changed by this test.

All 17 lifecycle checks, 23 regressions and seven cookie-free HTTP checks passed. The QA member and invitation are left revoked; one approval and two revocation audit events (initial denial setup plus final revocation) are preserved. Both deployed frontends and their visitor settings remained unchanged throughout this test. CRM/Calendly configuration, gradients, badge and guide staging guards were not modified. Evidence: `approval-revocation-verification.json`, `approval-qa-approved.png`, `approval-qa-revoked-browser.png`, `approval-qa-staff-revoked.png`.

The scoped test helper is `scripts/investor-approval-revocation-qa.mjs`: run `setup`, `approve`, `revoke`, then `verify-expiry` after the reported link expiry. It uses one fixed synthetic account and ignored local QA credentials; finish with the revoked state rather than leaving the approval phase active. It does not reset real investor roles or create CRM records, inquiries, appointments or outreach.

### Staging operation instructions

Staff sign in at the protected property log with their approved staff email. A reviewer can approve an investor's application email in **Investor access**; the investor then requests a code at the separate investor staging address. Approval does not grant Netlify team membership. Revoking the investor in the property log denies the next protected request and clears the app session on revalidation. Existing per-user inquiry history and published property snapshots remain authoritative.

Build with `npm run build:investor-staging`; verify with `npm run test:investor-portal` and `npm run test:investor-entry-hosted`; deploy only the dedicated project with `npm run deploy:investor-staging-public`. Deployment does not relink this workspace; `.netlify/` remains ignored. Access settings use the Netlify connector, not a CLI-token workaround. The Supabase function must retain the exact public staging origin in `entryPolicy.mjs`; production and lookalike origins stay denied. Do not remove the existing staff project's protection.

## Previous upload verification

First real staff reviewer: `probonokeyrealty@gmail.com`. Request a sign-in code and verify ownership in the portal. No real reviewer invitation or QA outreach email was sent. The browser was left at staff sign-in; synthetic QA browser sessions were signed out.

## November 13 upload retest

Fixed the two previously deferred issues: empty occupancy/condition facts now display **Unknown**, and uploads reserve a private object path before writing bytes. Failed metadata attachment reconciles against durable state, removes an unreferenced reserved object, and preserves a committed object if the response was lost. If cleanup itself fails, the reservation remains for a later authorized upload to retry after an hour. Cleanup only targets generated reservation paths, never scans or deletes arbitrary bucket contents.

Chrome's extension chooser still reported file-URL access unavailable after the user enabled it. The normal Windows file picker succeeded. Through the actual staff form, QA uploaded an owned synthetic 800x500 PNG and a one-page PDF, recorded rights/alt text, previewed and released version 2 of the fictional sample. An approved investor opened the image and the PDF in Chrome. The mobile packet download control opened the same PDF. The PDF viewer visibly showed one page and the synthetic no-outreach packet. Hosted downloads independently matched both original file hashes.

The mobile inquiry returned receipt `e07af035-306b-4ea7-a878-cda0f3375c43`. Staff refreshed the inquiry log and saw that exact receipt and no-outreach message. A database query confirmed one record against property version 2. Existing inquiry and property history were retained. This portal creates internal nonbinding inquiries; it does not automatically create HighLevel contacts, deals or sales tasks or send outreach.

## Checks

- 20/20 domain, client and upload-recovery regressions passed.
- 18/18 hosted v6 API checks passed, including anonymous/pending denial, editor release denial, safe buyer projection, private PNG/PDF hashes, three concurrent inquiry retries returning one receipt, cross-investor isolation, stale saves, withdrawal, logout and revocation.
- Two uploads raced at one property revision: one succeeded and one returned 409. Final storage query: zero pending reservations and zero unreferenced files.
- Browser: desktop packet/release/inquiry controls; buyer at 390px and 320px, no horizontal overflow; arrow-key packet tabs; private photo/PDF opening; internal staff notes absent from the buyer page. Prior staff responsive and validation checks remain documented in Git history.
- Frontend typecheck and production build passed. Hosted bridge read-only health returned HTTP 200, `ok: true`, core components up and CRM sync ready. No provider-write smoke was run.

## Boundaries

### Staging email-link repair — November 13

Root cause: the shared Auth service had Site URL `http://localhost:3000`, no redirect allowlist, and the staging app supported pasted verification URLs/OTPs but did not consume the session returned after clicking a Magic Link.

The staging-only backend now requests an exact return address for each entry. Both frontends consume the callback, clear the URL fragment before async work, verify the bearer with the project's Auth service, and register only currently approved members. Staff identities remain rejected on the public investor entry. No refresh token is retained; session expiry and logout tombstones prevent callback replay from extending or resurrecting a portal session. Existing OTP/pasted-link sign-in remains available.

Deployed backend version 8, investor staging `6af7d9c60274bd1c39bde625`, and protected staff draft `6af7d9d2f34920866cfb7fbc`. Production deploy `6af7d086370813a89ab209a6` was unchanged before/after both deployments. No access protection was removed. No Webflow, CRM, Calendly, gradient, gold-badge or guide configuration was changed.

Validation so far: 27 regressions, full build, investor-only build, typecheck, diff check, independent code review, seven hosted entry checks, and two hosted invalid-credential checks passed. Chrome verified expired-link recovery and fragment removal at 390px with no overflow. At that point, complete clicked-link verification awaited approval to save two exact Auth redirect URLs: `https://pbk-investors-staging.netlify.app/` and `https://pbk-investor-staging--pbkcenter.netlify.app/property-log`. The default Site URL remains unchanged. They were prepared in the dashboard but not yet saved; the November 14 verification below supersedes that pending status. `scripts/investor-auth-hosted-qa.mjs` exercises synthetic links without sending email, verifies both return destinations, role access, logout replay rejection and single-use behavior; run it after that setting is saved.

Upload-retest frontend deploy: `6af7c97681ba7d4a8796a6dc`; backend version 6 at that point. Production deploy remained `6af7c732d1721e237426ebd8` throughout that earlier retest. No Webflow publish, production deployment, or changes to existing gradients, public Buy Box, HighLevel, Calendly, gold badges or guide configuration were made. No new live CRM submission or Calendly booking was created. The gold badge and guide connection staging restrictions were left unchanged.

The original staff project's Netlify team SSO remains enabled for all its deployments. Investors now use the separate address documented above. Signed links expire after 60 seconds; withdrawal denies new links, while an already-issued link can survive until its expiry. The earlier isolated wider-bridge offline smoke did not pass; that is distinct from the passing hosted portal API and read-only bridge health check. This staging verification is not a production release certification.

Evidence: `upload-inquiry-mobile.png`, `upload-staff-receipt-desktop.png`, `qa-pdf-viewer.png`, `verification.json`, `hosted-upload-retest.json`. Earlier decisions and review fixes: `../../docs/superpowers/plans/2026-11-13-private-investor-portal.md`.


### Approved email-link verification - November 14

The founder approved both exact staging return URLs. Saved both in the Auth redirect allowlist and visibly confirmed Total URLs: 2. Left the default Site URL unchanged; no wildcard, production redirect, authentication bypass, provider role, or access-protection change was added.

Hosted verification passed for investor and reviewer links: each Auth verification returned to its correct staging page, accepted only the approved identity, enforced the one-hour session ceiling, rejected invalid/missing tokens and staff identities on the public investor entry, rejected replay after logout, and rejected reuse of the consumed link. The QA generator uses `redirect_to` in the Auth admin request query (matching Auth's API); placing it in the request body was ignored and was corrected in the test helper. No emails were sent and no member approvals were changed.

Actual Chrome navigation passed for investor and reviewer on desktop and at a 390px mobile viewport. Both arrived signed in on the correct page with credentials removed from the URL. Mobile had no horizontal overflow. Mobile sign-out cleared the private view, and reopening each consumed link showed a clear fresh-link message with no private inventory. Temporary viewport overrides were reset. Tests used generated no-outreach QA Magic Links; actual mailbox delivery was not tested.

Seven cookie-free hosted entry checks still pass; the staff property log returns 401 without Netlify team authentication. Original production deploy `6af7d086370813a89ab209a6` and all visitor protections were unchanged before/after this work. Read-only bridge health returned HTTP 200, ok true and authentication required. No Webflow publish, CRM/Calendly form submission, appointment, gold badge, gradient or guide-connection change was made. Existing badge and guide staging boundaries remain in place.

Evidence: `auth-signin-verification.json`, `staging-auth-redirects-saved.png`, `auth-investor-desktop.png`, `auth-staff-desktop.png`, `auth-investor-mobile.png`, `auth-staff-mobile.png`, `auth-used-link-mobile.png`. Request a fresh sign-in email from the appropriate staging entry; older consumed or expired email links remain invalid by design.
