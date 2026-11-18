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

## WebKit Fixture Startup

The local Analyzer suite has its own per-process Vite dependency cache and scans
only the recovery fixture entry. It prepares fixed fixture entries, then awaits
Vite's complete client request graph and pending dependency scan/bundling promises
before launching browsers. A later startup trace found eight optimized dependency
requests pending after transforms were idle; a regression now holds those promises
to verify preparation cannot return early. This keeps cold compiler work outside the
existing navigation budget; it does not increase timeouts, skip assertions,
retry failed scenarios, or permit network/provider writes.

Vite describes on-demand transform waterfalls in its
[performance guide](https://vite.dev/guide/performance.html#warm-up-frequently-used-files).
If startup preparation fails, the suite fails before browser launch.

Run the complete local desktop and iPhone/WebKit coverage without filters:

```powershell
node scripts/analyzer-draft-recovery-browser-smoke.mjs
```

An intermediate run also failed the active-writer publication checkpoint. Its
cause is unconfirmed; the final serialized desktop/390px/320px matrix passed
without changing that expectation. `PBK_DRAFT_DIAGNOSTICS=1` retains opt-in,
failure-only sample coordinator diagnostics and rethrows the original failure.
Passing reruns do not establish that this separate intermittent condition is fixed.

## Publication Baseline Investigation

The App publication continuation previously reread the shared pointer after the
coordinator released its lock. A peer could publish in that interval, causing the
older tab to adopt the peer's pointer as its own baseline. The next edit could
then overwrite the peer without a conflict. The continuation now requires the
published private envelope's matching baseline. Missing, blocked, stale or
unpublished private provenance fails closed; initial hydration keeps its existing
shared-only fallback. Both local and IndexedDB compare-and-swap guards remain.

Source-backed regressions cover the continuation race and a composition with the
real storage reader when the private copy disappears. These failed before the
fix. This is a confirmed race, not proof of the older active-writer checkpoint's
cause, which remains unconfirmed.

For six fresh WebKit attempts through that checkpoint, stopping on the first
failure rather than retrying it:

```powershell
$env:PBK_DRAFT_DIAGNOSTICS="1"
node scripts/analyzer-draft-recovery-browser-smoke.mjs --stress-publication
```

This focused mode does not replace the unfiltered desktop/390px/320px matrix.
Tracing is a fixture-only Vite transform, opt-in and bounded to sample numeric
fields, result/version metadata and in-memory pointer signatures. No draft
contents, notes, credentials or production storage are exported. Failures retain
the original assertion and timeout. Trace identifiers correlate each publication
with its original expected baseline rather than rereading a changed ref.

Tracing must not add shared-storage reads: extra reads can alter the cache timing
being investigated. The transform now observes already-read local/IndexedDB
comparison values and accepted storage events. An offline regression checks that
enabling tracing adds no `readSharedAnalyzerDraft()` calls to App or storage.
Successful compare events retain their originating publication identifier when
there is exactly one matching active publication.

The follow-up investigation passed six original-trace, six revised-trace and six
untraced fresh WebKit attempts. These are bounded repetitions, not retries of a
failure. Independent review did not establish the obsolete-storage-event theory
in the original scenario. The historical failure's root cause remains unknown;
neither passing repetitions nor instrumentation improvements are a product fix.

## Controlled Publication Timing

A controlled IndexedDB-success boundary reproduced the same `expected 7, received
8` failure: the edit expected pointer 8, the authoritative row held 8, but its
local cache returned the older pointer 4 for exactly that comparison. The cache
caught up immediately afterward; shared state remained 8 and private state kept
unpublished 7. The unchanged five-second assertion failed before the fix.

The coordinator now revalidates once in a new readwrite transaction, inside the
same Web Lock, only for a defined-baseline canonical-match/local-mismatch result.
Both exact pointer checks and cancellation checks run again. It never adopts a
different baseline, forces a publication, retries an exception, or loops. A
lasting mismatch still conflicts, and rollback uses the successful reservation's
previous row. The controlled trace goes from `8/8/4` to `8/8/8`, with exactly one
shared publication. This proves the delayed-cache failure mechanism and its fix;
the historical run had no comparison trace, so its origin cannot be proven.

```powershell
node scripts/analyzer-draft-recovery-browser-smoke.mjs --controlled-publication
```

This runs desktop Chromium and WebKit at 390px/320px, including nine negative
cases and two empty-row initialization cases per viewport. It checks undefined
baselines, canonical changes before/between attempts, permanent local mismatches,
cancellation, second-transaction abort, projection rollback, and intervening
legacy writes. The helper requires the exact isolated fixture origin/path and
sample lead; business mutations remain blocked. Run the unfiltered matrix too
for the original session recovery and overlap scenarios without injected lag.

A subsequent full-matrix attempt stopped on Chromium's first navigation `load`
timeout, before reaching publication; this is distinct from the historical 7/8
failure. Windows had about 184 MiB of free physical memory at an earlier sample,
but that does not prove the timeout's cause. Startup diagnostics now retain DOM
and load milestones plus at most 20 pending local fixture asset paths, without
queries or foreign traffic. The original navigation error is rethrown unchanged.
