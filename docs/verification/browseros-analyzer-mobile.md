# BrowserOS Analyzer Mobile Proof

This manual test attaches to an already unlocked Chromium/BrowserOS session. It does not
deploy, change site protection, revoke the operator session, save CRM leads, or
send outreach. The default CI command runs offline safety checks only.

## Offline Checks

```powershell
npm run test:analyzer-browseros-mobile
npm run test:analyzer-draft-storage
```

Importing the live runner does not connect to a browser. The offline checks cover
explicit opt-in, build pinning, loopback-only CDP, target-site validation, and the
fail-closed request policy. Offline response fixtures also reject stale-shell
bundle paths, missing responses, changed bytes, foreign origins, failed responses,
and unavailable bodies. They run through the existing Analyzer storage test
command; no hosted workflow is added. These checks do not revalidate the previous
live run or establish a new hosted, session, mobile, or screenshot result.

## Manual Live Run

1. Open the private PBK site in BrowserOS and complete Netlify and PBK sign-in.
   Enter credentials only in the browser. Do not place credentials in arguments,
   environment variables, reports, screenshots, or committed files.
2. Obtain the local BrowserOS CDP HTTP origin from that installation. The CDP
   origin is not the MCP endpoint and is not necessarily on the same port.
   Keep both interfaces local; do not expose a debugger over the network.
3. Have the exact deployed build's `dist` directory available. Pin the full
   deployed commit SHA, not a branch name or this test-only branch's commit.
   Its local `pbk-build-manifest.json` must contain that SHA as `buildId`, with
   exactly one App, DealView, and analyzerStorage JavaScript bundle in `assets`.
4. Run the following with those non-secret values supplied locally:

```powershell
npm run test:analyzer-browseros-mobile-live -- --run-live --cdp-url $BrowserOsCdpOrigin --expected-build $DeployedCommit --asset-dir $MatchingDist
```

For desktop coverage, run the same command with `--desktop`. This selects a
1440x844 non-touch viewport; the default still tests both 390x844 and 320x844
touch-mobile viewports. Run both modes to cover overlapping tabs, simultaneous
writes, private conflict drafts, reloads and verifier recovery on every width.

The runner attaches without overriding the operator browser's default settings.
It checks native browser context IDs before seeding auth or navigating a QA
page, not only Playwright wrapper identity. On a collision, it closes only the
new blank page and will not close an unverified native context. Cookie reads
use the source tab's actual native
context, including an already-open incognito QA tab. Only cookies applicable to
the approved PBK hostname are copied, in memory; none are printed or exported.
Host-only parent-domain cookies are excluded rather than treated as domain cookies.
Partitioned cookies retain their top-level site and cross-site-ancestor flag in
Playwright's cookie shape; CDP-only metadata is not passed through unchanged.

If BrowserOS attachment fails before a page loads, that is an incomplete proof,
not a passing test. Use a separate authorized Chrome QA session with local CDP
and browser-only sign-in; do not clear the working profile or weaken Netlify.
Machine-specific launch/download helpers, credentials and captured artifacts do
not belong in this test-only change.

Optional `--base-url` accepts only the PBK Netlify production origin or a PBK
deploy URL. Optional `--output-dir` changes the artifact destination. By default,
reports and sample-only screenshots stay under ignored `.pbk-local/`.

## Isolation and Coverage

- Creates separate ephemeral BrowserOS contexts at 390x844 and 320x844 with touch
  enabled; asserts the actual viewport, rather than trusting window dimensions.
- Keeps only same-site authentication in memory. Never exports cookies,
  `storageState`, raw operator drafts, or authorization headers to artifacts.
- Reads source local/session entries matching draft, Analyzer and Compose
  storage before and after, including saved deals, Analyzer activity and the
  explicit legacy `pbk-deal-data` key. All
  values are captured synchronously before hashing, and only the entry count
  and preservation result reach the report. It never restores or overwrites a
  changed source draft, and does not modify or close the operator's context.
- Uses unlinked fictional data, verifies empty QA draft storage before seeding,
  and disposes every verified QA context on completion or failure.
- Allows real team status/verification only. CRM/property/runtime reads are
  fixtures; business mutations, direct providers, and WebSockets are blocked.
  Stream-session creation is stubbed. External reads are limited to font hosts.
  Live same-site reads are limited to the exact, query-free team status URL,
  Analyzer shell/manifest paths, and static asset/font files present in the local
  build. Only the exact query-free POST verification URL reaches real auth.
  Brain GETs (which can write memory), `/status`, and `/metrics` are fixtures;
  unknown reads fail closed. Allowed live requests cannot follow redirects.
- Verifies both local and deployed manifests against the pinned SHA. For every
  QA navigation/reload, compares the actual page response paths and SHA-256 bodies
  for App, DealView, and analyzerStorage to the local entries. Missing, stale,
  unreadable, foreign-origin, or non-200 bundles fail. Independently downloading
  matching files is not evidence that the tested shell loaded them.
- Checks simultaneous writers with a deliberately stale localStorage read,
  private conflict drafts, reloads, passive cross-tab updates, ARV/sold comps,
  manual repair notes, and horizontal overflow.
- Injects a verification interruption, then requires real backend verification.
  The rejection/remount check is a client-side event, not actual token revocation
  or a forced sign-out of other tabs.

Screenshot capture warnings are reported separately from functional assertions.
Screenshots were verified during the original proof; a capture timeout must not
be described as a successful new visual inspection.

This is Chromium mobile emulation, not a physical iPhone or a
live Safari/WebKit claim. The existing isolated WebKit suite remains separate.
Never wire the live runner into unattended CI, reset the working bridge, clear
operator storage, weaken Netlify protection, or use Hosted Founder Smoke as a
substitute for this sample-only proof.
