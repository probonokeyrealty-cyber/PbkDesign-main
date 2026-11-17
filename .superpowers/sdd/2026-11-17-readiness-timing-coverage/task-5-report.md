# Task 5 Local Implementation Report

Status: NEEDS_CONTEXT for one unowned Task 4 VM-fixture dependency. The owned Task 5 implementation is locally committed and verified. No release or activation.

Implementation commit: `8c32f1314df1d72888a07d05522d345f3d5b1515` (`feat: integrate operational audit v2 readiness proof [skip netlify] [skip render]`).

## Scope And Baseline

- Branch: `codex/readiness-timing-coverage`.
- Starting HEAD: `964213d54b7261c75815674aad5a85a25b069196`.
- Read the exact Task 5 brief, globals, audit-boundaries, Task 1/2/3/4 narrow contracts, and repository operating/design instructions. Did not read the whole parent plan, old reports or session history.
- No child agents or independent reviewers were used, per the explicit task constraint. Review below is self-review.
- Parent plan edits and unrelated `output/` remain untouched and unstaged.
- Used only local Node 22, actual functions, PGlite SQL, and explicit isolated fixture signing material. No environment secret/key files, external services, actual Postgres, providers, server startup, production collection, or activation.

## APIs And Behavior

### Audit Store

- Existing exports `executeOperationalAudit` and `readOperationalAudit` remain the fixed internal execution/read seams. Existing return fields, failure envelopes, fixed eight IDs, CAS finalization and report limits remain.
- New writes: schema `pbk-operational-audit-v2`, suite `operational_audit_v2`, source `server:operational-audit:v2`, derived HMAC domain `pbk.operational-audit.signing-key.v2`. v1 domain is used only to authenticate legacy diagnostics.
- Signed report separates `startedAt` (pre-admission execution start), `observationCutoff` (captured after committed admission), `audit.windowStart/windowEnd` (exact 24h observation interval), and `completedAt` (actual collection completion). Actual current clock is separately supplied to coverage/source operations.
- v2 `audit.coverage` contains `verified`, coverage schema, policy version/hash, instrumentation, segment, cutoff and the compact strict signed `reference`. No full source rows/history/census are persisted in the audit.
- Uses actual `verifyRuntimeCoverageReference({pool,secret,revision,now,reference})` before storing qualifying coverage and on authenticated saved-audit readback. Compares only the strict returned reference canonically, not the dynamic whole proof/census/inventory or source fingerprints.
- Optional internal `coverageVerifier` dependency defaults to that actual export. Test overrides invoke that same durable verifier against an isolated PGlite proof fixture; no Boolean verifier mocks or test-only readiness override exists.
- All latest selections include both v1/v2 suite/source namespaces before any explicit ID comparison, signature/status/revision filtering, and recheck the latest exact row/admission after asynchronous source verification. Invalid, pending and wrong-revision newest attempts block older success. Microsecond admission ordering and the existing cross-version advisory lock namespace remain.
- v1 remains unchanged in storage, authenticated only under `legacy.authenticated/legacy.audit`; top-level qualification remains false with empty evidence.
- Internal `createOperationalAuditPool(pool)` is a cached pool adapter. A private AsyncLocalStorage scope captures the parent monotonic 60000ms deadline at checkout. Acquisition, query, callback and commit continuations check that fence; queries/checkouts are additionally capped at 2000ms. Expiry poisons the scope, aborts waiters, destroys active clients, releases late clients once and prevents subsequent SQL/COMMIT. Outside an audit it preserves the sampler's existing pool/operation behavior. Controlled status remains inherited from the original pool.
- Lifecycle sampler receives that adapter at construction, so its captured pool also inherits an active audit's fence. Task 3/source APIs were not changed or given renewed parent budgets.
- Internal `operationalAuditSourceStatus(sources,kinds)` maps verified source aggregates into existing check statuses. Quiet zero-work windows can pass monitoring; unknown/late-unknown/failed/cancelled/skipped/pending/invalid source states cannot pass. This is not organic business evidence.

### Collector And Bridge

- `collectOperationalAudit` accepts internal `secret`, `revision`, `sampler`, `observationNow` and `fence` dependencies in addition to the existing pool/cutoff/runtime dependencies. No request payload supplies them.
- Fresh collection requires the private sampler, closes only its current pending interval with `sample({cutoff})` (or uses an already exactly closed boundary), then calls `readRuntimeCoverage` at exactly that cutoff with the actual collection clock. Missing/disabled sampler, initial short history, stale/mismatched head and a past gap cannot create a day.
- Preserves all six independent source/security SQL checks and two runtime/continuity checks. Maps `qa` plus `safety` into existing `safety_qa`; no ninth check.
- Plain source labels no longer exclude activity/QA/safety/dead-letter records. Every actual unresolved PBK dead letter and dispatch remains an all-lifetime finding, including forged controlled labels. Existing security/RLS/grant checks remain intact.
- Fixed protected audit HTTP route reuses `getRuntimeCoverageHealth()` (actual Redis mode/isOpen/isReady), passes only internal dependencies and accepts no caller report/reference/cutoff/override. No endpoint, policy setting or activation was added.
- Both fleet read paths obtain v2-required policy BEFORE evidence collection; pass actual `now`, policy, `BRIDGE_API_KEY`, revision and `requireTimingV2:true`; stable measurement receives matching internal timing secret/revision/policy/v2 options. Missing/invalid policy fails closed.
- Maturity adds coverage/source/legacy diagnostics alongside unchanged delivery, memory, canary and approval gates.
- Isolated HTTP smoke source adds denial assertions for coverage/reference/cutoff/v2 override payloads; it is syntax-checked only here, not started.

## Test Fixtures

- Approved shared `scripts/operational-audit-test-fixture.mjs` is imported only by store/coverage tests, never production.
- Uses a bounded isolated PGlite schema, fixed six-digit source projections, actual sampler/source/checkpoint SQL, a complete forward-only 1441-checkpoint day, real domain-separated signatures and actual durable reference reconstruction. Only the trusted DB/wall clock is virtualized; no production history is backfilled.
- Existing audit-row corruption/CAS test double remains, but happy coverage fixtures now use that real durable proof and verifier. Existing denial, tamper, stale, metadata, admission-order and race assertions remain. Label-exclusion expectations were migrated to the required failure assertions, not deleted.
- New coverage tests exercise quiet proof/readback and head advancement, changed census with the same strict saved reference, source failures/tombstones, tampered/missing/forged references, policy/boot/revision bindings, newest v1/v2 admission and explicit IDs, post-verification admission races, original signed v1 diagnostics, actual isolated bridge read functions, parent timeout/late acquisition/callback/coverage continuations and default-off/initial/gap behavior.
- The actual-Postgres audit serialization test remains environment-gated and was not run. Its passing coverage fixture is migrated to genuine isolated proof validation rather than a synthetic Boolean.

## RED/GREEN Evidence

All Jest commands use:

```powershell
Get-ChildItem Env: | Where-Object Name -Match 'DATABASE|^PG|^SUPABASE|^NEON|^PBK_.*(DB|SQL|EVAL)' | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand <arguments below>
```

This enumerates/removes DB environment variable names without reading/printing their values. No `.env` load or key lookup was performed.

1. Initial RED: `--runTestsByPath scripts/operational-audit-collector.test.mjs scripts/operational-audit-coverage.test.mjs`.
   Result: 2 suites failed; 9 failed, 33 passed. Expected missing behaviors included hidden controlled-label QA/dead-letter failures, explicit-ID fallback around newer legacy admission, missing durable v2 coverage integration and unbounded checkout. The new checkout test timed out on the original unbounded implementation.
2. First integration run: store/collector/coverage. Result: 2 suites passed, 1 failed; 116 passed, 2 failed, 1 skipped. Remaining failures were coverage fixture observation chronology; corrected using actual forward observations and a new sample, not proof rewriting.
3. Clock RED: `--runTestsByPath scripts/operational-audit-store.test.mjs --testNamePattern 'admission time, observation cutoff' --testTimeout=30000`.
   Result: 1 failed, 77 skipped; missing signed `observationCutoff`. Implemented post-admission cutoff and separate actual collection clock.
4. Expanded integration run: collector/store/coverage, agent-latency-v2, agent-fleet-bridge-evidence, agent-registry-readiness, readiness-timing-coverage-wiring; `--testTimeout=30000`.
   Result: 296 passed, 4 failed, 1 skipped. Failures: legacy cross-realm JSON comparison (fixed via canonical JSON), dependent race after failed cleanup, old v2 lock-domain fixture expectation (updated to retained cross-version v1 lock), and the unowned Task 4 lifecycle VM missing the new internal pool-adapter dependency.
5. Default-off RED: `--runTestsByPath scripts/operational-audit-coverage.test.mjs --testNamePattern 'without the private sampler' --testTimeout=30000`.
   Result: 1 failed, 15 skipped. Existing head was incorrectly borrowable without the sampler. Fresh collector now requires the private sampler.
6. Owned regression run before default-off fix was loaded: 5 suites passed, 1 failed; 242 passed, 1 failed, 1 skipped. The only failure was the newly added missing-private-sampler test (the running test module predated its fix).
7. Final six-suite GREEN: **6 passed; 243 passed, 1 skipped, 244 total; exit 0**, 376.967 seconds. Exact arguments:

```text
--testTimeout=30000 --runTestsByPath scripts/operational-audit-collector.test.mjs scripts/operational-audit-store.test.mjs scripts/operational-audit-coverage.test.mjs scripts/agent-latency-v2.test.mjs scripts/agent-fleet-bridge-evidence.test.mjs scripts/agent-registry-readiness.test.mjs
```

The expanded run in item 4 used the identical list plus `scripts/readiness-timing-coverage-wiring.test.mjs`. The initial integration run in item 2 used only the first three paths. Normal Node experimental-VM warning was present; it was not a test failure.

8. Additional coverage hardening (three cases added after the six-suite process loaded its test file): `--testTimeout=30000 --runTestsByPath scripts/operational-audit-coverage.test.mjs` initially returned 17 passed, 2 failed. The real sampler reached the DB-clock query before the fixture's intended stall. The standalone source-timeout fixture also reused the live fixture signing namespace and correctly created storage-debt denial there. Fixed only the test transport stall and explicit signing-namespace isolation; no production bypass/reset was added. The boot test respects the active lease, verifies `coverage_lease_busy`, then advances past its actual expiry before the real new-boot sample.
9. Final current coverage GREEN, same exact command as item 8: **1 suite passed; 19 passed, 19 total; exit 0**, 160.912 seconds. Includes real sampler/source parent-expiry continuations, actual-started-SQL assertions, and genuine new-boot/current-control invalidation.

Unique focused tests verified across items 7 and 9: **246 passed, 1 skipped**. The earlier 16 coverage cases in item 7 are also included in the final 19-case run; they are not double-counted here.

## Lint And Syntax

- Owned audit modules/tests/fixture/smoke: `node22 node_modules/eslint/bin/eslint.js <seven owned audit .mjs paths> --max-warnings=0` returned exit 0, no output.
- Bridge `node22 --check scripts/openclaw-local-server.mjs`: exit 0, no startup.
- Whole bridge ESLint `--quiet`: 12 errors. Baseline check `git show 964213d54b7261c75815674aad5a85a25b069196:scripts/openclaw-local-server.mjs | node22 node_modules/eslint/bin/eslint.js --stdin --stdin-filename scripts/openclaw-local-server.mjs --quiet` has the SAME 12 errors/rules; only line offsets differ. No unrelated lint fixes were made. Existing categories: no-control-regex, no-ex-assign, no-useless-escape, no-empty, no-extra-boolean-cast.
- ESLint API comparison of each changed bridge function and the fixed audit route against the base: exit 0, zero new diagnostics. Exact output: production readiness 0 current/0 baseline, orchestration 0/0, lifecycle start 0/0, fixed audit route 0/0; maturity 1/1 unchanged unused `runtimeMeta` parameter warning. No warning suppression or unrelated parameter rename was added.
- Final owned lint: all seven audit module/test/fixture/smoke paths above, `--max-warnings=0`, exit 0 with no output.
- Final syntax loop: `node22 --check` for those seven paths plus `scripts/openclaw-local-server.mjs`, exit 0, `8 owned files: syntax OK; no startup`.
- `git diff --check`: exit 0; only existing Git LF/CRLF notices, no whitespace errors.

Exact final owned lint command:

```powershell
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' node_modules/eslint/bin/eslint.js scripts/operational-audit-store.mjs scripts/operational-audit-collector.mjs scripts/operational-audit-store.test.mjs scripts/operational-audit-collector.test.mjs scripts/operational-audit-coverage.test.mjs scripts/operational-audit-test-fixture.mjs scripts/operational-audit-bridge-smoke.mjs --max-warnings=0
```

Result: exit 0, no lint output. The eight-file syntax loop used precisely those seven paths plus the bridge, executing `node22 --check` separately on each path without loading it.

## Self-Review And Concerns

- Reviewed namespace/domain separation, exact reference/window binding, eight-ID preservation, quiet-vs-business distinction, all-lifetime findings, source gap/history/revision delegation, pending CAS, explicit-ID latest enforcement and post-async recheck.
- Reviewed parent scope propagation through the sampler's captured pool and destructive release/late checkout behavior. As with the existing Task 3 contract, already-enqueued COMMIT acknowledgement ambiguity is not claimed to be a guaranteed server rollback; qualification stays fail-closed.
- No auth/passcode/role/approval/provider/call/SMS/retry/memory/backfill behavior was edited. No unknown dispatch was unlocked and no dead letter was resolved.
- Task 6 owns full unit, actual-Postgres integration and isolated server smokes. They were not run here. No hosted/runtime route or server was called/started.
- Narrow outstanding ownership dependency: `scripts/readiness-timing-coverage-wiring.test.mjs` lifecycle VM must bind the real `createOperationalAuditPool` export. Its ready startup case otherwise catches ReferenceError before sampler construction (expected created=1, received 0). No assertion needs removal. Requested authorization for only that test import/binding; file remains untouched pending clarification.
- Final self-review found no additional owned-path issue. Verified the shared helper has exactly two imports, both test-only (`operational-audit-store.test.mjs` and `operational-audit-coverage.test.mjs`). Final staged diff check was clean; implementation commit contains exactly the eight owned script paths. Post-commit status contained only the original parent plan modification and unrelated untracked `output/`.

## Narrow Context Needed

Do not change a production API or readiness gate to accommodate this fixture. The existing Task 4 VM executes `startRuntimeCoverageIfReady` in a deliberately isolated context. Its context currently supplies `createRuntimeCoverageSampler` but not the newly used `createOperationalAuditPool` dependency. The real bridge imports the actual function correctly; the VM catches its missing binding before constructing the sampler.

Evidence: `scripts/readiness-timing-coverage-wiring.test.mjs`, test `actual lifecycle startup gates ready without evidence writes outside admitted startup`, assertion at line 294: expected `created === 1`, received 0. The other cases in that file passed in the expanded run. No assertion should be removed or weakened.

Requested narrow ownership authorization: add an import of the real `createOperationalAuditPool` from `operational-audit-store.mjs` and bind that actual function into this lifecycle VM context. Then run this focused test file and commit only that small fixture edit. The file has not been changed because it is outside the currently assigned owned paths. The request was made in commentary; no approval was received in this turn.

No other dependency API change is needed. Task 6's full-unit/actual-PG/server-smoke work and the pre-existing whole-bridge lint errors remain separately deferred as stated above.
