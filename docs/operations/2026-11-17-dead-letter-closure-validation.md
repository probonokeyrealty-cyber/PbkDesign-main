# Dead-Letter Closure Local Validation

Validation performed on 2026-11-18 on local branch `codex/dead-letter-closure`, Task 7
base `0e79b24`. This document contains aggregate evidence only. It does not authorize
release, production schema changes, live closures, provider actions or delivery.
Independent task/full-branch reviews remain controller-owned.

## Final Consolidated Verification (2026-11-18)

After the reviewed source changes and the canary digest-only correction, the
controller ran the complete unfiltered unit command again on the unchanged
runtime/test tree at `83d4b5d`:

```text
npm run test:unit -- --json --outputFile=.superpowers/sdd/2026-11-17-dead-letter-closure/final-consolidated-unit-results.json
```

Pinned Node 22 PATH and process-only ambient DB/native opt-in scrubbing were retained.
Command completed exit 0: 99/99 suites passed; 3,002 tests passed, 12 existing opt-in
skips, 0 failures; 3,014 total; 2,222.773s. JSON `success:true`, failed suites 0 and
failed assertions 0 were read independently after command completion. Run start:
2026-11-18T14:09:14.223Z; last suite end: 2026-11-18T14:46:16.991Z.
Raw result SHA256:
`0abd607d59823632e16d0fe572ad0ab53fa739cd9af9d15b63f7dd0d94142a0f`.

No runtime, test, package, Docker or proxy source changed during or after this run;
subsequent handoff edits are documentation only. All command sessions completed;
a fresh exact task-label Docker query returned no leftover test containers.
The 12 skips are the existing inventory retained below, not native passes.
The latest dedicated guarded local closure Postgres run separately passed 15/15,
with actual creation-service concurrency and zero external/sender attempts.

Independent final re-review accepted all four introduced findings with no new
breakage. The [review outcome](2026-11-18-dead-letter-closure-review-outcome.md)
retains every declined-judgment boundary. The inherited nonclosure callback-role
parity P1 remains unresolved and release-blocking. No push, integration, production
migration/deployment, live closure, seller contact, retry or dispatch unlock occurred.
Historical failed/partial runs below are preserved, not replaced by this pass.

## Final Review Fix Wave (2026-11-18)

Whole-branch review at `3b772f4` identified four introduced compatibility,
acknowledgement, proposal-idempotency and diagnostic findings. One coherent local
fix wave addresses findings1,2,4,5 with test-first evidence. Source IDs now accept
the upstream opaque256 contract and provider aliases retain240; nonpending
closure callback mismatches return409; exact durable pending proposals are reused
under a bounded per-case database transaction through the existing creation service;
preview exposes fixed proof reasons outside the unchanged frozen audit reference.
No schema, auth settings, producer, provider retry/lease or UI changes were made.

Focused amended-tree verification passed205/205 across six suites (71.741s):
evidence89,store53,approval9,wiring37,protocol7,audit-v3 10. Two later boundary tests
also passed individually (expired/ambiguous pending authority; canonical callback
identity/intent mismatch). Name-filtered iterations are not full-suite evidence.
The guarded local native command passed15/15,zero skips (8557.2711ms), including
two concurrent creation-service requests returning one durable pending ID with
exactly one insert/queue/fanout. Existing real pgvector, replica, max1, source/
approval/ledger races and snapshot-cutoff proofs also passed. Four expected losing
race SQLSTATE40001 diagnostics occurred; zero external connections/provider sender
attempts. Owned container removal and generated database drop were confirmed.

ONE full amended-runtime `npm run test:unit` completed under Node22.23.5 with
ambient database URLs/native opt-ins removed: exit1,98 suites passed/1 failed,
3001 tests passed/1 failed/12 existing native opt-in skips,1509.904s. Source was
unchanged throughout. The sole failure was the exact non-maturity bridge source
digest in `canary-evidence-wiring.test.mjs`: it still pinned the pre-wave approval
surface. After inspecting the entire scoped bridge diff, only that test's digest
and comment were updated; its full covering suite passed21/21 (2.061s), including
all existing canary/maturity behavior checks. No runtime edit followed the full run.
This is NOT a claim that the full command passed. Earlier99/99 evidence below is
historical, not post-fix full-green evidence. The12 skips remain remote/native
opt-in bodies, not passes; dedicated closure-native15/15 is separate proof.

Fresh isolated closure, reconciliation, audit and hosted-compatibility smokes all
passed. Typecheck, zero-warning lint, packaged imports (192 imports/121 files),
build (1844 modules,14.29s), and packaging/cleanup guards19/19 all passed. No UI
changes or mobile/BrowserOS visual-verification claim. Details, exact commands,
RED/GREEN iterations, skipped test names and source fingerprints are retained in
the ignored local `final-fix-report.md` under the dead-letter-closure scratch path.

**Inherited P1 release blocker:** nonclosure raw approval callbacks still lack
canonical decision-role parity. This is unchanged and NOT certified safe; separate
security-owner disposition/resolution and transport-parity tests are required
before broad runtime safety/release certification. Closure-specific protection and
passing local tests do not clear this high-priority inherited security risk.

Production installation, live eligibility/delivery, owner/signing-authority trust,
clock synchronization and all other declined-to-judge boundaries remain explicit.
No push, PR, deployment, production migration or live closure is authorized.

## Environment And Isolation

- Test scripts use pinned Node 22.23.5 first in PATH.
- Full Jest run has ambient database URLs and remote/native opt-ins removed.
- Docker context `desktop-linux`, endpoint
  `npipe:////./pipe/dockerDesktopLinuxEngine`, engine 29.4.0 revalidated.
- Existing image `pgvector/pgvector:0.8.7-pg17` verified and used by digest
  `sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd`.
- Each native run used only its own labelled auto-removed container, tmpfs data,
  literal `127.0.0.1` publication, random empty `pbk_closure_test_<hex32>` database and
  nonsuperuser/non-BYPASSRLS owner. No remote Render/Neon database was used.
- Temporary passwords were process/child-env only, not CLI args/files/reports.
  The bootstrap container env was removed with the container. No inspect/log dump.
- Final cleanup confirmed generated database dropped, owned container removed,
  all native clients/pools closed, no unrelated resource touched. No prune/reset.

## Completed Checks

| Command                                                                                                             | Aggregate Result                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run test:dead-letter-closure-postgres` with explicit local opt-in                                              | 14/14, zero skips; final repeat 11.401s                                                   |
| `npm run test:dead-letter-closure`                                                                                  | 5 Node guard/packaging tests and 239 Jest tests across 6 suites, zero skips; Jest 78.718s |
| `npm run test:dead-letter-closure-bridge`                                                                           | Pass, isolated bridge; no provider/contact/source writes                                  |
| `npm run test:backlog-reconciliation-bridge`                                                                        | Pass, isolated bridge                                                                     |
| `npm run test:operational-audit-bridge`                                                                             | Pass, isolated bridge                                                                     |
| `npm run test:provider-action-dispatch`                                                                             | 7 passed, 1 existing remote-native test skipped                                           |
| `npm run test:render-docker-imports`                                                                                | Pass; 191 imports, 121 files, 2 frontend voice inputs                                     |
| `npm run typecheck`                                                                                                 | Pass                                                                                      |
| `npm run lint`                                                                                                      | Pass, zero warnings                                                                       |
| `npm run build`                                                                                                     | Pass; 1844 modules, 34.43s; no generated tracked changes                                  |
| `npm run test:unit -- --json --outputFile=.superpowers/sdd/2026-11-17-dead-letter-closure/task-7-unit-results.json` | Exit 0; 99/99 suites, 2983 passed, 12 skipped, 0 failed; 2398.995s                        |
| `git diff --check`                                                                                                  | Pass; Windows LF/CRLF notices only                                                        |

The first full unit run was interrupted by a tool/runtime transition after the
audit-coverage suite passed 22/22; no final result artifact survived. That partial
result was not counted as a full pass. One full unfiltered restart completed from
2026-11-18 11:45:20.737 UTC through 12:25:19.710 UTC, with no source edits during
execution. All 99 suites include the requested memory/audit/canary/approval/proxy
regressions. No duration reduction, sampler shortcut, signature bypass, timeout
increase, name/path filter or force-exit was used; no `.only` tests were present.

Retained slow fixtures passed: audit coverage 22 (610.273s), paged coverage
integration 2 (457.059s; 1441 checkpoints), audit store 77 (289.256s), runtime
coverage store 27 (150.954s), census scale 1 (180.807s; 112693 retained rows),
readiness Postgres fixtures 8 (224.036s), census schema 91 (84.123s), and paged
census 32 (56.872s). Fixture console.info aggregates are expected diagnostic
evidence, not application errors or real operational history.

The complete JSON remains ignored local evidence, not a release artifact. SHA256:
`69334f7c94ae4c499bfa9f03985e591fa28aec8ada2e95511f6d90762a10ebd5`.

## Native Evidence

The actual extension column was `public.vector(1536)` with real wire roundtrip,
not JSONB/text-only embedding evidence. Empty DB/connected identity/least privilege
were verified before migration and fixture creation; vector extension bootstrap
occurred only after the ledger migration, inside that owned disposable container.
Production migration does not create roles or install vector.

Native proof covers exact installation and repeat installation verification;
normal and replica UPDATE/DELETE/TRUNCATE rejection; exact RLS/trigger/column ACL/
constraint/column drift detection; native pg.Result and independent max1 readback;
single-use replay; two-client source and canonical approval races; same/different
intent predecessor concurrency; and newly-approved revoke after QA/memory loss.
Expected losing races returned SQLSTATE40001, without retries or extra appends.

The held writer reached COMMIT with a real allocated xid and earlier receipt time,
then another max1 pool captured a real pg_snapshot and cutoff before commit was
released. The newest receipt was selected but invalidated by visibility; no older
good-head fallback or timestamp-only credit. Independent frozen-reference readback
retained zero historical credit while a current unfrozen read could still close.

Source/dispatch fingerprints and all earlier receipt prefixes remained unchanged;
all six unknown dispatch fixture rows stayed locked. A deliberately removed fixture
original denied a usable ledger summary. The native network observer recorded zero
external connections and zero HTTP/provider sender accesses. Throwing sender stubs
and the isolated bridge harness prevented contact, leases and retries.

## Failures, Skips And Limits

Packaging TDD first failed on missing runtime imports/scripts, then passed after
adding five runtime modules, the fixed SQL asset and scripts. A later focused-script
typo referenced a nonexistent bridge test;206 tests passed but that command failed
one suite. A new wiring-name/existence regression failed before correction; final
focused command passed239/239. No startup migration runner/workflow was added.

Native iteration first failed on a test observer Socket.connect overload, corrected
without product edits. A diagnostic Pool.connect override broke callback consumers,
causing connection timeouts and a cancelled120s native parent; only its verified
owned worker was stopped and wrapper cleanup completed. The final diagnostic uses
the connect event, preserving native Pool callbacks. The wrapper uses nonisolated
Node test execution to avoid orphaning nested test workers on its hard deadline.

Other native attempts failed strict receipt signing when the Docker DB clock was
7 ms ahead of Windows completion time. This was traced, not hidden by a passing
rerun. Runtime guards/signatures were NOT relaxed. Positive native fixtures buffer
unchanged timestamp responses until host time catches up, capped at 100 ms within
the original 2s query budget. Negative completion-clock proof refuses without an
append. Earlier passing native runs required zero buffering (maximum lead 0 ms).
Latest final native run buffered 4 real responses, maximum DB lead 16 ms, within
the 100 ms fixture cap. Clock synchronization remains a deployment availability
prerequisite; the buffering is not part of production code.

Initial closure bridge smoke timed out at its existing 60s startup deadline with
no stderr. An unchanged retry passed; timeout/startup behavior was not widened.
Provider suite skipped "Postgres advisory locks serialize provider execution across
separate pools" because remote DB opt-ins were absent; this does not invalidate or
substitute for the separate local closure native concurrency proof.

The full unit run's 12 skipped tests are existing `PBK_TEST_DATABASE_URL`-gated
Postgres integrations; that opt-in was deliberately absent. Exact inventory:

- `operational-audit-store.test.mjs`: disposable Postgres operational JSONB proof, tampering and latest failed attempt.
- `backlog-reconciliation-store.test.mjs`: disposable Postgres JSONB/CAS, pool one, tampering and pending latest.
- `backlog-reconciliation-integration.test.mjs`: disposable Postgres binds real source/QA/memory evidence without mutating source rows.
- `conversation-store.test.mjs`: conversation schema Postgres integration applies twice with RLS enabled and rolls back all test changes.
- `conversation-store.test.mjs`: conversation store Postgres integration serializes concurrent provider sync and operator patch without reviving the sender.
- `conversation-store.test.mjs`: conversation store Postgres integration preserves retired sender state and metadata on sparse inventory upsert.
- `conversation-store.test.mjs`: conversation store Postgres integration repairs both thread aggregates when a source event is reassigned.
- `conversation-store.test.mjs`: conversation store Postgres integration enforces lead-bound canonical ownership and differing-lead rejection.
- `conversation-store.test.mjs`: conversation store Postgres integration converges concurrent lead and identity resolution onto one canonical thread.
- `conversation-store.test.mjs`: conversation store Postgres integration serializes explicit merge with lead resolution for an attached identity.
- `release-qualification.test.mjs`: disposable Postgres commits signed proof and rejects JSONB tampering after independent readback.
- `provider-action-dispatch.test.mjs`: Postgres advisory locks serialize provider execution across separate pools.

These are not zero-skip or native conversation/provider-delivery claims. The
separate guarded local closure-native proof passed 14/14 with zero skips.

Only expected Node ExperimentalWarning for VM Modules and fixture info diagnostics
were seen in passing Jest runs. No full Docker runtime image build,
remote/production smoke, hosted migration,
production qualification, BrowserOS/mobile UI proof or live provider delivery is
claimed. No UI changed. Trusted owner/superuser DDL remains outside immutability's
boundary. Release authorization and controller reviews are still required.

The packaged verifier SQL asset SHA256 is
`efb4896662b5bb4375968d5b0f36228c3818545bf202a3bd1a49b0a9ae096572`.
This checksum is evidence, not permission to apply it anywhere.

## Supplemental Cleanup Review Fix

Independent Task7 review found that a lost Docker run acknowledgement could leave
the test's own container running. Commit `4c06153` preserves the exact owner/name
handle before creation and reconciles only a fully verified owned resource.
The wrapper and packaging Node tests passed19/19 with zero skips, covering both
ambiguous creation and refusal to stop unverifiable or unrelated resources.
Scoped re-review found the issue addressed with no new breakage.

Only the test wrapper and its Node tests changed. The99-suite Jest run and native
14/14 results above were not rerun or represented as fresh post-fix native proof.
Runtime code, migration SQL, query/collection limits and approval settings did not
change in this fix. Whole-branch review and separate release approval remain open.

The original schema-stage evidence is retained in the
[historical schema checkpoint](2026-11-17-dead-letter-closure-schema-checkpoint.md).
