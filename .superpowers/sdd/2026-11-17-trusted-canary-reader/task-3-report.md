# Task 3 Report: Bridge Readiness And Distribution Wiring

## Scope And State

- Branch: `codex/trusted-canary-evidence`.
- Starting HEAD/base: `75d37469fe237f02366d139ed7bb4623a6dc780c`.
- Read the Task 3 brief first, common contract, repository operating/design documents, and PBK founder-runtime guidance. Did not read the whole plan.
- Implemented directly in the shared isolated worktree. No subagents or independent reviewers spawned; controller owns subsequent independent review.
- Preserved pre-existing untracked `output/` without reading, modifying, staging, or deleting its contents.
- No endpoint, tool, payload flag, auth route, runner, signing API, provider operation, seller contact, retry, approval change, dispatch change, migration, external database access, push, PR, or deployment added or performed.

## Owned Changed Files

1. `scripts/openclaw-local-server.mjs`: import the reviewed read-only reader, obtain server-owned v2 policy with `requireVersion2: true`, pass existing pool/key/revision and `Date.now`, catch unexpected reader rejection, merge only `canary.verified === true`, expose selected bounded reader diagnostics, and report truthful verified/unverified comparison state.
2. `Dockerfile.openclaw`: two explicit runtime COPY entries for reader and protocol only. No fixture signer packaged.
3. `scripts/canary-evidence-wiring.test.mjs`: 21 behavioral/distribution/safety tests, evaluating the actual maturity builder in a VM without importing bridge startup. Actual protocol verification generates the mocked reader evidence; the actual existing readiness builder evaluates it. Real reader is exercised for missing/rejected storage and unapproved policy.
4. This Task 3 report.

## Reproducible Test Environment

Every test command below used this PowerShell prologue in its own child command process. No persistent environment or git configuration changed.

```powershell
$env:PATH = 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin;' + $env:PATH
Get-ChildItem Env: | Where-Object { $_.Name -match '(DB|DATABASE|PG|POSTGRES|SUPABASE)' -or $_.Value -match '(?i)(postgres(?:ql)?://|https?://[^/\s]*supabase)' } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
```

Pinned executable verified as Node `v22.23.5`:
`D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe`.
Existing test-only PGlite fixtures are in memory; no external Postgres/Supabase service is contacted. Small bridge smokes use `startIsolatedBridge` with its allowlisted environment, permission guard, disposable state directory, and loopback-only requests.

## RED / GREEN History

Command, executed before any production integration or Docker changes:

```powershell
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --runInBand --runTestsByPath scripts/canary-evidence-wiring.test.mjs
```

- RED: exit 1; 1 failed suite; **20 failed, 1 passed, 21 total**; Jest 2.934 seconds.
- Primary expected failure: reader call count 0 instead of 1 on old wiring. Other expected missing-feature failures: no `canaryEvidence`, no verified mode, and missing production Docker copies. The unchanged-bridge safety hash passed.
- After minimal production integration, same command: exit 1; **20 passed, 1 failed**; Jest 1.369 seconds. The failure was an incorrect test expectation: reviewed reader returns `canary_evidence_invalid` for a null pool, not `canary_evidence_unavailable`. Corrected only that test expectation; retained actual reader semantics. A rejected connection still returns `canary_evidence_unavailable`.
- GREEN, same command: exit 0; **1 suite passed, 21/21 tests passed**, no skipped tests; Jest 1.386 seconds.
- Expected Node experimental VM-module warning only.

## Focused Regression Run

Full command (same environment prologue):

```powershell
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --experimental-vm-modules ./node_modules/jest/bin/jest.js --config ./jest.config.mjs --runInBand --runTestsByPath scripts/canary-evidence-wiring.test.mjs scripts/canary-evidence-reader.test.mjs scripts/canary-evidence-protocol.test.mjs scripts/production-readiness-evidence.test.mjs scripts/release-qualification.test.mjs scripts/release-qualification-checks.test.mjs scripts/release-qualification-ci.test.mjs scripts/netlify-qualification-founder-boundary.test.mjs scripts/agent-fleet-controlled-qualification.test.mjs scripts/agent-fleet-bridge-evidence.test.mjs scripts/agent-latency-policy.test.mjs scripts/operational-audit-store.test.mjs scripts/operational-audit-collector.test.mjs scripts/operational-audit-coverage.test.mjs scripts/backlog-reconciliation-store.test.mjs scripts/backlog-reconciliation-collector.test.mjs scripts/backlog-reconciliation-integration.test.mjs scripts/provider-action-dispatch-policy.test.mjs scripts/provider-action-dispatch.test.mjs scripts/provider-action-authorization.test.mjs
```

GREEN: exit 0; **20/20 suites passed; 1,167 passed, 5 skipped, 1,172 total tests**; no failed tests; Jest 563.454 seconds (estimated 633 seconds). No deadlines or tests changed to obtain this result. The long-running command was allowed to finish normally.

The five existing optional external-Postgres tests were deliberately skipped because the child environment has no `PBK_TEST_DATABASE_URL`:

- `release-qualification.test.mjs`: disposable Postgres commits signed proof and rejects JSONB tampering after independent readback.
- `operational-audit-store.test.mjs`: disposable Postgres operational JSONB proof, tampering and latest failed attempt.
- `backlog-reconciliation-store.test.mjs`: disposable Postgres JSONB/CAS, pool one, tampering and pending latest.
- `backlog-reconciliation-integration.test.mjs`: disposable Postgres binds real source/QA/memory evidence without mutating source rows.
- `provider-action-dispatch.test.mjs`: Postgres advisory locks serialize provider execution across separate pools.

## Docker, Maturity, And Isolated Smokes

Each command used the same pinned executable and environment prologue. The three child bridge smokes ran **serially**, with no timeout changes.

```powershell
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' scripts/render-docker-imports-smoke.mjs
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' scripts/production-maturity-loop-smoke.mjs
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' scripts/release-qualification-bridge-smoke.mjs
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' scripts/operational-audit-bridge-smoke.mjs
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' scripts/backlog-reconciliation-bridge-smoke.mjs
```

- Docker closure: exit 0, `render_docker_imports_ready`, **173 imports, 116 files, 2 frontend voice inputs**.
- Existing maturity smoke: exit 0, `production-maturity-loop-smoke: ok`.
- Qualification bridge smoke: exit 0, `ok (isolated, founder-only, no provider writes)`.
- Operational audit bridge smoke: exit 0, `ok (isolated; no seller contact)`.
- Reconciliation bridge smoke: exit 0, `ok (isolated; no delivery tools or source mutations)`.
- These are five passing smoke programs, not invented per-assertion test counts.

Additional commands:

```powershell
& 'D:/pbk-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node.exe' --check scripts/openclaw-local-server.mjs
git diff --check
```

Both exit 0.

## Self-Review

- Server context cannot be replaced by extra maturity arguments; both build and Render revision paths are tested. Approved v2 policy is loaded from server environment, never seeded from the pilot or legacy budgets.
- Malicious mocked reader outputs carrying passing evidence with `verified` false, missing, null, string `true`, or numeric 1 cannot populate existing readiness evidence.
- The verified protocol chain reaches existing gates. Authenticated behavior, latency, error, and fallback regressions remain verified but each fails the original threshold and promotion gate.
- Fleet, controlled qualification, operational audit, and SLO blockers remain independent. Reconciliation remains supplementary, `launchQualified: false`, `noContact: true`, `providerWritesBlocked: true`.
- Missing/rejected storage and unexpected reader rejection return a non-ready maturity snapshot rather than throwing; private error messages are not exposed.
- Operator diagnostics select verification flags, source, result, verified-only run ID, and reviewed bounded/redacted diagnostics, not receipts, fixture authority, raw reports, or connection errors.
- SHA-256 pin covers the entire LF-normalized bridge outside this builder and its new import against the starting base, preserving existing auth, approval, delivery, dispatch, timing, and routing code. Existing safety suites and serial isolated smokes provide behavioral checks in addition to this source-integrity pin.
- Runtime Docker closure includes both production modules and excludes fixture signers; the fixture is imported only by tests.
- No new UI or dependency introduced. No unrelated refactoring performed.

## Limitations And Review Handoff

- No real Postgres integration or genuine operational evidence was created or claimed. Read-only reader/protocol and existing fake/in-memory test fixtures cannot certify production readiness.
- Docker validation is import/distribution closure, not a Docker image build (which would require prohibited package/model network downloads).
- Did not run the huge founder suite, UI/BrowserOS checks (no UI changes), production/provider checks, runner, or deployment.
- Controller reported separate typecheck/build/MCP/CI-hardening/alignment passes, and serial openclaw/launch-safety passes after concurrent startup contention. These are controller-owned receipts, not tests rerun or counted here. No bridge/launch-safety timeout or implementation changed.
- Independent review is intentionally left to the controller after this implementation; no reviewer spawned by Task 3.

## Commit

Only the four owned files listed above are included in the Task 3 commit, subject:
`feat: wire verified canary evidence into maturity [skip netlify] [skip render]`.
The report path is ignored by repository defaults and is explicitly force-added alone, never the surrounding work directory. Commit hooks are disabled only for this command (`HUSKY=0`, `git -c core.hooksPath=`); no persistent git configuration change is made. The final response supplies the resulting commit ID.
