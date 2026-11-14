# PBK private portal staging verification

Staging frontend: https://pbk-investor-staging--pbkcenter.netlify.app

Staff property log: `/property-log`. Investor entry: `/investor-portal.html`.
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

Current draft frontend deploy: `6af7c97681ba7d4a8796a6dc`; backend version 6. Production deploy remained `6af7c732d1721e237426ebd8` throughout this retest. No Webflow publish, production deployment, or changes to existing gradients, public Buy Box, HighLevel, Calendly, gold badges or guide configuration were made. No new live CRM submission or Calendly booking was created in this run. The gold badge and guide connection staging restrictions were left unchanged.

Netlify's existing team SSO protection remains enabled for all deployments. Outside investors cannot access this review deployment without that existing team access. Signed links expire after 60 seconds; withdrawal denies new links, while an already-issued link can survive until its expiry. The earlier isolated wider-bridge offline smoke did not pass; that is distinct from the passing hosted portal API and current read-only bridge health check. This staging verification is not a production release certification.

Evidence: `upload-inquiry-mobile.png`, `upload-staff-receipt-desktop.png`, `qa-pdf-viewer.png`, `verification.json`, `hosted-upload-retest.json`. Earlier decisions and review fixes: `../../docs/superpowers/plans/2026-11-13-private-investor-portal.md`.
