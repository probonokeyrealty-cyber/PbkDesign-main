# Trusted Canary Local Validation: 2026-11-17

## Scope And Ownership

Task 4 starts at `8a6880e2885c643c82128bd919041c42a0615d02` on
`codex/trusted-canary-evidence`. Changes are the guarded Postgres node-test, one
additional Release Qualification step, the receipt operations contract and this
validation record. No production reader, protocol, bridge, auth, approval, contact,
retry, dispatch, policy or Docker runtime implementation changed in Task 4.

The extracted Task 4 brief was read first, followed by the common contract,
controller I1 handoff, repository instructions/design references, relevant existing
guard/harness/tests and the approved design spec. The whole plan was not read.
Controller-owned plan bookkeeping and user-owned `output/` remain unstaged and
untouched. No subagents/reviewers were spawned: controller owns independent task
and whole-branch review after this report. Scratch handoff reports are not force-added.

## Environment And TDD

Commands ran in the named Windows worktree, using this process-local PATH prefix:

```powershell
$env:PATH='D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin;' + $env:PATH
```

Executable: `D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`,
Node `v22.23.5`. No persistent environment/git configuration changed. The parent
has authenticated Neon API/project keys but no runtime database URL. The harness
scrubs `PBK_DATABASE_URL`, `DATABASE_URL`, `SUPABASE_DB_URL` and
`PBK_MIGRATION_DATABASE_URL`; it injects test/eval URLs into the guarded child and
those are **not** cleared. `PBK_NEON_API_KEY` preserves authenticated guard authority
because the existing harness clears the `NEON_API_KEY` child alias.

Tests were added before the workflow addition. Existing reader implementation was
not changed merely to manufacture a RED result. Exact CI-contract command:

```powershell
node --test --test-name-pattern='Release Qualification' scripts/canary-evidence-postgres.node-test.mjs
```

Before addition: exit 1, **0 passed / 1 failed / 0 skipped**, expected assertion
`one additional guarded canary step is required` (`0 !== 1`), 610.0217 ms.
After addition: exit 0, **1 passed / 0 failed / 0 skipped**, 389.9879 ms.
This name-filtered offline contract test is not actual database proof. Actual
Postgres runs use the entire file without filtering or optional skips.

First actual-Postgres execution passed all **18/18** tests on its first attempt,
zero failed/cancelled/skipped/todo, 28,458.5682 ms. This honestly proves already
implemented reader behavior, not a fabricated failing implementation cycle.
After stronger cumulative-budget and additional precision/metric assertions, the
final result is recorded below.

Final actual-Postgres execution: exit 0, **20/20 tests passed**, zero
failed/cancelled/skipped/todo, 38,145.5831 ms (18 database subtests plus their
parent test and the workflow-contract test). All actual-DB assertions passed on
first execution of each version; there was no reader defect or implementation RED.

## Actual PostgreSQL Command And Cleanup

The existing harness was used unchanged. The wrapper below only suppresses its
connection-summary line, captures branch identity in memory and independently
verifies deletion. It does not create another harness, reset inherited schemas,
rewrite reader SQL, substitute rows or change guards/limits.

```powershell
@'
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
for (const key of ['PBK_DATABASE_URL','DATABASE_URL','SUPABASE_DB_URL','PBK_MIGRATION_DATABASE_URL']) assert(!process.env[key], 'runtime URL must be absent');
const env = {...process.env, PBK_NEON_API_KEY: process.env.PBK_NEON_API_KEY || process.env.NEON_API_KEY};
const name = `pbk-eval-targeted-readiness-canary-${randomUUID()}`;
let id, pending='';
const child = spawn(process.execPath, ['scripts/neon-evaluation-harness.mjs','--ttl-hours','1','--branch-name',name,'--','node','--test','scripts/canary-evidence-postgres.node-test.mjs'], {env, windowsHide:true, stdio:['ignore','pipe','pipe']});
child.stdout.on('data', chunk => { pending += chunk; let end; while ((end=pending.indexOf('\n'))>=0) { const line=pending.slice(0,end); pending=pending.slice(end+1); if (line.startsWith('[pbk-neon-eval] created ')) { id=line.match(/\((br-[a-z0-9-]+)\)/)?.[1]; console.log('[harness] created disposable TTL1h branch; connection omitted'); } else console.log(line); } });
child.stderr.on('data', chunk => process.stderr.write(chunk));
const code = await new Promise(resolve => child.on('close', resolve));
assert(id, 'harness branch identity captured without URI output');
const project = env.NEON_PROJECT_ID || env.PBK_NEON_PROJECT_ID;
const response = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(project)}/branches/${encodeURIComponent(id)}`, {redirect:'error', headers:{Authorization:`Bearer ${env.NEON_API_KEY || env.PBK_NEON_API_KEY}`}, signal:AbortSignal.timeout(10000)});
assert.equal(response.status,404,'independent branch GET after harness cleanup');
console.log('[cleanup] independent authenticated branch GET = 404');
process.exitCode = code;
'@ | node --input-type=module
```

Each run uses a fresh UUID branch with prefix `pbk-eval-targeted-readiness-canary-`
and TTL 1 hour. The existing guard authenticates fresh nondefault/nonprotected
branch/endpoint identity. Each creates a unique, initially empty
`pbk_canary_<32-hex>` database, only the existing receipt-table shape and synthetic
signed receipts under a random test-only secret. No production migration or
inherited-schema reset occurs. Multi-MiB tests use the unindexed source column,
not a giant primary key that could exceed PostgreSQL index-entry limits.

First run cleanup receipt:

- Branch `br-wandering-term-ajd30kl1`, unique suffix
  `042179e9-759d-4a78-b864-d4af96432c4e`.
- Inherited `approvals`, `provider_action_dispatches`, `event_dead_letters`, `calls`
  fingerprints matched before/after (no contents or hashes printed).
- Generated DB dropped and independently checked absent in `pg_database`.
- Harness DELETE completed; independent authenticated branch GET returned **404**.
- No URI or secret printed. No cleanup failure.

Final run cleanup receipt:

- Branch `br-blue-resonance-aj3hjvr6`, unique suffix
  `6847b774-50b6-46d0-b48c-152a0648f649`.
- Inherited protected fingerprints matched; generated DB was dropped and
  independently catalog-verified absent.
- Harness DELETE completed; independent authenticated branch GET returned **404**.
- No URI or secret printed. No cleanup failure. No disposable branch left behind.

## Proof Coverage

- Unmodified actual reader SQL: signed controlled chain, complete physical digest
  readback, two repeatable-read/read-only transactions and numeric p95 recomputation.
- Missing producer returns empty proof, without generating receipts.
- Positive nonzero microseconds and actual one-microsecond physical comparison /
  observation mismatches; no Date truncation.
- Other-tenant, deleted and tampered observation dependencies cannot satisfy membership.
- Newest invalid signature, pending, different revision and damaged suite admissions
  hide the older passing chain; selection uses reserved suite OR source.
- Independent second snapshot detects dependency change and new admission after
  first rollback, returning superseded rather than stale first-snapshot proof.
- Authenticated error/fallback samples remain verified and in denominators; no
  passing-readiness or delivery claim is inferred from verification.
- I1 actual SQL: multi-MiB unindexed source withheld in a capped size-only envelope.
- I1 actual SQL: collectively oversized dependency batch, individually fitting
  physical fields, denied against **remaining cumulative** bytes before transfer.
  The strengthened batch is below a fresh 2 MiB cap, distinguishing cumulative
  accounting from a per-query cap.
- I1 actual SQL: exact `row_to_json` escaping/JSONB whitespace measurement, int4
  numeric size returns (OID 23, not bigint strings), JSON OID 114, exact byte-boundary
  acceptance and one-byte-short denial with `physical: null`.
- Every ordinary read checks all receipt-row fingerprints unchanged; actual
  transaction settings are read-only/repeatable-read; reader statements are
  allowlisted read/rollback SQL and query deadlines remain at most 2 seconds.

## Focused Regression

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/canary-evidence-protocol.test.mjs scripts/canary-evidence-reader.test.mjs scripts/canary-evidence-wiring.test.mjs scripts/production-readiness-evidence.test.mjs scripts/release-qualification-ci.test.mjs
```

Exit 0: **5/5 suites, 536/536 tests, zero failures/skips**, 18.958 seconds. Includes
behavioral wiring and the actual original six-suite CI report assertions, including
negative skipped/failed/empty/wrong-suite cases. The new step is separate; the
original six-suite command/assertion block is unchanged.

Only the exact Node VM Modules experimental warning and standard trace-warnings
hint occurred. No warning suppression was used. The operations contract documents
narrow classification and a reviewable procedure for refreshing Task 3's broad
whole-bridge safety hash; neither hash nor runtime code was changed in Task 4.

## Controller-Owned Receipts

These were supplied by the controller/Task 3, not rerun or added to Task 4 counts:

- At `75d3746`: typecheck, production build (1,844 modules, 20.48 seconds, no
  warnings), MCP passed; core Jest 3 suites / 420 tests passed; CI hardening 6/6;
  release alignment passed. Concurrent bridge/launch startup timeouts were recorded,
  followed by serial isolated openclaw and launch-safety passes without deadline
  changes. They are not hidden as successful concurrent runs.
- At `8a6880e`: lint passed with zero warnings. Task 3 ran 20 Jest suites,
  **1,167 passed / 5 existing optional external-DB skips / 1,172 total** in
  563.454 seconds. Its five skips belong to qualification, operational-audit,
  reconciliation store/integration and provider-dispatch optional Postgres cases;
  this Task 4 node-test has no optional external-DB skip path.
- Task 3 Docker import closure: 173 imports / 116 files / 2 frontend voice inputs;
  maturity and three serial isolated qualification/audit/reconciliation smokes passed.

Unchanged long suites, typecheck/build/MCP/lint and bridge smokes are not blindly
rerun for test/workflow/documentation-only edits. Final CI hardening/alignment and
Docker closure receipts are recorded in the completion section.

## Final Checks And Self-Review

```powershell
node --test scripts/ci-hardening-smoke.mjs
node scripts/subagent-release-alignment-smoke.mjs
node scripts/render-docker-imports-smoke.mjs
node --check scripts/canary-evidence-postgres.node-test.mjs
git diff --check
```

All exit 0. CI hardening: **6/6 passed**, zero failures/skips,
8,718.5324 ms. Alignment: one passing smoke program. Docker closure:
`render_docker_imports_ready`, **173 imports / 116 files / 2 frontend voice inputs**.
Syntax and diff checks passed. Git also reported the pre-existing controller plan
file's LF-to-CRLF advisory; that file was not changed/staged by Task 4.

Self-review checked the four owned files against the brief and mandatory I1
obligation. The workflow has only the additional guarded step; all original
six-suite commands/assertions remain byte-for-byte unchanged. Test DDL/fixtures are
only in the guard-verified generated empty database, with cleanup in `finally`.
Original reader SQL is executed unchanged; pool observation records real engine
envelopes/settings and only between-snapshot tests inject external fixture changes.
Returned denial envelopes cannot contain the oversized physical field; the
cumulative case distinguishes remaining allowance from maximum per-query bytes.
No production implementation or deadline/guard was relaxed to obtain passing proof.

## Deferred Limits And Review

This is local controlled proof of the reader and storage behavior, not genuine
independent version execution or actual readiness. No live producer exists. No
operational data was created; fixtures never entered actual readiness. No provider
contact, seller calls/messages, retries, auth/approval/dispatch changes, production
migration, push, PR, deployment or promotion occurred. No UI was changed, and no
BrowserOS/mobile/hosted UI validation is claimed. No full founder suite or image
build was run; Docker closure is import/distribution validation, not an image build.

No engine reader defect surfaced in the first run; if one surfaces in subsequent
proof, Task 4 must report `NEEDS_CONTEXT` to the controller before any broader
production edit. Independent task and whole-branch security/behavior review is
requested from the controller after the Task 4 report. No production-ready claim.

## Final Review Fix FR-I1

This separate fix wave starts at `db28c2588421bd65f7dedcc50b4a1c454526466e`.
The authoritative finding is final-review.md, **FR-I1 / P1: Handle checked-out
PostgreSQL client error events**. Only the reader, its existing test file and
these two operations documents changed. No bridge/hash, SQL, admission, budget,
clock, policy, auth, approval, dispatch or delivery code changed. User `output/`
was preserved. The ignored final-fix-report.md is not force-added.

All commands used Node `v22.23.5` with the process-local PATH prefix above.
Before each executable verification, runtime/test database, PG and Supabase
environment variables (or values containing PostgreSQL/Supabase URLs) were
removed without printing values. No actual PostgreSQL, remote network, provider
or Neon harness was used. Isolated bridge smokes use only their guarded loopback
server, fresh temporary state, no provider credentials and existing cleanup.

RED: the report's exact `canary-client-error-event` offline probe reproduced the
failure at fixbase: unhandled child exit **1**, zero client listeners, unhandled
`error`, no reader result; diagnostic listener control exit **0**, unavailable,
empty stderr. The first FR-I1-only Jest run then had **14 expected failures**
(115 existing tests excluded by the name filter). All three native timing
children crashed, pending-event cases lacked handlers, between-query cases queued
rollback, and the late client lacked safe event ownership.

GREEN: the same original probe's unhandled mode now has **one reader listener**,
exit **0**, `canary_evidence_unavailable`, empty stderr. The unchanged diagnostic
control has two listeners and also exits 0; that control is not production code.
Installed `pg` **8.13.1** / `pg-pool` **3.13.0** are used with an offline
`pg.Client` subclass overriding connect; real pool checkout, query queue and
socket-error handler run without opening a database socket.

Final focused command (the same five-suite command in Focused Regression above):
exit **0**, **5/5 suites / 555/555 tests**, zero failures/skips, **23.571 s**.
The reader has **134 tests**, including **19 FR-I1 cases**. Coverage includes
same-stack/nextTick/immediate native checkout errors, pending BEGIN/config/select/
rollback in both snapshots, between-query poison, late query completion/rejection,
late native acquisitions in both snapshots, reentrant destruction, late destroyed
errors and native max:1 success/reuse/idle-listener ownership. Denials have exact
empty proof and fixed redacted codes. Poisoned waits settle within a 1-ms fake
timer turn, not the 2-second query timeout; destruction is once and no further
query or rollback is dispatched after poison.

Additional fresh commands, each exit **0**:

```powershell
node scripts/render-docker-imports-smoke.mjs
node scripts/release-qualification-bridge-smoke.mjs
node scripts/operational-audit-bridge-smoke.mjs
node scripts/backlog-reconciliation-bridge-smoke.mjs
```

Docker closure: **173 imports / 116 files / 2 frontend voice inputs**. The three
smokes ran serially and passed their founder-only/no-provider-write, no-contact,
readiness-blocked and no-source-mutation assertions with automatic child cleanup.
Only the expected VM Modules experimental warning and its standard hint occurred
in Jest; no warning suppression was added. Git's LF-to-CRLF advisories are
repository line-ending notices, not new runtime warnings.

The **20/20 actual PostgreSQL** receipt earlier in this document is historical at
`57fc511`, not an execution of this fix. SQL remains byte-for-byte unchanged;
this wave adds native-driver failure/lifecycle proof, not fresh engine/network
failure injection or operational canary provenance. Existing broader build and
integration receipts remain attributed to their original revisions. No long
20-suite/founder run, image build, live DB check, push, PR, deployment, migration,
producer, runner, seller contact, retry or approval/auth change was performed.
Missing producer/live evidence remains blocked; scoped controller re-review is
still required before merge. No production-readiness claim is made.

## Final Review Closure

The independent whole-branch review covered `82c2f5f` through `db28c25` and found
one Important availability defect, FR-I1. The focused correction is
`345b89f99e57384c912aeb39f7b5e395ed4ec970`. Its independent scoped re-review
verdict is **FR-I1 addressed; no new Critical, Important or Minor breakage; no
open findings**. This closes the earlier pending-review statement, not the
missing-producer or production-readiness gates.

The controller independently reran the five focused suites at `345b89f`:
**555/555 tests, 5/5 suites, zero failed or skipped**, 39.453 seconds. The local
JSON receipt is `.pbk-local/trusted-canary-final-jest.json`; only the narrowly
classified VM warning appeared. The controller also independently confirmed
both earlier disposable evaluation branches return authenticated GET 404.
Historical 20/20 actual PostgreSQL and broader checks retain the revisions and
limitations recorded above; no fresh remote database or full-founder claim is
substituted for them.

All four local implementation stages and their independent review gates are
complete. The broad bridge hash guard retains its documented independent-refresh
procedure; no warning suppression or safety-boundary relaxation was accepted.
The accidentally tracked scratch report was untracked, and only this plan's
ignored scratch directory is eligible for cleanup. Existing user output and
operational receipts remain untouched.

The final automated scratch-cleanup command was rejected by execution policy
before running. The ignored plan scratch directory and its review reports are
therefore left intact; no alternate deletion path was attempted. This does not
affect the committed implementation, test results or preserved user output.

Branch `codex/trusted-canary-evidence` and its worktree are retained locally.
No merge, push, pull request, deployment, production migration, producer, seller
contact or delivery retry was performed. Unknown dispatch locks, authentication
and approval controls remain unchanged. Genuine independent operational evidence
and every other readiness gate are still required before launch.

## PR23 CI Observation Adapter Repair

This bounded repair starts at `125c458de581b39cce1d71d45a66c48afbbf6f29`
on `codex/trusted-canary-evidence`. Earlier receipts above remain historical;
the fresh evidence below does not relabel those runs or claim production readiness.
The failing Release Qualification run was `44215335448`, job `134503639887`.

Cause: the actual-Postgres observation adapter returned only query/release and
ignored native callback checkout. FR-I1 requires `on`/`removeListener` and owns
the error channel synchronously inside pg's acquisition callback. The old adapter
lost both contracts: listener installation failed before ownership was recorded,
leaking the acquired lease; subsequent assertions and pool starvation followed.
The production reader was correct to fail closed and is unchanged in this repair.

The original adapter was extracted unchanged into the test-only
`scripts/fixtures/canary-postgres-observer.mjs` before fixing it. The guarded PG
proof and offline regressions now import that same helper. The repair forwards
callback acquisition without a promise turn, delegates the two native event
methods to the actual client and retains promise checkout for test consumers.
Query configs/SQL, native query errors and native release/double-release behavior
are forwarded without rewriting results. All existing OID, size, read-only,
query-timeout, full-row fingerprint and protected-fixture assertions are retained.

### Offline RED And GREEN

All commands use the pinned Node `v22.23.5` and process-local PATH prefix above.
Before correction, the initial node-test form of the new adapter regression ran:

```powershell
node --test scripts/canary-postgres-observer.node-test.mjs
```

Exit **1**, **0 passed / 3 failed / 0 skipped**, **300.8635 ms**. Expected failures:
missing evidence incorrectly became unavailable; a same-stack native checkout
error had no owner; the acquired lease was never released. RED cleanup explicitly
released orphaned offline clients, so reproduction did not hang or use a database.
After the adapter-only correction, that same command passed **3/3**, exit **0**,
**251.1251 ms**. No production hardening or deadline was changed to obtain GREEN.

The regression was then moved to `scripts/canary-postgres-observer.test.mjs`
using the repository's Jest convention, so the normal unit-test discovery includes
it. Three additional lifecycle characterizations passed on their first execution:
callback release plus promise reuse/native double-release guard; checkout errors
without leases; and inspection-hook failure destroying its lease once. Offline
tests use installed pg/pg-pool with a no-socket pg.Client subclass, empty selections
and transaction inspection only, not substituted physical evidence envelopes.
Real SQL admission and full signed-chain success are established by PG below.

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/canary-postgres-observer.test.mjs scripts/canary-evidence-protocol.test.mjs scripts/canary-evidence-reader.test.mjs scripts/canary-evidence-wiring.test.mjs scripts/production-readiness-evidence.test.mjs scripts/release-qualification-ci.test.mjs
```

Exit **0**, **6/6 suites / 561/561 tests**, zero failed/skipped, **23.743 s**.
The adapter-only Jest command also passed **6/6**, **0.655 s**. Only the expected
VM Modules experimental warning and its standard hint occurred; no suppression.
Offline focused commands scrubbed database/PG/Supabase environment values.

### Fresh Guarded PostgreSQL And Cleanup

The unchanged evaluation harness ran the entire existing PG file, without a
test-name filter or optional skip. Exact harness arguments:

```text
--ttl-hours 1 --branch-name pbk-eval-targeted-readiness-canary-9730ea6b-d212-40e1-9b6d-78606bbac4cf -- node --test scripts/canary-evidence-postgres.node-test.mjs
```

The guarded wrapper followed Actual PostgreSQL Command And Cleanup above, with
additional parent database/PG/Supabase URL scrubbing, disabled inherited dry-run /
runtime-injection flags and output URI/key redaction. It retained the harness's
injected child test/eval URLs and PBK API alias, omitted the connection summary,
and independently authenticated the final branch GET. Keys came only from the
existing environment; no secret, database URI or environment file was printed.
The exact executed wrapper is retained in the ignored `pr23-ci-fix-report.md`.

Exit **0**, **20/20 tests**, zero failed/cancelled/skipped/todo, **37,095.972 ms**.
This is the workflow contract, the DB parent and all 18 unchanged DB subtests.
Signed positive readback, missing producer, microsecond precision, authenticated
denials, independent snapshots, exact numeric OIDs and both size-admission limits
all passed on this fresh execution. No actual-PG failure or retry occurred.

- Fresh TTL1h branch: `br-frosty-rain-ajjkdm4d`; unique name suffix
  `9730ea6b-d212-40e1-9b6d-78606bbac4cf`.
- Existing authenticated guard verified fresh nondefault/nonprotected identity
  and matching endpoint before any DDL. No operational database was used.
- Only a UUID-generated empty `pbk_canary_<32-hex>` database received synthetic
  fixtures. Inherited protected-table fingerprints remained unchanged.
- Generated database dropped in finally and independently catalog-verified absent.
- Harness branch DELETE completed; independent authenticated branch **GET 404**.
- No cleanup failure, provider contact, delivery retry or production migration.

### Additional Checks And Ownership

```powershell
node --test scripts/ci-hardening-smoke.mjs
node scripts/neon-evaluation-harness-smoke.mjs
node scripts/render-docker-imports-smoke.mjs
```

All exit **0**. CI hardening: **6/6**, no failures/skips, **9,060.7439 ms**.
Harness smoke: `ok`. Docker import closure: **173 imports / 116 files /
2 frontend voice inputs**. No runtime authority or fixture signer was added.
`node --check` passed for all three changed JavaScript modules; `git diff --check`
passed. Git's LF-to-CRLF notices are repository line-ending advisories.

Only the PG test, its extracted helper, the offline adapter test and this
validation document are owned by this repair. Production reader/protocol/bridge,
SQL, fixed budgets, guard/harness, original six-suite no-skip gate and workflow
are unchanged. User `output/` and ignored receipts remain untouched. No subagents,
shared publication, push, CI recheck, merge or deployment was performed.
Full unit/founder/build/hosted/UI runs were not rerun for this bounded test-only
repair. Controller independently reviews the diff and owns push/recheck/merge.
Missing operational producer/evidence and production-readiness gates remain open.
