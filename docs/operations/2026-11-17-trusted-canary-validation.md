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
