# Dead-Letter Closure Local Validation

Validation performed on 2026-11-18 on local branch `codex/dead-letter-closure`, Task 7
base `0e79b24`. This document contains aggregate evidence only. It does not authorize
release, production schema changes, live closures, provider actions or delivery.
Independent task/full-branch reviews remain controller-owned.

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
