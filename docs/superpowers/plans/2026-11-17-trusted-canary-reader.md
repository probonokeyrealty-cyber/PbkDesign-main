# Trusted Canary Evidence Reader Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. Require test-first tasks and independent review. Track each task below.

**Goal:** Read genuine independent canary receipts from existing Postgres storage
and feed authenticated, recomputed facts into readiness without creating evidence.

**Architecture:** Separate pure receipt-chain verification from bounded read-only
database orchestration. The bridge supplies server-owned dependencies and merges
only verified proof into its existing gates. No producer or write API is added.

**Tech Stack:** Existing Node 22.23.5 ESM, node:crypto, pg, Jest/VM harnesses and the
guarded disposable Postgres evaluation harness; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-trusted-canary-reader-design.md`

## Global Constraints

- Local build/tests only; no push, PR, deployment, migration, runner or signing API.
- Unknown dispatches remain locked; auth, approvals and seller contact are unchanged.
- Existing `pbk_eval_runs` only; PBK tenant; fixed reserved suite/source identities.
- Never manufacture operational samples or promote fixtures, census or quiet monitoring.
- Maximum 256 observations per side; 1,100 rows and 2 MiB cumulatively per read.
- Maximum observation report 2 KiB; run 64 KiB; comparison 8 KiB; diagnostics 8 KiB.
- One poisoned 15-second monotonic operation deadline; every query at most 2 seconds.
- Freshness 24 hours for every source, checked again at operation completion.
- No existing timing, coverage, response, speech or query policy is weakened.
- Preserve user output and unrelated work; continue in the existing isolated worktree.

## Review Focus

- New invalid/pending/different-revision admissions must hide older passing records: Task 2.
- Errors and fallbacks must remain in the denominator, including valid failing comparisons: Task 1.
- Duplicate ids, execution reuse or reordered/changed membership must not disguise source reuse: Task 1.
- Pool reuse and late query resolution must not preserve a poisoned operation or stale snapshot: Task 2.
- A mocked unverified reader carrying a plausible proof must not enter readiness: Task 3.

## File Ownership And Interfaces

Create `scripts/canary-evidence-protocol.mjs` for constants, digest and pure checks.
Create `scripts/canary-evidence-reader.mjs` for bounded read-only orchestration.
Create `scripts/fixtures/canary-evidence-fixture.mjs` for fixture-only signing/data.
Create focused protocol, reader and behavioral-wiring Jest suites and a guarded
Postgres node-test. Modify only bridge integration, Docker closure, relevant
qualification step and operations documentation. No frontend/UI change.

Protocol exports:

```text
CANARY_EVIDENCE_SCHEMA = 'pbk-canary-evidence-v1'
CANARY_EVIDENCE_METRIC_VERSION = 'pbk-canary-metrics-v1'
CANARY_EVIDENCE_KINDS = frozen kind -> {suite, source, idPrefix, maxReportBytes}
CANARY_EVIDENCE_LIMITS = frozen design limits
canaryRowDigest(row) -> lowercase SHA256 canonical physical-row digest
verifyCanaryChain({comparison, runs, observations, secret, revision, policyHash, now})
  -> {verified, result, evidence, diagnostics}; evidence is {} unless fully verified
```

Reader export:

```text
readCanaryEvidence({pool, secret, revision, policy, now = Date.now})
  -> {ok, verified, readbackVerified, source:'postgres:pbk_eval_runs',
      result, runId, evidence, diagnostics}
```

`policy` is the existing approved v2 object (`ready: true`, `version: 2`, hash).
`now` is a server-owned function, never request input. Failure returns no proof,
null runId, false verification flags and fixed redacted diagnostic codes.
Verified but regressing metrics remain verified; the existing gate evaluates them.
Production modules export no signer, recorder, runner or bypass option.

## Fixed Receipt Fields

Settle these field names before tests; implement exact-key validation, not coercion.
All reports share `schemaVersion, kind, tenantId, id, revision, admittedAt,
startedAt, completedAt, status, provenance, scope, executed, metricVersion,
policyHash, cohortRef, attestation`.

- `kind` is comparison/run/observation; tenant is pbk; provenance operational;
  scope independent_canary_execution; executed true; status complete.
- Revisions are lowercase 40-hex SHA; all refs/digests are lowercase 64-hex.
- Id is the design's fixed kind prefix plus 64-hex; attestation has exactly
  `{version: CANARY_EVIDENCE_SCHEMA, signature: <64-hex>}`.
- admittedAt is canonical six-digit UTC, exactly equal to physical created_at;
  startedAt/completedAt are canonical three-digit UTC. Pending comparison/run
  uses status pending, executed false and completedAt null; it can only deny
  evidence. Pending comparison side references may be null. Authenticate the
  pending schema before returning its denial, never parse it as a complete run.
- Private signature derivation: HMAC-SHA256(secret,
  `pbk.canary-evidence.signing-key.v1`) is the signing key; authenticate
  `schemaVersion + newline + canonicalJson(report without attestation)` with it.
- No added field, accessor, prototype, cycle, contradictory provenance flag,
  oversized body or invalid numeric type is tolerated.

Comparison adds `baseline, candidate`; each complete side is exactly
`{id, digest, revision}`. Candidate revision is current; baseline is different.
Run adds `side, comparisonId, admittedCount, observations`; membership is a
sorted, unique array of `{id,digest}` with admittedCount equal to its length.
Observation adds `comparisonId, runId, executionRef, workloadRef, outcome,
fallback, behaviorPassed, latencyMs`; outcome success/error; both flags boolean;
error implies behaviorPassed false; latency finite, >=0 and <= elapsed wall time.

Physical projection is exactly `id,tenant_id,suite_name,source,ok,total,passed,
failed,created_at_exact,report`. Digest its canonical JSON. No parser-dependent
Date serialization or additional SQL metadata enters the source digest.
Observation counters: total 1, passed behaviorPassed?1:0, failed 1-passed,
ok passed===1. Run counters: total admittedCount, passed behavior passes, failed
remainder, ok failed===0. Comparison counters: total 2, passed number of runs
with zero behavior failures, failed remainder, ok failed===0. These are receipt
counter consistency checks, not substitutes for regression thresholds.

Every admission is no later than completion; all starts precede completions.
Run bounds lie inside comparison bounds; observation bounds lie inside its run.
All admissions/starts/completions must be fresh, not future, and each observation
must be bound to its actual run and side. Compare exact microseconds where relevant.
Require same policy/metric/cohort across the chain, matched workload multisets,
and no reused executionRef, observation id or run id across the sides.

### Task 1: Pure Receipt Chain And Metrics

**Files:** protocol module, fixture helper, `scripts/canary-evidence-protocol.test.mjs`.
**Consumes:** canonicalJson from existing skill-governance-store; approved spec.
**Produces:** constants/digest/verifyCanaryChain interface above; fixture factory
`makeCanaryFixture(overrides?) -> {secret,revision,policyHash,now,comparison,runs,observations}`
with test-only rebuild/resign helpers for deliberate tampering cases.

- [x] Write a positive two-version fixture test; assert verified, separate run ids,
  sample counts, nearest-rank numeric p95 and independently recomputed ratios.
- [x] Run the new suite and confirm RED from absent production protocol.
- [x] Implement exact protocol checks and private signature verification. On valid
  input return only the existing evidence.canary comparison/baseline/candidate
  fact shape; no caller aggregate ratios or report pass flag is trusted.
- [x] Add rejection matrices for every binding/shape/provenance/freshness/size
  condition in the spec, including microsecond boundary cases and shared executions.
- [x] Assert error and fallback rates from all admitted samples; authenticate a
  slow/high-error fixture and assert the existing buildExecutedReadinessEvidence
  still blocks it. Valid bad metrics must not be relabeled corrupt evidence.
- [x] Run protocol and existing production-readiness-evidence suites to GREEN.
- [x] Independent task review, resolve findings, then commit only owned files.

### Task 2: Poisoned, Bounded Read-Only Store Reader

**Files:** reader module; `scripts/canary-evidence-reader.test.mjs`.
**Consumes:** Task 1 exports and fixture factory; server-owned pg pool.
**Produces:** readCanaryEvidence interface above; no storage writes or caches.

- [x] Write failing fake-pool tests proving no record is missing/unverified, a
  complete chain is read twice, and a newer invalid admission masks an older pass.
- [x] Confirm RED before creating the reader implementation.
- [x] Implement the fixed projections and suite-OR-source newest admission query,
  exact dependency batches, repeatable-read/read-only transactions and native
  protocol verifier. Admit report sizes in SQL before transferring JSON bodies.
- [x] Implement one cumulative operation budget over both snapshots: 15s deadline,
  query limit min(2s, remaining), 1,100 rows, 2 MiB; charge metadata/duplicate reads.
  Check monotonic time after resolved AND rejected continuations; destroy on poison.
- [x] Release the first transaction before independently reacquiring/re-reading
  newest admission plus dependencies. Compare exact canonical projections and
  reverify chain/freshness with current wall clock; never revive prior objects.
- [x] Exercise pool max:1, delayed acquisitions, hanging/rejected/resolved queries,
  event-loop stalls before timer callbacks, shutdown/rollback errors, backward or
  invalid clocks, fresh-read deletions/edits/supersession, exact limits and overflow.
- [x] Verify all failure paths release/destroy once, return redacted codes, and
  never issue INSERT/UPDATE/DELETE/DDL or enqueue rollback after abandonment.
- [x] Run Task 1/2 suites GREEN; independent review and owned-file commit.

### Task 3: Bridge Readiness And Distribution Wiring

**Files:** `scripts/openclaw-local-server.mjs`, `Dockerfile.openclaw`,
`scripts/canary-evidence-wiring.test.mjs`; existing evidence tests if needed.
**Consumes:** readCanaryEvidence and existing buildExecutedReadinessEvidence.
**Produces:** read-only `canaryEvidence` maturity diagnostics and verified canary
proof integrated with existing qualification/audit evidence.

- [x] Write a behavioral VM harness around the actual maturity builder with mocked
  dependencies. Assert the new reader is called with existing pool/revision/key,
  and a verified chain reaches the existing gate. Confirm RED on old wiring.
- [x] Import the reader and obtain the approved v2 policy via getAgentLatencyPolicy.
  Merge canary.evidence ONLY when canary.verified===true; expose bounded safe
  diagnostics separately. No endpoint, tool, payload flag or auth route is added.
- [x] Replace unconditional shadow mode/note with truthful verified-versus-unverified
  state. Verified metric regressions are still blocked by existing thresholds.
- [x] Add Docker COPY entries for both production modules; exclude fixture signers.
- [x] Assert a malicious unverified mock containing a passing evidence.canary is
  ignored, missing storage does not crash readiness, and fleet/audit/qualification/
  delivery blockers remain independent. Pin unchanged approval/auth/dispatch seams.
- [x] Run the behavioral wiring, reader/protocol, existing maturity/evidence/
  qualification/audit/reconciliation suites and Docker closure smoke GREEN.
- [x] Independent task review, fix findings and commit only owned files.

### Task 4: Real Database Proof And Release Documentation

**Files:** `scripts/canary-evidence-postgres.node-test.mjs`, relevant additional
guarded step in `.github/workflows/release-qualification.yml`,
`docs/operations/trusted-canary-evidence.md` and
`docs/operations/2026-11-17-trusted-canary-validation.md`.
**Consumes:** Tasks 1-3; existing targeted-readiness disposable database guard.
**Produces:** actual PostgreSQL snapshot/identity/row-precision/read-only proof,
documented receipt contract, honest local validation and residual limitations.

- [x] Add guarded test-first disposable-DB cases for authentic-chain readback,
  actual microsecond mismatches, other-tenant/deleted/dependency-tampered records,
  latest invalid admission, separate snapshot change detection and no DB writes.
- [x] Run only through the existing authenticated evaluation harness on a fresh
  nondefault/nonprotected TTL branch, with runtime URLs scrubbed. Use a uniquely
  generated empty database as in bounded-census-postgres.node-test; preserve parent
  fingerprints, drop only the verified generated DB and independently verify cleanup.
- [x] Add a separate guarded canary node-test step in Release Qualification; do not
  alter the existing six-suite no-skip assertions, weaken the harness, or deploy.
- [x] Run focused Jest suites, actual Postgres proof, typecheck, production build,
  MCP tests, relevant isolated bridge/founder smokes, CI-hardening/alignment and
  Docker closure. Use Node 22.23.5; record exact pass/fail/skip counts and commands.
- [x] Document missing-producer behavior, schema/counter/digest/signature contract,
  limits, invalid/newest denial rules and the distinction between verified evidence
  and passing canary/readiness. No fixture or evaluation run is live launch proof.
- [ ] Request an independent whole-branch security/behavior review; reproduce and
  resolve findings, rerun affected tests, and leave publication/deployment unperformed.

## Self-Review

Spec sections map to Tasks 1 (authority/schema/metrics), 2 (bounded readback),
3 (readiness/unchanged gates/distribution) and 4 (actual DB/release proof). Every
Review Focus item has an owning test step. All dependency APIs are defined above.
The existing repo requires subagent-driven development; this plan preserves that
workflow rather than offering an incompatible native-only execution path.
