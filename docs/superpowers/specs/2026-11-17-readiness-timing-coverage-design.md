# Readiness Timing And Coverage Design

Status: approved by the founder for local build and testing on 2026-11-17,
including the pilot targets and collection cadence. Builder review found no
important open questions. This document is not
authorization to publish, merge, deploy, change production configuration, or start
production collection.

## Intent And Decisions

Repair the timing-policy and collection-coverage gaps in PBK's existing readiness
path. Fast starts should be measured separately from completing a long answer or
speaking it. Coverage must represent actual monitored time, not healthy counters
or manufactured historical activity.

The founder selected length-aware completion targets over fixed total-completion
targets. The proposal below also reuses the existing Postgres evidence store,
bridge runtime, protected readiness routes, and approval system. Numerical pilot
targets and collection cadence below were proposed as engineering pilot settings
and approved for this local build, not claimed production benchmarks.

### Approaches

1. Fixed completion matrix: minimal change to the current validator, but treats
   a useful long explanation like an equally slow short reply. Not selected.
2. Length-aware scoring plus signed forward-only collection evidence: selected
   timing approach; recommended coverage implementation. Adds trusted output-size
   and interval evidence without adding an application or monitoring service.
3. A separate monitoring provider was considered but not recommended: it adds
   credentials and a parallel source of truth without fixing PBK provenance.

This is a bounded backend project, not just an environment-variable change. It
includes policy validation, measurement adapters, durable proof, audit reader
compatibility, runtime lifecycle integration, and safety regression coverage.

## Existing Evidence And Boundaries

PR #17 is deployed at a17e2c371a7b04b6c0c4a35abf936445e04db16f. Its targeted
migration and 44-case controlled qualification passed. Database security passed
for all 22 required tables. Production readiness correctly remains blocked.

Current code:

- `agent-latency-policy.mjs` supports only positive fixed millisecond values and
  supplies only the existing 1800 ms chat/phone first-token default.
- `agent-registry.mjs` groups latency by channel/milestone and enforces missing
  milestones, provenance, freshness, source context, and sample requirements.
- `agent-fleet-measurement.mjs` collects state-backed execution records; it must
  not turn missing or legacy observations into zero or into new timestamps.
- The registered-agent execution path does not forward channel/milestone timing.
  The AgentOps mirror trusts a metadata timing shape; that shape alone is not
  sufficient authority for a new output-size-dependent readiness decision.
- `operational-audit-collector.mjs` deliberately returns unverified retrospective
  coverage and monitoring continuity. Existing rows cannot establish universal
  fixture exclusion or continuous collection.
- Runtime archive writes, QA/safety writes, conversation projection, and the
  existing `pbk_eval_runs` store provide integration points; no new database or
  broad schema migration is required.

Build from current `origin/main`; the independent Analyzer changes merged after
PR #17 must be preserved. No UI redesign or Analyzer behavior change is in scope.

## Non-Negotiable Safety

- Keep all six unknown dispatches locked and all four original dead letters open
  unless separately authorized, evidence-bound resolution becomes possible.
- Do not change authentication, SSO, passcodes, roles, RLS, grants, approval
  decisions, MAO authority, provider-send permissions, or retry behavior.
- No seller calls, messages, delivery attempts/retries, event replays, historical
  memory execution/backfill, or synthetic operating history.
- Do not weaken data-freshness, organic work, minimum-sample, canary, projection,
  provider delivery, or memory-verification gates to make readiness green.
- Timing policy never aborts generation, stops playback, truncates text, changes
  model token limits, or changes existing request/transport deadlines.
- Tests and diagnostics remain controlled; they cannot become operational fleet
  samples. A monitoring checkpoint is monitoring evidence, not business work.
- Reuse the existing PBK signing secret through domain-separated keys. Never
  persist raw text, audio, seller identity/contact data, tokens, or credentials in
  new evidence records. Store counts, fixed classifications, and opaque bindings.

## Length-Aware Timing

### Policy Contract

Extend the existing policy module with a versioned opt-in JSON policy, proposed
environment name `PBK_AGENT_LATENCY_POLICY_V2`. The old numeric matrix remains
parseable for legacy callers, but cannot satisfy the new length-aware bridge
qualification contract. A present invalid v2 policy must not fall back to v1.
Missing/incomplete policy continues to block production qualification.

Use a canonical policy hash and explicit schema version in new measurements.
Changing a policy must not silently requalify old records: new readiness samples
must match the active policy hash, measurement schema, revision, and source.
Document a complete non-secret pilot profile; do not configure production in
this build. Pure legacy unit/API consumers can keep their fixed-policy behavior.

Proposed initial measurement targets:

| Channel / milestone | Pilot target |
| --- | --- |
| Chat / first content token | 1800 ms |
| Phone / first content token | 1800 ms |
| Chat and phone / model completion | 3000 ms + 20 ms per actual output code point |
| Phone / first outbound speech media | 2500 ms |
| Phone / final outbound speech media | 2500 ms + 1.10 x actual media duration + 2000 ms |
| Research / completion | 120000 ms + 20 ms per actual output code point |
| Non-generative provider/internal task / completion | 30000 ms |

These are proposed pilot SLOs, not evidence of current speed. They preserve the
existing first-token goal and give longer output an explicit allowance. Provider
task completion is not generative length and stays fixed; it is not delivery proof.
Every value, formula parameter and unit must be explicit and validated. Reject
unknown keys, nonfinite/negative values, arithmetic overflow, mixed versions, and
ambiguous units. Validation bounds protect accounting, not output generation.

### Measurements And Scoring

All elapsed milestones use a monotonic server clock and an explicitly identified
start origin. Text first token/completion are relative to the accepted turn's
start. Speech first/final media use that same turn origin; media duration is a
separate measured quantity. Do not compare differently based clocks.

Count Unicode code points in the actual final generated answer, not in prompts,
serialized metadata, tool dumps, client estimates, or an intended token maximum.
For research, count the final answer rather than fetched documents. Empty,
cancelled, failed, partial, or missing output cannot establish successful completion.
Do not retain answer content in new evidence.

Measure phone media duration from the supported transport's actual audio format,
byte/frame counts, and sample rate. Do not estimate it from text or from elapsed
time. A browser playback report remains client-reported, not verified phone
evidence. Final server media transmission does not claim the seller heard it.
If trustworthy duration or a milestone is unavailable, leave it unverified.

For variable targets, calculate each distinct run's elapsed/allowed ratio and
compare p95 of those per-run ratios to 1. Keep raw elapsed p95 and sample counts
for diagnosis. Do not compare p95 elapsed against p95 lengths/budgets. Duplicate
milestones for one run are not new samples; retain the conservative result and
reject conflicting length bindings. Never clamp a slow value into a pass.

### Trusted Wiring

Measurement adapters determine channel from the actual server entry path and
handler semantics, not a caller's `channel`, `operational`, `source`, `timings`, or
output-length claim. Use explicit adapters for operator chat, telephony,
registered research/advisory work, and non-generative internal/provider work.
Ambiguous routes retain unknown channel and stay unqualified.

Bind new measurement evidence to the actual completed work order/request, agent,
policy hash, revision, time, result status, output count, and optional media
duration. Attest it using a separate HMAC domain. Verify that binding when
collecting and scoring; copied/edited/cross-workspace evidence must fail closed.
Do not accept an attestation or signing parameters from a public tool payload.

Keep existing controlled-execution isolation authoritative. A trusted meter must
classify fixed tests, previews, status/health work, diagnostics and cancelled work
as non-operational even if their payload claims otherwise. Legacy records remain
diagnostic; do not rewrite their source, timestamps, channel, or success status.

Forward only actually captured milestones through registered execution and the
AgentOps mirror. Missing first-token or speech timing cannot be reconstructed from
handler return time. Adding budgets alone must not qualify unmeasured agents.
If no authorized phone activity occurs, phone operating evidence stays missing.

## Forward-Only Coverage

### Storage And Collector

Use bounded, domain-signed monitoring/checkpoint records in existing PBK-scoped
`pbk_eval_runs`, separate suite/source namespaces from qualification and audit.
They must not appear as passing test suites or successful operational agent work.
No new provider or database is introduced, and existing rows are not rewritten.

Proposed sampling policy: one interval every 60 seconds, maximum accepted interval
gap 90 seconds, a 24-hour rolling window, and at most 2000 checkpoint rows per
verification. All are policy-version/hash bound. This proves sampled collection
coverage at that cadence, not perfect per-millisecond service uptime.

Start only after the existing bridge's Postgres bootstrap is ready. Do not start
in local/controlled test execution. The sampler invokes fixed read-only source
queries and health checks; it never invokes agents, approvals, provider handlers,
delivery queues, or seller contact tools. Its only writes are evidence receipts.
Use bounded transactions, pooled-client release, query/overall deadlines, and a
PBK-scoped advisory lease/fencing rule so replicas cannot fabricate parallel coverage.

Bind every checkpoint to revision, instrumentation/policy versions, boot identity,
sequence, previous-record binding, actual server/DB clocks, observed bounds,
source schema/health state, fixed aggregate counts and source fingerprints. Domain
separate source identity and report signatures. A signature proves collector
origin/integrity, not that every possible failure in the world was observable.

The first checkpoint establishes collection start, not preceding coverage. A new
revision/boot, missing interval, bad clock, failed query/write, stale lease,
duplicate/conflicting sequence, tampered or oversized row breaks coverage. Start
a new forward segment; never bridge a gap using a current healthy probe. Initial
implementation does not carry coverage across process restarts or revisions.

Stop/clean up the sampler on shutdown, and avoid overlapping interval jobs.
Record errors through existing diagnostics without creating a notification lane.
Publication/restart does not automatically create 24 hours of history.

### Source Provenance

Support the fixed archive, conversation projection, QA and safety source writers.
Attach or pair source-bound evidence only at authoritative server write boundaries
after successful durable writes. Use server-owned execution context to distinguish
operational, controlled/diagnostic, and unknown origins. Caller labels and a row's
plain `source` string are not authoritative proof of organic work.

Evidence must bind the fields actually audited, original source identity, trusted
recorded/observed time and outcome. Mutated sources invalidate their old bindings.
Do not add raw content to evidence or alter historical source rows to bless them.
Missing authority or receipt persistence becomes an explicit evidence gap, not a
business operation falsely reported as failed or successfully monitored.

Fixed coverage reads must account for all PBK rows in scope, including unknown
and controlled rows, and retain known failures. Unknown provenance is not silently
excluded. Controlled data can be excluded only with trusted source-bound evidence.
Late arrivals/backdated business timestamps cannot escape classification by age:
use trusted recording time and a fresh census of the requested window at audit.
Changed counts/fingerprints, schema gaps, deleted receipts and incomplete reads
invalidate proof. The builder must not infer completeness from MAX(timestamp).

Existing unknown dispatch/dead-letter findings are still checked across their
full unresolved lifetime. Coverage never reclassifies them as delivered, resolved,
fixtures, or too old to matter. No writes to those records are required here.

### Audit Integration

Introduce a versioned audit proof contract carrying signed coverage references,
policy/instrumentation identity, segment boundaries and per-source verification.
Keep existing audit check IDs, founder-only fixed runners and protected read routes.
The reader must validate coverage proof against its durable source receipts and
audit cutoff; never trust a caller or a signed Boolean alone.

The audit closes/verifies a fresh current sampling boundary at its own cutoff
without backfilling missing intervals. Keep collection time distinct from the
observed interval end; stored/DB clocks must validate both. A current boundary can
close only the pending interval within the maximum gap, never a historic gap.

Read old audit versions as legacy diagnostics. Across legacy/new records, the
newest admission wins, even if pending, invalid or failed; do not filter for an
older success. Never mutate old signed records. Do not weaken fixed duration,
freshness, signature, aggregate-schema or PBK tenant checks.

After full verified coverage and complete provenance, a quiet source window can
report no findings with zero observations. Label it as an observed quiet window,
not as completed business work, delivery validation or organic fleet samples.
Unknown/legacy rows in the window remain unverified until genuine new evidence
exists or they naturally leave the rolling window; old unresolved failures do not.
Heartbeat records themselves are excluded from business-event counts.

Coverage may become independently verified while audit readiness remains false.
Readiness still needs every existing audit check, actual operational fleet
samples, memory evidence and independent shadow/canary comparisons. Do not remove
unmet criteria just because they cannot be collected without seller activity.

## Integration And Verification

Expected ownership boundaries:

- Policy validation/scoring and fleet collection: existing latency policy,
  registry, fleet evidence and timing helpers; a small shared evidence helper if
  needed for actual trust boundaries, not parallel client logic.
- Coverage persistence/reader and sampler: focused new helper modules using the
  existing eval store and lifecycle; no schema/bootstrap migration.
- Archive/QA/safety/projector adapters: existing source writers only.
- Audit collector/store and bridge snapshots: versioned proof and honest status.
- Docker import closure, existing CI, environment example and runbook: complete
  packaging and non-secret explicit activation documentation.

Regression proof must include length-aware long/short outputs, percentile pairing,
Unicode/count bounds, cancellation, forged length/channel/timing, missing audio,
legacy and controlled exclusion, request-to-work-order binding, source mutation,
coverage startup/restart/gaps/multiple replicas, clock jumps, stale/tampered/deleted
proof, full-window quiet/active sources, late arrivals, and newest-pending denial.
Assertions must retain all unknown-dispatch, auth, approval and no-contact guards.

Use deterministic clocks and synthetic sources in isolated tests only. Real
Postgres evaluation uses the existing guarded disposable branch harness; never
reset or create fixture data in production. Full-day fixture tests prove logic,
not a production observation period. Require independent security review, focused
tests, full unit coverage, typecheck/lint/build, import closure and isolated bridge
smokes before handing the branch over.

## Release And Builder Discretion

This phase is design then local implementation/test after founder approval.
Push/PR, merge, deploy, configuring the numerical production policy and enabling
live collection are separate explicitly authorized release steps. Preserve SSO,
approval/dispatch fingerprints and no-contact settings on any future rollout.

The builder may choose helper names, bounded batch sizes below stated maxima,
equivalent lease implementation, and focused test organization. The builder may
not choose weaker evidence, different pilot SLOs, retrospective coverage,
additional infrastructure or provider/seller actions without renewed review.

Expected honest completion: the code can collect and verify new evidence, but
production stays blocked until it has a real full-day segment and the remaining
business/canary/delivery evidence. No immediate global green status is promised.
