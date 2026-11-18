# Trusted Canary Evidence

## Release Boundary

This is a read-only consumer of `public.pbk_eval_runs`, not a canary executor.
There is currently no live producer for this protocol. Without genuine receipts
from a separately reviewed trusted producer, canary evidence remains missing and
readiness stays blocked. No migration, producer, signing API, upload, runner,
deployment, promotion, or provider action is supplied by this work.

`buildProductionMaturitySnapshot` supplies the existing server-owned Postgres pool,
bridge secret, current build/Render revision, approved v2 latency policy and clock
to `readCanaryEvidence`. Request input cannot replace these dependencies. Only
`verified === true` evidence enters the existing readiness builder. Diagnostics
expose bounded flags/codes and a verified-only comparison ID, never receipt bodies,
keys, connection strings, seller data or private database errors. Rex remains in
Brain; authentication, approvals, dispatch locks, retries and contact are unchanged.

**Verified evidence is not a passing canary or production readiness.** A valid
chain with regressing metrics stays verified and fails existing thresholds. Fleet,
behavior, failed-call qualification, operational-audit/coverage, SLO and promotion
gates remain independent. Census inventory and quiet monitoring are not canary
business outcomes. A signature establishes an attestation under private authority,
not the truth or independence of execution by itself. Signed controlled fixtures,
including this disposable Postgres test, are not real operational provenance and
must never enter actual readiness storage or serve as live launch proof.

## Receipt Schema

Use only the existing receipt table. Physical columns consumed are `id`,
`tenant_id`, `suite_name`, `source`, `ok`, `total`, `passed`, `failed`, `created_at`
and `report` (JSONB). Tenant is exactly `pbk`. Reserved identities are:

| Kind | Suite | Source | ID prefix |
| --- | --- | --- | --- |
| comparison | `canary_comparison_v1` | `server:canary-comparison:v1` | `canary_comparison_` |
| run | `canary_run_v1` | `server:canary-run:v1` | `canary_run_` |
| observation | `canary_observation_v1` | `server:canary-observation:v1` | `canary_observation_` |

An ID is its prefix plus 64 lowercase hex characters. Revisions are lowercase
40-hex commits; digests, cohort/workload/execution references are lowercase 64-hex.
No raw seller IDs, addresses, transcripts, prompts or free-form prose are fields.

Every report has exactly these common keys:

```text
schemaVersion, kind, tenantId, id, revision, admittedAt, startedAt, completedAt,
status, provenance, scope, executed, metricVersion, policyHash, cohortRef, attestation
```

Values: `schemaVersion: 'pbk-canary-evidence-v1'`,
`metricVersion: 'pbk-canary-metrics-v1'`, `provenance: 'operational'`,
`scope: 'independent_canary_execution'`, `executed: true`, `status: 'complete'`.
`policyHash` must equal the server's approved v2 policy hash; no pilot or legacy
policy fallback is authority. Exact additional keys per kind:

- Comparison: `baseline, candidate`, each exactly `{id, digest, revision}`.
  Candidate revision is current; baseline revision differs; run IDs differ.
- Run: `side, comparisonId, admittedCount, observations`. Side is `baseline` or
  `candidate`; membership is a sorted, unique array of exactly `{id,digest}`.
  `admittedCount` equals membership length and is 1 through 256.
- Observation: `comparisonId, runId, executionRef, workloadRef, outcome, fallback,
  behaviorPassed, latencyMs`. Outcome is `success` or `error`; flags are boolean;
  error requires `behaviorPassed: false`. Latency is a finite number from zero
  through that observation's elapsed wall time in milliseconds.

Pending comparison/run receipts use `status: 'pending'`, `executed: false`,
`completedAt: null`; comparison side refs may be null. They are authenticated as
pending schemas and only deny evidence. Pending runs may have zero membership.
No extra field, coercion, accessor, proxy, abnormal prototype, cycle or contradictory
provenance flag is accepted.

`admittedAt` is canonical six-digit UTC (`YYYY-MM-DDTHH:mm:ss.ffffffZ`) and must
equal physical `created_at` to the microsecond. `startedAt`/`completedAt` are
canonical three-digit UTC. Starts precede completions; admissions are no later
than completion; run bounds/admissions lie within the comparison and observations
within their run. All admissions, starts and completions must be fresh within
24 hours and not future, checked again at operation completion. A new comparison
does not refresh old source timestamps.

## Authentication And Counters

`attestation` has exactly `{version: 'pbk-canary-evidence-v1', signature: <64-hex>}`.
The private key is HMAC-SHA256(existing server secret,
`pbk.canary-evidence.signing-key.v1`). Authenticate the UTF-8 message
`schemaVersion + '\n' + canonicalJson(report without attestation)` with that key
using HMAC-SHA256. Use the existing canonical JSON implementation; do not substitute
ordinary JSON serialization. Signatures are constant-time compared. Production
modules export no signing operation; the signer is test-only and not Docker runtime
authority. Never print keys or signatures in operational troubleshooting.

`canaryRowDigest` is lowercase SHA256 of canonical JSON of exactly this physical
projection, including the report's signature:

```text
id, tenant_id, suite_name, source, ok, total, passed, failed, created_at_exact, report
```

`created_at_exact` comes from SQL UTC `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
not a JavaScript Date round-trip. Run refs bind full observation rows; comparison
refs bind full run rows. Same cohort/policy/metric, matched workload multisets,
unique executions across both sides and no run/observation reuse are required.

Counters are physical receipt consistency checks, not regression thresholds:

| Kind | total | passed | failed | ok |
| --- | --- | --- | --- | --- |
| observation | 1 | behaviorPassed ? 1 : 0 | 1 - passed | passed === 1 |
| run | admittedCount | behavior passes | total - passed | failed === 0 |
| comparison | 2 | runs with zero behavior failures | 2 - passed | failed === 0 |

All counters are nonnegative safe integers and must agree with authenticated
membership. All admitted terminal work, including errors and fallbacks, remains in
the denominator. Recompute sample count, behavior pass rate, error rate, fallback
rate and numeric ascending nearest-rank p95 at `ceil(0.95*n)-1`. Do not trust submitted
ratios, p95 or pass flags. Thresholds remain owned by the unchanged readiness gate.

## Bounded Read And Denials

One operation has a poisoned 15-second monotonic deadline, including acquisition,
two repeatable-read/read-only snapshots, verification, rollback/release and final
freshness. Each query has at most 2 seconds with server/client limits. Late or
abandoned clients are destroyed; no stale snapshot/cache or queued rollback may
resurrect a poisoned operation.

The reader owns the checked-out client's `error` channel from the native pool
checkout callback, before promise continuations or query dispatch. A client event
poisons the operation as unavailable, cancels its active bounded wait and destroys
the lease once; no rollback is queued behind that query. Normal release hands
error ownership back to the pool's idle listener before removing the reader's
listener. Destroyed, failed-release and late-acquired clients retain a retired
listener for late driver events, detached from operation state. Pool-level idle
error handling remains the server pool's responsibility. No global exception
handler or retry is installed.

| Limit | Value |
| --- | --- |
| Observations per side | 256 |
| Cumulative returned rows, including both snapshots/control rows | 1,100 |
| Cumulative serialized projection/envelope bytes, including both snapshots | 2 MiB (2,097,152) |
| Observation report | 2 KiB (2,048) |
| Run report | 64 KiB (65,536) |
| Comparison report / diagnostics | 8 KiB (8,192) each |
| Freshness | 24 hours (86,400,000 ms) |

Select newest PBK comparison by `created_at DESC, id DESC`, matching reserved
suite **OR** source. Selection precedes size admission: a poisoned newest row
cannot disappear behind a size filter to reveal an older pass. Dependencies are
fixed parameterized ID batches, never a historical fallback search.

SQL measures the entire `row_to_json` physical envelope, JSONB report text,
escaping/whitespace and envelope size metadata before transfer. The **whole batch**
must fit remaining cumulative byte/row and report limits, or SQL returns a single
capped size-only envelope with `physical: null`; no oversized source/report field
is transferred. JavaScript validates numeric sizes, charges textual overhead lost
in parsing, authenticates rows and then independently rereads the same chain.
Changing newest identity or any dependency across snapshots denies all proof.

| Reader result | Meaning |
| --- | --- |
| `canary_evidence_verified` | Authentic, bounded, fresh chain; metrics still evaluated separately |
| `canary_evidence_missing` | No reserved PBK admission / no producer data |
| `canary_evidence_pending` | Authenticated incomplete newest comparison/run |
| `canary_evidence_invalid` | Schema, key/signature, identity, membership, counter, policy or digest mismatch |
| `canary_evidence_stale` / `canary_evidence_future` | Source timestamp outside allowed window |
| `canary_evidence_superseded` | Independently reread admission/dependency identity changed |
| `canary_evidence_limit_exceeded` | Report, cumulative row/byte or structural budget exceeded |
| `canary_evidence_timeout` | Query/operation monotonic deadline poisoned |
| `canary_evidence_unavailable` | Storage/acquisition/query failure, including absent table |

Every denial returns `verified: false`, `readbackVerified: false`, `runId: null`
and empty evidence with a redacted code. It does not mean a measured behavioral
regression. A valid but failing comparison returns verified metrics instead.
Newest invalid/pending/different-revision admissions hide older passing records;
other-tenant rows cannot supply PBK dependencies. Missing storage does not create it.

## Guarded Proof And Maintenance

The additional Release Qualification step runs only
`node --test scripts/canary-evidence-postgres.node-test.mjs` through the existing
`neon-evaluation-harness.mjs`, `--ttl-hours 1`, prefix
`pbk-eval-targeted-readiness-canary-`. Original six-suite no-skip assertions are
unchanged. Never use `--inject-runtime-db`, dry-run or name filtering for actual
Postgres proof. Keep injected `PBK_TEST_DATABASE_URL`/`PBK_EVAL_DATABASE_URL` in the
guarded child; scrub runtime database URLs only. The guard authenticates fresh
nondefault/nonprotected branch identity and matching endpoint before any DDL.

The test creates one uniquely generated empty `pbk_canary_<32-hex>` database,
preserves inherited protected-table fingerprints, executes unmodified reader SQL,
drops only that generated DB and checks `pg_database` absence. The harness deletes
its branch. Local validation additionally performs authenticated independent branch
GET and requires 404, without logging URI/secret. See the dated validation record
for commands and exact counts. These are controlled algorithm/storage tests only.

The Task 3 wiring suite pins SHA256 over the LF-normalized **whole bridge outside**
`buildProductionMaturitySnapshot` and the reader import. It is intentionally broad:
an unrelated legitimate bridge edit will invalidate the pin. To refresh it:

1. Review the complete bridge diff against the previously reviewed commit; enumerate
   every outside-builder change, with explicit auth/approval/dispatch/contact impact.
2. Reproduce the wiring-suite failure. Independently review that diff before accepting
   a new hash; do not replace the pin merely to silence a failure.
3. Recompute using the exact extraction/normalization in the wiring test, record old
   and new hashes and reviewed base/target commits in the change's validation receipt.
4. Update the expectation in that separately scoped change, rerun wiring and affected
   safety tests plus serial isolated bridge smokes. No global warning suppression or
   safety-boundary relaxation is an acceptable substitute.

For Node 22 Jest/VM runs, only `ExperimentalWarning: VM Modules is an experimental
feature and might change at any time` (and its standard trace-warnings hint) is an
expected test-environment warning. Classify it narrowly; retain stderr and investigate
every different warning. Do not set `NODE_NO_WARNINGS`, `--no-warnings`, or disable
all `ExperimentalWarning`s. No warning suppression is added by this work.
