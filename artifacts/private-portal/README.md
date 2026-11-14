# PBK private portal staging verification

Staging frontend: https://pbk-investor-staging--pbkcenter.netlify.app

Staff property log: /property-log. Investor entry: /investor-portal.html.
First real staff reviewer: probonokeyrealty@gmail.com. Request a sign-in code; use the code or copy the complete verification link from the email into the portal. No reviewer invitation or QA outreach email was sent.

The browser flow saved and recovered a fictional draft, previewed and released it, displayed the safe packet on mobile and received an internal inquiry visible to staff. The final reviewed build produced receipt e9c17475-c019-4976-85f5-60b906191b04 against viewed version1. Database query confirmed exactly one record for that final submission. Concurrent API retries independently returned one receipt. No contact, opportunity or sales task is automatically created by this staging portal.

Passing: 16 domain/client regression tests; hosted v5 API smoke; typecheck; production build; MCP typecheck; shell route aliases; cache headers; shell boot. Browser checks: desktop1440, buyer390/320 with no overflow; keyboard packet tabs and confirmation; save locks inputs; validation focuses its alert; unsaved shell navigation is blocked. Staff sign-in/reload and durable draft recovery verified. Private Storage uploaded/downloaded a real synthetic PNG with matching SHA256 and denied anonymous access.

Boundaries: production deploy is still6af7b7b387bbca35f557eba7. No Webflow publishing or changes to existing gradients, public Buy Box, HighLevel, Calendly, gold badges or guide configuration. Netlify's existing team protection remains enabled; outside investors cannot access this review deployment without that existing team access.

Manual recheck: Chrome's extension file-URL permission prevented the browser chooser upload. The equivalent hosted API upload/download passed. OS reduced-motion behavior was not toggled; CSS contains its no-motion media rule. Issued signed links have a60second expiry; withdrawal denies new links rather than instantly revoking previously issued links.

The wider bridge smoke was attempted in an isolated directory with external networking blocked; it did not pass (offline workflow dependency / fetch failed). No production runtime or provider test writes were attempted. This is a staging slice, not a production readiness certification.

Two deferred minor issues: a failed metadata commit after upload can leave an unreferenced private Storage object; empty occupancy/condition strings can display blank rather than Unknown. Full decisions, costs and review fixes are recorded in ../../docs/superpowers/plans/2026-11-13-private-investor-portal.md.
