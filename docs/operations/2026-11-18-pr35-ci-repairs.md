# PR 35 CI Fixture Repairs

## Scope

Base: `77d9e4c726ec5df4d5a4bbcd73426438648c33bb`.
Fix the plan-document and native audit-fixture CI failures and rerun CI. Keep the
PR draft; do not merge into main, deploy or migrate production. Preserve unknown
dispatch locks and auth/approval policy. No seller contact or delivery retries.
Production runtime, validators and migrations are unchanged. Existing CI gates
remain mandatory; a separate positive native audit proof is additionally required.

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

Initial native result: 17 passed, zero failed/skipped. The reverse-clock case still
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

## Managed-Role Isolation And Positive Proof

The plan repair passed Founder Verify on `889be6d`. Release runs on `889be6d`
and `5a5498d` exposed a second fixture problem after cleanup stopped masking
setup failures. Bounded catalog diagnostics on `aa06ea4` identified the exact
cause: the managed Neon installation has `role_access_safe=false`. Ownership,
RLS, direct ACL, trusted-role and read/insert checks passed. The strict production
validator correctly rejects this context; its security rule is not relaxed.

The managed-role integration now asserts that rejection and a blocked audit,
while retaining signed JSONB tamper and newest-failed-attempt checks. If a future
disposable installation genuinely passes the validator, the positive path still
requires actual snapshot-bound closure evidence. No unsafe installation becomes
verified just to satisfy a test.

Independent review identified two negative-test masking risks. The test now
requires all other exact installation invariants, including rollback-scoped RLS
and trigger drift rejection. Its diagnostic isolates only the known role flag;
the resulting counterfactual is never evidence. Collector assertions are also
surfaced outside the store's intentional signed-failure catch, and complete
coverage must still verify with only the dead-letter check blocked for the
specific source-unavailable reason.

Release Qualification also requires the existing disposable native runner, now
supported on GitHub Actions Linux with an explicitly opted-in fixed `default`
Docker context and local Unix socket. Windows retains its `desktop-linux` named
pipe. Remote/alternate contexts and Docker environment overrides are rejected.
The image remains digest-pinned; generated identity, loopback publication, tmpfs,
least-privilege role, empty-database preflight, ownership-checked cleanup and all
timeouts remain intact. The original six-suite Neon zero-skip gate is unchanged.

The additional positive audit test uses actual native PostgreSQL installation,
snapshot capture, closure readback, JSONB persistence and signature verification.
Its controlled collector and signed quiet-day coverage fixture are synthetic
test inputs, not live operational readiness evidence. It requires a genuinely
passing receipt, rejects JSONB tampering, and refuses an older-good fallback
after a newer signed failed attempt. Six synthetic unknown dispatches remain
unchanged and a network observer denies external/sender access.

The expensive quiet-day fixture has its own bounded native test rather than
consuming the race suite's deadline. The 120-second per-test and 180-second
controller limits are not raised. An intermediate combined-parent run timed out
after its positive assertions; that run is not counted as a native pass.
An initial separated run also failed under concurrent fixture load, including
the existing 100ms clock-convergence guard. These failed runs remain caveats,
not successful native verification or justification to increase limits.

Fresh focused rerun: three suites passed, 182 tests passed, zero failed and one
ordinary Neon opt-in skip (625.675 seconds). The CI wrapper/reader contract and
cross-platform provisioning guards passed 96 and 33 tests respectively. Typecheck,
lint, changed-script syntax, plan alignment and whitespace checks passed. Review
confirmed both masking findings resolved with no new static findings; real native
execution and fresh current-head CI remain mandatory before any all-green claim.

The serial native rerun completed in 108.637 seconds: 17 passed, one failed,
zero skipped/cancelled. The new audit case took 101.162 seconds, within its
unchanged budget, but failed snapshot capture at the existing 100ms clock guard
after the Docker/Windows clock lead reached 134ms. This is not a native pass.
Both network observers recorded zero external/sender access, six protected
dispatches and originals were unchanged, and owned cleanup succeeded. No clock,
timestamp or limit was changed; the mandatory Linux native CI run must establish
the positive same-host proof before considering qualification green.

## Coverage-Only Native Fixture Follow-Up

Release run `44401441320` on `9173e51` passed the mandatory native proof (18/18,
zero skips) and exact six-suite Neon qualification (306/306, zero skips), with
owned cleanup and protected rows intact. It then reached a stale expectation in
`targeted-readiness-postgres.node-test.mjs:323`: a coverage-only fixture without
any closure ledger expected whole-audit readiness. The real collector correctly
kept both dead letters and database security unverified.

The follow-up keeps native coverage-reference, head-advancement, historical/
current/control/source tamper, restored-proof and atomic-failure assertions. A
shared test assertion now requires actual verified coverage while whole-audit
readiness stays false. Only dead letters and database security may be unverified,
both specifically source-unavailable. Security counts must be exactly 23 required,
22 present, one missing, zero RLS-disabled tables and zero public-role grants;
dead-letter counts remain zero. All other checks must pass. A signed collector
failure, extra drift or false readiness cannot masquerade as this expected case.
The separate mandatory native proof still requires a genuinely passing full audit.

The new assertion regression was run RED-to-GREEN and includes missing-check,
duplicate-check, caught-collector, coverage, privilege, extra-table and outstanding-
dead-letter mutations. This corrects test scope, not runtime authorization or
readiness requirements. No fixture table is added to manufacture readiness.
