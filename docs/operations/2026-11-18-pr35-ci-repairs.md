# PR 35 CI Fixture Repairs

## Scope

Base: `77d9e4c726ec5df4d5a4bbcd73426438648c33bb`.
Fix the plan-document and native audit-fixture CI failures and rerun CI. Keep the
PR draft; do not merge into main, deploy or migrate production. Preserve unknown
dispatch locks and auth/approval policy. No seller contact or delivery retries.
Production runtime, validators, migrations and CI gates are unchanged.

## Plan Contract

Founder Verify run `44374760185` passed 100 unit suites (3,023 tests, 12 existing
opt-in skips), then failed `subagent-release-alignment-smoke.mjs:86` because the
closure plan retained the old execution alternative. The plan now requires the
founder-selected subagent-driven workflow, independent spec/code reviews and
verification before success claims. Historical implementation facts are retained.
Pinned Node 22.23.5 reproduced RED, then the unchanged smoke passed after repair.

## Native Evidence Fixture

Release Qualification run `44374760266` passed 305 tests and failed one native
operational-audit test. The test reused a closure reference from its in-process
fixture despite the store capturing a different native Postgres boundary. Its
owned qualification schema also lacked the immutable closure installation.
The production validator correctly kept readiness false.

The native test now:
- Requires its random `pbk_proof_` schema allocated by the guarded runner before
  any new database setup.
- Installs the existing fixed closure SQL only through the schema-isolated test
  adapter and verifies the exact installation with the unchanged validator.
- Collects closure evidence from the actual audit pool using the captured audit
  boundary and cutoff, asserting identical boundary readback.
- Retains the genuine coverage-chain checks, false/ready/tamper/latest-failed
  assertions and protected-record cleanup. No Boolean replaces real validation.
- Attempts pool and in-process fixture cleanup even on setup/shutdown failure.

The existing test-only SQL adapter gains a closure-catalog opt-in only for the
native audit suite. After schema isolation it aliases catalog identity lookups
and catalog-rendered schema names so the unchanged exact validator can inspect
the owned schema. Bind values and returned rows are not rewritten. The default
adapter contract and all other qualification suites remain unchanged.

Regression tests execute real SQL, preserve schema-like JSON values, leave a
same-named public impostor untouched, verify the isolated snapshot reference,
and reject both a disabled immutable trigger and a weaker tenant constraint.
Meaningful RED was `closure_installation_invalid`; the initial multi-command
PGlite query setup error was corrected before recording that RED.

## Local Native Verification

The existing guarded Docker runner used an empty generated loopback database,
the cached pinned image, and the same least-privilege owner checks. A new case
proves the isolated-schema catalog and snapshot behavior on native PostgreSQL,
beside the existing admission, race and six-locked-dispatch checks.

Two early attempts exposed the documented Docker/Windows clock skew: first the
new snapshot case failed, then the old admission case failed with dependent
cascades. A test-only condition now waits for actual database time at snapshot
capture and ordinal allocation, within the existing 100ms fixture cap. It does
not change clocks, rewrite timestamps, raise limits or alter runtime ordering.
The existing response buffer and reverse-clock negative case remain intact.

Final native result: 17 passed, zero failed/skipped. The reverse-clock case still
rejects; all six unknown dispatch rows and originals remain unchanged. The network
observer recorded zero external connections and zero HTTP/provider sender access.
Owned database/container cleanup succeeded; unrelated resources were untouched.

## Review And Verification

Independent read-only review found no actionable issues, including the catalog
alias, real pool/boundary use, native timing condition, cleanup, public impostor,
and constraint/trigger drift checks. No release or merge authorization is implied.
One pre-existing limitation remains: a rejection inside `createAuditFixture`
before returning relies on that helper's internal resource ownership.

Fresh focused fixture/store/qualification-reader verification passed: three suites,
181 passes, zero failures and one ordinary opt-in Neon skip (588.085 seconds).
The guarded local native proof above ran all 17 tests without skips. The plan
smoke, typecheck, lint, changed-test syntax and whitespace checks passed.
Fresh remote CI must still run the mandatory native Neon case with zero skips
and the full founder workflow. Record actual CI results on PR 35, not by waiving
checks or repeatedly committing result-only receipts.
