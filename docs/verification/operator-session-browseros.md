# Desktop And Mobile Operator Regression Proof

This manual runner checks the deployed PBK UI and real team verification in
isolated BrowserOS contexts. It never deploys, changes site protection, saves CRM
records, submits approval decisions, or contacts business providers. All business
reads are fictional browser fixtures, including Brain GETs that can have side
effects. It does not establish live provider delivery or production approval
execution.

## Offline CI Checks

```powershell
npm run test:operator-session-browseros
npm run test:analyzer-draft-storage
```

The second command is an existing Founder gate and now includes these safety
checks. Importing the live runner or using `--help` never attaches to a browser.
No workflow invokes the manual live command.

## Authorized Manual Run

1. Unlock Netlify and PBK in an existing BrowserOS tab. Enter credentials only in
   the browser, never in arguments, artifacts, or committed files.
2. Obtain that installation's loopback HTTP CDP origin; do not expose debugging
   over the network or confuse CDP with the MCP endpoint.
3. Supply the full deployed frontend build SHA and its matching local `dist`.
   The local and deployed manifests must agree. The runner checks actual loaded
   asset response paths and SHA-256 bodies against those local files, including
   duplicate requests and reloads. A separately downloaded matching file is not
   evidence that a tested page loaded it.
4. Run only with permission for a manual live proof:

```powershell
npm run test:operator-session-browseros-live -- --run-live --cdp-url $BrowserOsCdpOrigin --expected-build $FrontendBuild --asset-dir $MatchingDist
```

Optional `--base-url` is restricted to the private PBK Netlify production origin
or its deploy URLs. `--output-dir` controls sample-only artifacts; the default
is ignored `.pbk-local/`. No credentials, cookies, source drafts, or storage-state
exports are written. Authentication is copied in memory only into ephemeral
contexts; source shared/private draft fingerprints are checked even on failure.
The operator's browser and tabs are never closed or modified.

## Coverage And Limits

- Desktop 1440x900 and mobile touch 390x900, with actual viewport assertions,
  horizontal overflow checks, screenshots, and uncaught-error checks.
- Browser-only pending approval: four Decision Rail steps, explicit confirmation,
  and cancel without a decision or delivery receipt. Confirmation is never clicked.
- Compose draft reload, invalid-recipient Send guard, temporary verifier outage,
  retention of a valid session, expired-session locking, and cross-tab recovery.
- Unlinked Analyzer draft reload and second-tab opening, verifier recovery, and
  preservation of manual notes, repairs, sold comp, and ARV.
- Outages and expiry are simulated only inside QA. Cross-tab restoration reuses
  the already-authorized session copy and must pass real backend verification;
  this is not a password-exchange or actual token-revocation test.
- Business mutations, direct-provider traffic, WebSockets, and unknown reads are
  blocked. Stream creation is stubbed. Only exact team status/verification,
  approved shell paths, pinned static files, and font-host GETs may be forwarded;
  forwarded requests cannot follow redirects.

This is Chromium-based BrowserOS mobile emulation, not a physical iPhone or live
Safari/WebKit claim. A failed screenshot or preservation assertion fails the run.
The report explicitly distinguishes live assets/auth from sample business state.
Do not wire the live runner into unattended CI or weaken authentication to run it.
