# Bridge integrity review for Mapbox prospecting

The previous pin matches the reviewed baseline `3dc70bad65f231505a44b425fe55c1d6380b0e4b`. PR #91 changed the bridge in `888b7e5b75e11e1dca10c53b3dc0bd7697c747f5`. The bridge blob is identical at the reviewed target `d4cc86c22e6222e4762a34fa2679dc72e2f7b477` on `main` and in the initial PR #95 commit `ab0d078ff54c520b524f7ca1a4212a5611807916`. The baseline pin reproduced the same single fingerprint failure locally and in Founder Verify. The maturity snapshot builder is identical across these revisions.

| Revision                                 | SHA-256 after the wiring test's LF normalization and exclusions    |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Reviewed baseline, 3,526,626 UTF-8 bytes | `6ef984330d7b1aec19a8b81291ae4840303d3fb08b7ccf4d1c7dbc15bdfeffa6` |
| Reviewed target, 3,529,357 UTF-8 bytes   | `8330fbb688a4d8567c2e6e2cd4aa2f8a111b1e2735ab1c3d7771dc5ae1360dcb` |

## Changes in the reviewed bridge

- The bridge imports the Hermes parcel prospecting service and registers its four POST routes in the authenticated dispatcher, after the existing bearer or permitted-team authorization and runtime bootstrap checks. The routes add no route-specific TOTP or team-role checks. Search and match use county evidence and the existing exact CRM matcher.
- The service can send an indexed list of parcel-use and building facts to DeepSeek when Hermes is enabled in suggest-only mode and the provider is ready. It passes no owner, contact, address, or parcel identifier. The validated ordering is advisory.
- The existing approval handler accepts an internal notification option that defaults to enabled. The Hermes parcel route disables Slack and n8n fanout for its saved approval request. Its binding covers the approval ID and exact county parcel and situs. Saving requires that approval to be approved, revalidates the binding and current CRM match, and uses the existing property-only lead path.
- The verified parcel save marks Hermes leads with their source and opts out of automatic Analyzer queueing. The existing parcel Dialer and other manual lead creation keep their default behavior. The new routes have no seller contact, outreach dispatch, or automatic Analyzer execution.

The notification change limits these parcel approvals to the existing Inbox. The fingerprint records this behavior already present on `main`. Any change to where approvals are handled needs its own product decision. Review also found that a failed approval state write can leave a pending entry in memory that a retry reports as already queued. Hosted approval decisions still require the existing Postgres claim. The fingerprint update changes only the test expectation.

## Verification

The second reviewer independently recalculated the hashes and reviewed the bridge changes and the connected approval, authorization, and parcel paths. Local verification used fixtures for parcel and provider requests. The affected parcel and Dialer tests, authorization and dispatch suites, launch safety, and serial isolated bridge smokes passed. The Property refresh UI uses the existing bridge behavior.
