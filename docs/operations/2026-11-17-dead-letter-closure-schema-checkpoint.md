# Dead-Letter Closure Schema Checkpoint

This is the retained historical Task2 report. Its unavailable-native-proof status
describes that checkpoint only. Subsequent isolated native proof passed14/14;
see [final local validation](2026-11-17-dead-letter-closure-validation.md).
The original report and failed/skipped checkpoint evidence are preserved below.

## Original Task2 Implementer Report

Status: DONE_WITH_CONCERNS (implementation/local verification complete; real PostgreSQL proof unavailable).

Base: `3557662` on existing `codex/dead-letter-closure` worktree.
Commit subject: `feat: add guarded immutable dead-letter closure ledger`.
The final response supplies the resulting commit SHA; this report is included in that commit.

## Scope And Boundaries

Read the Task 2 brief first, then its context/constraints, the implementer template,
repository operating/design instructions, Task 1 integration contract/protocol,
and the existing targeted/census migration patterns. Did not read the full plan,
spawn subagents, change another task, install dependencies, start services,
contact a database server, provision any database, push, or deploy.

The pre-existing plan edit and untracked `output/` are not staged or modified by
this implementation. All database execution in this task was local in-process
PGlite. The real-Postgres test branch was not enabled and did not connect.

## Implemented

- Fixed checked-in SQL creates only the closure ledger, identity sequence,
  constraints/indexes and one non-execution mutation-rejection function/trigger.
  There is no source-table foreign key, cascade, repair, replay, provider write,
  upload/execution helper, new role, global grant or startup installation.
- Ledger fields match the Task 1 row contract. Unique id, ordinal and intent
  binding; PBK-only tenant; constrained actions/keyed refs; finite admission time;
  positive/current transaction xid; self-reference with RESTRICT; JSONB report
  bounded to 65,536 serialized bytes. SQL binds every column to report fields,
  checks attestation shape, and fails closed on missing/null report bindings.
  HMAC authentication remains the existing pure protocol's responsibility:
  SQL deliberately has no secret or arbitrary-object signing/upload function.
- `validateClosureMigrationConfig(env)` uses only dedicated
  `PBK_CLOSURE_MIGRATION_DATABASE_URL`, `TARGET`, `EXPECT_HOST`,
  `EXPECT_DATABASE`, `EXPECT_ROLE`. Requires explicit local/loopback matching,
  database/role identity and password; rejects overrides/fragments and browser
  owners. Ambient runtime URLs/apply flags have no authority.
- CLI defaults to offline dry-run. Apply additionally requires `--apply` and
  `--confirm-sha256=<reviewed-current-SQL-hash>`. Invalid arguments/confirmation
  fail before connection; CLI errors do not disclose connection strings.
- `applyDeadLetterClosureMigration(client,{expectedDatabase,expectedRole})`
  requires a dedicated connected client, owns its transaction, sets hardened
  search_path and 2-second statement/lock limits, checks connected identity and
  callable xid/snapshot capabilities before DDL, and serializes installers with
  a fixed transaction advisory lock. Existing supported installations are
  verified, never rewritten. Fresh DDL and exact readback commit atomically;
  failed creation/readback rolls back. Repeat apply preserves rows.
- `verifyDeadLetterClosureInstallation(query)` takes the caller-owned bounded
  `query(text,values)` function, not a client object. It performs only SELECTs:
  no connection, transaction control, settings, writes or helper installation.
  Checks exact reserved object inventory, column types/order/nullability/
  defaults/identity/collation, complete constraints and their actual catalog
  dependencies, indexes, self-FK target, RLS/no FORCE/no policies, inheritance,
  rules, ownership/current_user, ACLs and effective application-role privileges,
  identity sequence ownership/dependency/parameters/privileges, and exact
  immutable trigger/function body, signature and attributes. Catalog calls and
  relations are qualified; same-deparsed noncatalog function substitution fails.
- Success returns `{ok:true,verified:true,result:'closure_installation_verified',
  identitySequence:'public.pbk_dead_letter_closure_ledger_ordinal_seq',
  ownerDdlTrusted:true}`; verification failure returns the fixed sanitized
  `{ok:false,verified:false,result:'closure_installation_invalid'}`.
- Existing trusted server owner remains the owner; RLS is enabled without FORCE
  and without inventing an owner policy. PUBLIC/browser grants are revoked only
  on new closure objects. Unexpected unrelated defaults fail/roll back rather
  than silently changing role architecture. Missing required owner privileges,
  nonowner direct/column grants, and inherited application-role access fail
  verification. Superuser/predefined cluster capabilities are not a tamper
  boundary; their grants to ordinary application roles are detected.
- Statement-level UPDATE/DELETE/TRUNCATE rejection is ENABLE ALWAYS, including
  zero-row statements. This matches PostgreSQL's documented replication-mode
  behavior ([ALTER TABLE](https://www.postgresql.org/docs/16/sql-altertable.html)).
- Local signed-row fixtures allocate the verified sequence, database microsecond
  admission time and current xid in one transaction, sign before inserting with
  OVERRIDING SYSTEM VALUE, and independently authenticate text-cast readback.
  Ordinal `9007199254740993` remains exact decimal text. Consuming a sequence
  value without inserting a row changes no closure count or proof.
- Real-PG schema file requires dedicated opt-in, literal loopback IP, a generated
  `pbk_closure_test_<32hex>` name, matching identity, a nonsuperuser/non-BYPASSRLS
  existing owner, and an empty DB before DDL. It neither creates roles/databases
  nor starts services. Empty checking includes standalone types/functions and
  other namespace dependencies, extra schemas and nondefault extensions. Local
  guard coverage is explicitly labeled PGlite, separate from the skipped real
  schema branch. Full real replica/concurrent behavior remains Task 7 work.

Fixed SQL SHA256 of the tested working-copy bytes:
`efb4896662b5bb4375968d5b0f36228c3818545bf202a3bd1a49b0a9ae096572`.
The CLI reports the hash of the local checked-in file's bytes; review that value
at execution time (including any checkout line-ending differences).

## TDD Evidence

Pinned executable for every command below:
`D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`.
PowerShell command prefix: `& '<pinned-executable>'`.

### Initial RED

Before adding the module or SQL, ran:

```text
--experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --testMatch '**/scripts/dead-letter-closure-migration.test.mjs' --runInBand
```

Exit 1, expected missing implementation:
`Cannot find module './dead-letter-closure-migration.mjs' from 'scripts/dead-letter-closure-migration.test.mjs'`.
One suite failed to load; zero tests executed. Jest also emitted a teardown
ReferenceError resulting from that missing import. This was RED, not passing proof.

### Additional RED/GREEN During Self-Review

- After initial implementation, 37/41 failed because strict readback did not yet
  match PostgreSQL's multiline CASE deparser output. Inspected actual PGlite
  catalog rows and corrected exact expected forms, retaining literal/cast/order
  checks rather than introducing a lossy normalizer. Then 41/41 passed.
- Added owner-privilege and catalog-shadowing coverage. Observed owner SELECT,
  INSERT, sequence and function privilege removal being accepted incorrectly;
  corrected actual owner privilege checks and catalog qualification. Fixed
  test-only cleanup to run as the fixture administrator after ownership drift.
  Then 55/55 passed.
- Ran the Jest command with
  `--testNamePattern 'browser role .*trusted owner|same deparsed check'`:
  three selected tests failed (browser-owner acceptance and substituted
  noncatalog check function). Added browser-owner refusal and actual constraint
  dependency checks. Subsequent unfiltered run covers all of these passing.
- Ran with `--testNamePattern 'inherited role privileges'`: selected test failed
  because owner membership granted to anon was not detected. Added effective
  application-role table/column/sequence/function/member checks; all cases pass.
- Bigint test initially expected driver error detail in the primary message;
  observed the actual `cannot insert a non-DEFAULT value into column "ordinal"`
  and corrected the assertion, not the implementation.
- Node guard test first failed with
  `CLOSURE_EMPTY_DATABASE_SQL is not defined` (exit 1, 2 pass/1 fail/1 real-PG
  skip); added the shared read-only empty-database preflight SQL. Then exit 0,
  3 pass/0 fail/1 explicit real-PG skip.
- Strengthened report tests so each malformed/missing/null/oversized matching
  candidate must specifically fail `pbk_closure_report_check`, not an unrelated
  uniqueness or column mismatch. Missing capability tests execute real SQL with
  one absent signature substituted at a time, rather than faking success rows.

Filtered development runs deselected other tests; final unfiltered Jest runs
below have zero skips. No selected failing test is hidden in final evidence.

## Final Verification

### Task Jest Run

```text
--experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --testMatch '**/scripts/dead-letter-closure-migration.test.mjs' --runInBand
```

Exit 0; **61 passed, 0 failed, 0 skipped**, one suite (12.866 seconds test time).
Required cases include wrong target/drift, repeat preservation, normal/replica
PGlite immutability, actual browser privileges/RLS, missing trigger, explicit
owner-DDL limitation, absent xid/snapshot preflight, and transactional rollback.

### Focused Jest Regressions (Final Unfiltered Run)

```text
--experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --testMatch '**/scripts/dead-letter-closure-migration.test.mjs' '**/scripts/dead-letter-closure-protocol.test.mjs' '**/scripts/bounded-census-schema.test.mjs' --runInBand
```

Exit 0; **159 passed, 0 failed, 0 skipped**, 3 suites, 75.915 seconds.
Breakdown: 61 migration + 7 protocol + 91 existing bounded-census schema tests.
Only expected Node experimental VM Modules warning; no application errors.

### Node Guard And Migration Regressions

```text
--test ./scripts/targeted-readiness-migration.node-test.mjs ./scripts/migration-runner-safety-smoke.mjs ./scripts/dead-letter-closure-postgres.node-test.mjs
```

Exit 0; **38 passed, 0 failed, 1 skipped**, 39 tests, 111.369 seconds.
The sole skip is the newly added, explicitly disabled real-Postgres schema
branch: `Real PostgreSQL unavailable/not opted in; no replica or concurrent-transaction proof claimed`.
Three new local guard tests passed; 35 existing offline/PGlite migration safety
regressions passed. The standalone Task 2 Node file also passed 3 local tests,
zero failures, one same explicit real-PG skip. No application warnings/errors.

`git diff --cached --check` exited 0 with no whitespace errors. Git staging
emitted only existing checkout-policy LF-to-CRLF notices, not test failures.
The full repository suite is intentionally deferred to Task 7 per the worker
constraints; no full-suite/baseline improvement claim is made. No UI changes:
build, browser/mobile and hosted/service smoke are outside this SQL-only task.

## Files

- `scripts/dead-letter-closure-migration.mjs`
- `scripts/migrations/20261117-dead-letter-closure.sql`
- `scripts/dead-letter-closure-migration.test.mjs`
- `scripts/dead-letter-closure-postgres.node-test.mjs` (guards/schema only)
- `.superpowers/sdd/2026-11-17-dead-letter-closure/task-2-report.md`

## Self-Review And Concerns

Reviewed the scoped staged diff against brief/context, including startup/import
isolation, transaction/readback behavior, original source schema/row preservation,
exact metadata comparisons, privileges, unsigned staging avoidance, bigint/time
precision, RLS and no source/provider writes. Findings fixed during TDD are listed
above. No unrelated edits or intentional requirements omissions remain.

1. **Real PostgreSQL proof is unavailable.** Neither PGlite replica rejection nor
   an optional skipped real test proves real replication/concurrency behavior.
   Task 7 must complete and execute the isolated real-PG proof if a local engine
   becomes available; this task does not start one or authorize a remote fallback.
2. **Owner/superuser DDL is explicitly trusted.** A test disables the immutable
   trigger as owner and deletes a row, then demonstrates verifier rejection.
   This guards accidental DML and installation drift, not a malicious schema
   owner who can recreate history. No stronger tamper claim is made.
3. **Catalog format compatibility fails closed.** Exact definitions are tested
   with installed PGlite; compatibility with a real deployment's PostgreSQL
   deparser remains part of the real-PG gap. Unexpected version/metadata output
   is rejected, not normalized into acceptance.
4. **Future store responsibility:** own a stable/bounded transaction, verify
   installation, allocate the returned identity sequence/current xid/database
   microsecond time, sign the complete report, then insert once with explicit
   OVERRIDING SYSTEM VALUE and independently authenticate readback. This task
   supplies schema/verifier and local fixtures, not Task 3 store or authority.
