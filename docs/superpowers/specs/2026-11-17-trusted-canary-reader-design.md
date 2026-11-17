# Trusted Canary Evidence Reader

Status: design approved by the founder on 2026-11-17 for local implementation and
tests. Independent builder check completed with no material questions. Reader-only
scope selected. No production changes authorized.

## Intent And Boundary

Connect genuine independent canary evidence to PBK's existing production-readiness
gate. The current bridge passes qualification and operational-audit evidence to
`buildExecutedReadinessEvidence`, but neither store supplies `evidence.canary`.
Consequently the canary remains unverified regardless of census progress.

The founder selected a reader with strict verification in the existing Postgres
eval store. This project does not add a runner, writer, signing API, public upload,
new database, migration, model routing, provider action or experiment. Without
genuine records from a separately reviewed trusted producer, the reader must
continue to report missing evidence. Local positive fixtures are not live proof.

Unknown dispatches remain locked. Authentication, roles, founder/passcode checks,
approval gates, seller contact, delivery retries and production settings are out
of scope and unchanged. No push, PR, deployment or hosted experiment is included.

## Approaches

1. **Selected: strict reader in `pbk_eval_runs`.** Reuse existing storage and the
   bridge's private signing-secret mechanism. Authenticate independent run and
   observation receipts, recompute the comparison inputs, and provide only
   verified facts to the existing gate. This repairs the wiring without claiming
   that an executor or operational evidence already exists.
2. **Reader plus internal runner.** Could also generate new evidence, but requires
   separate decisions about safe version execution, instrumentation, cohort
   admission and trusted producer authority. The founder did not select this.

Caller-supplied aggregate reports, environment pass flags, controlled fixture
metrics and the existing vector-memory canaries are not acceptable substitutes
for independent operational-version comparison.

## Authority Model

The reader consumes only fixed PBK-scoped SQL from `public.pbk_eval_runs`. It
accepts the existing server-owned pool, current revision, secret and wall clock;
request fields and mutable dashboard labels are not authority.

The reserved receipt protocol below defines what a future privileged producer
would have to emit. This change must not implement that producer or mint receipts.
There is currently no live producer for this protocol. Signing proves the trusted
producer's attestation, not independently observed reality beyond its contract;
shipping a future writer requires a separate execution/provenance review. Merely
putting matching labels or unsigned JSON in the eval table cannot pass this reader.

All receipt kinds use schema `pbk-canary-evidence-v1` and domain-separated HMAC
authentication derived in memory from the existing bridge secret. The signed
message binds the kind and every allowed report field. Production code exports no
signing or persistence operation. Test-only fixture signers use explicit fixture
secrets and are never imported by the bridge or included as runtime authority.

The existing `runtime_source_evidence_v1` census is not a canary executor. A full
24-hour operational-coverage requirement remains separate; this reader must not
reuse baseline inventory or quiet monitoring as canary business outcomes.

## Durable Receipt Contract

Use three distinct fixed suite/source identities in the same table:

| Kind | Suite | Source |
| --- | --- | --- |
| Comparison admission | `canary_comparison_v1` | `server:canary-comparison:v1` |
| Independent run | `canary_run_v1` | `server:canary-run:v1` |
| Terminal observation | `canary_observation_v1` | `server:canary-observation:v1` |

All reports have an exact schema, tenant `pbk`, kind, opaque id, revision,
canonical UTC timestamps, an admission timestamp matching the physical row's
microsecond timestamp exactly, and an attestation. Fixed id prefixes followed by
64 lowercase hex characters prevent raw seller/call identifiers in this protocol.
No transcripts, prompts, contact information, addresses, provider payloads or
free-form prose are accepted or returned. Raw identifiers are not report fields.

The comparison admission binds the current candidate revision, a distinct baseline
revision, two distinct run ids and SHA256 digests of the complete persisted run
rows. It also binds the fixed metric-definition version, approved timing-policy
hash, workload/cohort reference and declared terminal status. A pending admission
blocks all older comparisons; the reader never searches for an earlier pass.

Each independently signed run binds its own id and revision, side, same comparison
id, metric-definition version, timing policy and cohort. It lists the complete
admitted observation membership, including errors and fallbacks: opaque ids and
full persisted-row digests, plus the declared admitted count. Maximum membership
is 256 observations per side. Empty, pending, duplicate, missing or oversized
membership is unverified, never truncated into a passing sample.

Each independently signed observation binds its run, comparison, revision,
cohort/workload reference, unique execution reference, observation time, terminal
outcome (`success` or `error`), boolean fallback, boolean behavior pass and finite
nonnegative completion latency in milliseconds. An error cannot claim a behavior
pass. All admitted work must be terminal; cancelled/skipped/pending work does not
silently disappear from denominators or become successful business work.

Both sides must cover the same workload-reference multiset; each individual
execution reference is unique across both sides. Shared observations, shared run
ids, same-revision references, mismatched cohort/policy/metric definitions and
cross-tenant references are unverified. The future producer is responsible for
truthful complete admission and genuine independent execution; this reader does
not invent a workflow to establish that responsibility.

Reports attest `provenance: operational`, `scope: independent_canary_execution`
and real server execution. Synthetic, controlled, diagnostic, preview, dry-run,
same-version-reference and unknown provenance are rejected. Extra contradictory
fields cannot be ignored because schemas are exact.

Physical row tenant, suite, source, id, counters and result must agree with the
authenticated report. A reference digest binds id, tenant, suite, source,
ok/total/passed/failed, exact created-at timestamp and complete report, including
its signature. An altered source row cannot retain its original parent binding.

Admission precedes completion; observation timestamps lie within the respective
run; both runs lie within the comparison's real execution bounds. No timestamp
may be in the future. Every admission, run start and observation must be within
the existing 24-hour evidence freshness window at verification completion.
Newness of the comparison must not refresh old samples. No source timestamp is
rewritten or backdated by this reader.

Detailed field names and normalizing helpers are builder decisions, but the
exact keys and counter meanings must be specified in the module contract and
fixture helpers before test-first implementation. Common counters are total
admitted observations, behavior passes and the remaining behavior failures;
comparison counters describe the two authenticated sides, not a delivery score.

## Metrics And Existing Gate

Do not trust submitted ratios, p95 values or a submitted pass flag. Recompute:

- sampleCount: all declared terminal observations;
- behaviorPassRate: behavior passes / sampleCount;
- errorRate: error outcomes / sampleCount;
- fallbackRate: fallback observations / sampleCount;
- p95LatencyMs: numeric ascending nearest-rank p95, index ceil(0.95*n)-1.

Return the existing `evidence.canary` shape only after the complete chain verifies:
comparison runId/current revision/executedAt/operational provenance and separate
baseline/candidate runIds, revisions, execution times, sample counts and metrics.
Authentication and evaluation are distinct: valid evidence with bad metrics must
remain visible as verified evidence that fails the existing comparison thresholds.
Invalid evidence supplies no passing canary proof.

Keep existing behavior minimum and regression thresholds unchanged in
`buildShadowCanaryComparison`. Keep the behavior, failed-call, silent-error,
coverage, fleet and canary-promotion requirements independent. A canary pass does
not override any other blocker or attest seller delivery. No approved-version
promotion, provider write or dispatch transition occurs in a readiness GET.

## Bounded Read Protocol

One read owns a poisoned 15-second monotonic deadline, including pool acquisition,
queries, both verification passes, rollback/release and fresh readback. Every query
has a maximum two-second wall deadline; enforce server and client limits and reject
late resolved or rejected continuations. Destroy late-acquired or abandoned
clients. No commit/rollback is enqueued behind an abandoned query.

At most 1,100 physical rows and 2 MiB serialized row/projection data may be loaded
across the entire operation, including repeated reads. Individual observations
are at most 2 KiB, run reports 64 KiB and comparisons 8 KiB. Safe diagnostic output
is at most 8 KiB. These are lower, separate reader limits; no existing census,
coverage, query, model-response or speech limits are changed. Any resource failure
returns unverified, not a partial pass.

1. Enter a repeatable-read, read-only transaction on a dedicated pooled client.
2. Select the newest PBK comparison admission by created_at then id, matching
   reserved suite OR reserved source so damaged labels cannot reveal an older
   pass. Use a bounded projection/size admission before transferring report bodies.
3. Authenticate that admission first, then fetch exactly the named runs and their
   bounded observation memberships with fixed parameterized batched SQL. No
   caller SQL, arbitrary source-table access or unbounded historical census.
4. Authenticate row identity, schema, timestamps, signatures, digest bindings,
   completeness, independence and provenance; recompute metrics.
5. Roll back/release the read transaction. On a fresh read-only snapshot under the
   same deadline/budget, reread the newest admission and every named dependency;
   require byte-equivalent canonical physical projections/digests. Recheck final
   clock freshness before returning. Any supersession, modification, deletion,
   timestamp drift, missing dependency or uncertainty fails closed.

No caches survive the operation, no lookup falls back to older admissions, and a
pool/context/storage error returns stable redacted diagnostic codes. Missing
tables or no producer data must not crash ordinary health/readiness routes.

## Integration

Add one bridge-backed reader module following the qualification/audit store
patterns. `buildProductionMaturitySnapshot` calls it with the existing Postgres
pool, current revision, secret and clock; merge only its verified canary proof
alongside existing qualification and audit proof. Surface bounded read-only
diagnostics in the maturity packet, with missing/pending/invalid/stale/superseded
states distinguishable. Remove the unconditional `mode: unverified` label only
when the actual verification state warrants a different label.

Do not add an invoke tool, admin write route, user report upload, client-side
validator, new UI, pass-through caller evidence or bypass flag. Keep Rex in Brain.
Include the new import in the existing Render Docker closure. Update focused
wiring and release tests, not unrelated UI or workflow files.

## Verification And Acceptance

Test-first unit cases must cover a fully authentic fixture and metric regression,
plus missing/pending/newest invalid admission, wrong revision/key/tenant/source,
cross-bound or reused runs/samples, changed/deleted sources, malformed signatures,
extra keys, future/stale timestamps, row-time precision mismatch, mismatched cohort,
omitted errors/fallbacks, duplicate memberships, invalid numeric types/NaN,
oversized reports, cumulative row/byte overflow, pool/query/operation deadlines,
late continuations, fresh-read supersession, rollback/release and unavailable DB.
Positive fixtures contain operational-shaped receipt data only inside isolated
mocks or a guarded disposable evaluation database. Their execution is controlled
test work, not organic evidence; no fixture can enter hosted readiness storage.

Bridge tests prove the reader is actually called, only verified proof reaches the
existing validator, bad metrics stay blocked, other blockers remain in force and
auth/approval/dispatch routes are unchanged. Include Docker import closure and
type/build/MCP/relevant founder gates. Actual PostgreSQL tests, if needed, use
only the existing explicitly guarded disposable evaluation harness; no production
DDL or records. Preserve unrelated work and untracked output.

Acceptance is a locally tested reader and truthful readiness diagnostics, not a
passing production canary. Without an independently reviewed producer and genuine
records, live readiness must remain blocked. Publication, deployment and any
future producer/execution require separate authorization.
