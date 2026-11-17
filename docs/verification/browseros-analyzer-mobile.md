# BrowserOS Analyzer Mobile Proof

This manual test attaches to an already unlocked BrowserOS session. It does not
deploy, change site protection, revoke the operator session, save CRM leads, or
send outreach. The default CI command runs offline safety checks only.

## Offline Checks

```powershell
npm run test:analyzer-browseros-mobile
npm run test:analyzer-draft-storage
```

Importing the live runner does not connect to a browser. The offline checks cover
explicit opt-in, build pinning, loopback-only CDP, target-site validation, and the
fail-closed request policy. They also run through the existing Analyzer storage
test command; no hosted workflow is added.

## Manual Live Run

1. Open the private PBK site in BrowserOS and complete Netlify and PBK sign-in.
   Enter credentials only in the browser. Do not place credentials in arguments,
   environment variables, reports, screenshots, or committed files.
2. Obtain the local BrowserOS CDP HTTP origin from that installation. The CDP
   origin is not the MCP endpoint and is not necessarily on the same port.
   Keep both interfaces local; do not expose a debugger over the network.
3. Have the exact deployed build's `dist` directory available. Pin the full
   deployed commit SHA, not a branch name or this test-only branch's commit.
4. Run the following with those non-secret values supplied locally:

```powershell
npm run test:analyzer-browseros-mobile-live -- --run-live --cdp-url $BrowserOsCdpOrigin --expected-build $DeployedCommit --asset-dir $MatchingDist
```

Optional `--base-url` accepts only the PBK Netlify production origin or a PBK
deploy URL. Optional `--output-dir` changes the artifact destination. By default,
reports and sample-only screenshots stay under ignored `.pbk-local/`.

## Isolation and Coverage

- Creates separate ephemeral BrowserOS contexts at 390x844 and 320x844 with touch
  enabled; asserts the actual viewport, rather than trusting window dimensions.
- Keeps only same-site authentication in memory. Never exports cookies,
  `storageState`, raw operator drafts, or authorization headers to artifacts.
- Reads the source tab's shared/private draft fingerprints before and after,
  including failed runs. Does not modify or close the operator's context.
- Uses unlinked fictional data, verifies empty QA draft storage before seeding,
  and disposes every QA context on completion or failure.
- Allows real team status/verification only. CRM/property/runtime reads are
  fixtures; business mutations, direct providers, and WebSockets are blocked.
  Stream-session creation is stubbed. External reads are limited to font hosts.
- Verifies the deployed manifest and exact App, DealView, and analyzerStorage
  asset hashes against the supplied build.
- Checks simultaneous writers with a deliberately stale localStorage read,
  private conflict drafts, reloads, passive cross-tab updates, ARV/sold comps,
  manual repair notes, and horizontal overflow.
- Injects a verification interruption, then requires real backend verification.
  The rejection/remount check is a client-side event, not actual token revocation
  or a forced sign-out of other tabs.

Screenshot capture warnings are reported separately from functional assertions.
Screenshots were verified during the original proof; a capture timeout must not
be described as a successful new visual inspection.

This is Chromium-based BrowserOS mobile emulation, not a physical iPhone or a
live Safari/WebKit claim. The existing isolated WebKit suite remains separate.
Never wire the live runner into unattended CI, reset the working bridge, clear
operator storage, weaken Netlify protection, or use Hosted Founder Smoke as a
substitute for this sample-only proof.
