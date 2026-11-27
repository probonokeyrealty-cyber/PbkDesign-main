# Bridge Safety Smoke Startup Fix

Date: 2026-11-26. Local checkout:
`D:/pbk-temp/operator-session-regressions-20261126`.

## Cause And Evidence

The approval safety smoke reproducibly hit its existing 15-second startup deadline
before any bridge stderr appeared. A temporary import trace, inside the existing
permission and network guard, showed 1,557 modules loaded even though the smoke
explicitly disables Redis. Both the bridge and event bus imported the entire
Redis SDK eagerly, including optional search/time-series command modules. One
diagnostic startup took 52.5 seconds; a detailed trace took 23.5 seconds, with
15.9 seconds spent in synchronous module loads and 3.4 seconds in resolution.
Several of the slowest loads were optional Redis command files. These are local
observations, not a production performance benchmark.

## Narrow Fix

- Add `scripts/redis-client.mjs`, a synchronous, cached factory using Node's
  `createRequire` to load the existing Redis SDK only when a client is requested.
- Route the bridge and event bus's existing factories through that helper.
  Disabled/memory modes no longer load Redis. Enabled-mode options, factory return
  type, connection races, timeouts, cooldowns and approval guards remain unchanged.
- Package the helper in `Dockerfile.openclaw`; the existing packaging check first
  failed for the missing file, then passed with that copy line.
- Add five regression tests to the existing `test:bridge-isolation` lane,
  including a full guarded bridge whose loader rejects any attempt to import
  disabled Redis. The temporary timing trace was removed after investigation.

The detailed post-fix trace loaded 976 modules and started in 3.2 seconds. The
full guarded regression started and answered health in 3.9-7.8 seconds across reruns. The
15-second startup deadline, request deadlines and all isolation permissions are
unchanged; no timeout was increased to make the test pass.

## Verification

- `node scripts/approval-action-safety-smoke.mjs`: passed twice after the fix,
  with isolated fictional records and no provider writes.
- `node --test scripts/redis-client-loading.node-test.mjs scripts/bridge-smoke-isolation-smoke.mjs`:
  all 15 tests passed. Repeated through `npm run test:bridge-isolation` after wiring.
- `node scripts/redis-recovery-smoke.mjs`: passed.
- `node scripts/redis-command-deadline-smoke.mjs`: passed, including all 13 bounded
  command methods, ambiguous writes not retried, leases, cache fallback and races.
- `node scripts/event-bus-smoke.mjs`: passed.
- Actual installed Redis factory constructed an unopened client while socket
  connections were blocked, verifying CommonJS compatibility without connecting.
- `npm run test:render-docker-imports`: passed (209 imports, 139 files).
- `git diff --check`: clean.

Loader tests first failed on the eager SDK import, then passed with the helper.
They also verify option forwarding, one SDK load, synchronous client return and
propagated load failures rather than a false healthy fallback. Isolation tests
still cover filesystem/network/subprocess restrictions, timeout cleanup,
interrupts, caller cancellation and stale-port authority.

## Safety And Privacy

No production runtime, lead record, original draft, note or comp was edited.
Only disposable local bridge fixtures handled test mutations; no real calls or
messages were placed. The original C: worktree was not edited. Changes remain
local, uncommitted and unpushed. No Docker image was built or deployed. The full
Founder suite was not run.

A final privacy check separately found anonymous production returning 200.
The signed-in Netlify dashboard confirmed Production Public / Deploy Preview
Private. Netlify MCP required reauthentication and BrowserOS was disconnected,
so regular Chrome was used to restore **Private / Production and previews** on
`pbkcenter` only. The dashboard then showed Private for both scopes and anonymous
GETs of `/`, `/leads` and `/settings` each returned 401. Demo/investor sites,
team defaults and deployment controls were not changed. This restores current
protection; it does not establish what caused the recurring scope changes.

## Separate-Branch PR Preparation

The founder subsequently authorized committing and pushing the workflow polish,
startup fix and tests to a separate branch and opening a draft PR, without merge
or deployment. The release branch is
`codex/workflow-polish-bridge-startup-20261126`, rebased onto main `09fb963` so the
newer Ava navigation and County Data CSV changes remain intact.

The existing bridge-logic fingerprint is unchanged: only the reviewed Redis
factory import is canonicalized before hashing. The new workflow copy and
sample-only browser tests run in the existing Command Center Polish Verify job.

A concurrent test run exposed two pre-existing fixture assumptions. Cleanup
assertions now use a suite-owned temp parent rather than counting unrelated
system-temp roots. The expired-authority test proves expiry rejects requests,
then awaits the owned child's shutdown before rebinding its port. No runtime
permissions or deadlines changed. All 15 isolation tests then passed together.

On the rebased tree, build, typecheck, lint, Docker import packaging, 21 canary
tests, 12 workflow/polish contracts, approval safety smoke and both sample-only
browser matrices passed. Desktop Chromium and mobile Chromium/WebKit were
verified, including 320px labels, approval cancellation/preflight and unchanged
sample drafts, notes, repairs and comps. QA output is excluded from the commit.

An additional full-unit run was deliberately stopped before rebasing during the
long operational-audit database fixture; seven completed suites had 633 passing
tests, but the full suite did not complete and is not claimed as passing.
The draft PR must retain that limitation pending CI. The narrower canary suite
was rerun successfully after the rebase. Commit/PR titles carry Netlify, Render
and preview skip markers; no auto-merge labels or reviewers are requested.
