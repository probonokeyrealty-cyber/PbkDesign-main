# Bounded Census Repair

Status: founder approved local implementation and tests on 2026-11-17. The
paged-census/change-journal approach and detailed design are approved. No production
migration, publication, deployment, or production data repair is authorized.

## Intent And Evidence

Allow the existing hosted coverage sampler to observe the entire PBK source
inventory without loading all historical source bodies into one operation.
Preserve history and truthful readiness; this is not an outreach or dispatch fix.

Read-only production diagnostics on 2026-11-17 found 112693 matching runtime
archive records with 102213520 projected bytes. The current all-source census
exceeds its 10000-row / 16777216-byte bounds; one attempt also exceeded the
2000-ms query fence. Coverage is enabled but has no completed checkpoints.
The approved v2 timing policy is live and controlled qualification passed 44/44.
Those facts do not establish operational coverage or launch readiness.

## Selected Approach

The founder selected paged census with signed manifests and transactional change
tracking. Database-maintained digest buckets were considered but not selected:
they reduce application reads at the cost of putting more aggregation and
verification logic into source-write SQL.

Do not implement timestamp filtering, a bare LIMIT, arbitrary oldest-row
exclusion, longer deadlines, or increased resource limits. A page is part of an
inventory, never a complete inventory by itself.

## Scope And Non-Goals

Extend the existing runtime-source evidence, coverage sampler/store, operational
audit, and readiness readers. Keep the Electron/dashboard and Slack-first lanes.
No UI redesign, new external service, provider key, or parallel monitor.

Unknown dispatches remain locked. Authentication, approval decisions, provider
write controls, and existing business records remain unchanged. No seller contact,
delivery retries, event replay, historical memory backfill, or source deletion.
The four original dead-letter records are not resolved by monitoring changes.

Build and tests are local/disposable only. Production migration and rollout need
separate authorization after review and CI.

## Hard Resource And Time Bounds

- Preserve 10000 loaded source/proof observations and 16 MiB total per operation,
  across all pages, kinds, and dependencies combined; never reset the budget per
  page or nested call.
- Preserve 8192-byte proof-report bounds, 2000-ms per-query limits, and the shared
  15000-ms coverage-operation fence through acquisition, commit, and readback.
- Preserve 60000-ms sampling, 90000-ms maximum gaps, the genuine rolling 24-hour
  window, and at most 2000 coverage checkpoints loaded by the current verifier.
- Pages may be smaller than these bounds. Preflight row/byte admission before
  materializing payloads; an individually oversized row remains a blocker.
- Bootstrap may span many bounded operations, but cannot manufacture earlier
  coverage. An excessive change backlog blocks a checkpoint rather than widening
  its budget or silently dropping work.

## Storage And Journal

Use the existing Postgres runtime boundary. A narrowly targeted, transactional,
idempotent migration introduces the necessary internal census/journal structures
and indexes. No credentials, roles, grants, policies, or approval settings are
changed. Existing RLS protections must be preserved for existing objects; new
objects must have an explicit, reviewed security contract and must not be exposed
to public/anonymous roles.

Capture mutations transactionally for the four existing fixed source projections:
runtime archive, conversation projection, QA, and safety. Capture inserts,
updates, identity changes, and deletes, including changes made outside bridge
helpers. Rollback must roll back the corresponding journal mutation.

The journal stores only internal opaque identities/bindings, operation kinds and
integrity metadata, not source bodies, prompts, responses, seller identifiers,
contact details, audio, credentials, or private tuple versions. Its chain/control
must detect missing, changed, duplicated, or reordered entries; an unkeyed content
digest alone is not sufficient provenance or authenticated completeness.

Journal entries are observation evidence only. They cannot mint organic success
or replace actual writer RETURNING/xmin-bound, one-use operational receipts.
Reuse existing signing material with distinct version/domain separation.

No source or historical proof deletion is part of this repair. Retain historical
segments and references without loading the full history into current operations.

## Bootstrap And Closure

1. Verify the exact migration/instrumentation and journal installation boundary.
   A missing trigger, missing journal dependency, or invalid chain blocks admission.
2. Start a server-owned bootstrap generation and scan the fixed source kinds with
   deterministic keyset pages. Persist immutable signed page proofs and a bounded
   resumable cursor. Bind each page to its tenant, generation, source kind,
   identity range, counts, content binding and predecessor.
3. Track all concurrent changes from the verified journal boundary, including
   inserts behind the cursor, updates to already scanned rows, primary-key changes
   and deletions. Reconcile them under the same bounded operation contracts.
4. Close the baseline only at a proven database-consistent boundary after every
   required page and every committed change through that boundary is accounted for.
   Never use MAX(sequence) as a commit watermark: a transaction can allocate an
   earlier sequence and commit later. The implementation must prove commit-aware
   closure and test that exact race.
5. Seal a complete manifest root with bounded hierarchical segment references.
   Incomplete, overlapping, missing, substituted, or cross-generation pages cannot
   close the baseline. Reader and writer must independently reconstruct bindings.
6. Establish the forward coverage anchor only after closure/readback. Historical
   rows start as unknown; completing bootstrap does not turn them into organic
   work, successful deliveries, or a preceding day of uptime.

This is a versioned completeness protocol, not a reinterpretation of v1's
whole-source cap. Legacy v1 overflow and tamper denials remain regression tests.
The larger logical inventory is represented by complete authenticated segments;
no single operation materializes the larger inventory.

## Ongoing Coverage And Readback

Consume bounded committed journal changes to update the inventory root, preserving
tombstones and previous bindings. Verify journal completeness, installation
integrity, lease ownership, all six actual health signals and approval mode before
closing each checkpoint. Source/root advancement and checkpoint/control completion
must commit atomically; read back independently before reporting success.

Missing/failed work remains pending and blocks fallback to an older pass. A gap,
lease loss, clock failure, reboot or revision change cannot inherit a preceding
24-hour window. Bootstrap progress itself is not monitoring continuity.

Bind new coverage and audit references to the census protocol version,
instrumentation version and closed manifest root. Readback must verify every
required segment/journal dependency through bounded authenticated summaries and
explicit completeness checks. A cached Boolean or root trusted without its
authenticated dependencies is not evidence.

Keep controlled fixtures, diagnostic activity and unknown history separate from
organic measurements. Coverage, qualification, timing targets, canaries, memory,
unresolved dispatches and dead letters remain independent readiness gates.

## Verification And Acceptance

Test-first local regressions must include:

- At least 112693 source rows and more than 102213520 projected bytes, processed
  across bounded operations without source/history deletion or a larger budget.
- Cumulative row/byte bounds across pages and kinds; oversized single rows;
  acquisition/query/commit/readback timeout; no late continuation after abort.
- Concurrent insert/update/delete/identity changes, inserts behind the keyset
  cursor, transaction rollback, out-of-order commits and an open old transaction
  at baseline/journal closure. No missed mutation may produce a complete manifest.
- Missing/reordered/duplicated/tampered pages, cursors, manifests, journal entries,
  trigger installation, leases and dependencies; cross-tenant/revision/generation
  substitution and stale proof fallback must fail closed.
- Real persisted forward checkpoints and genuine algorithmic 24-hour fixtures,
  with first-anchor, reboot, gap, clock and historical-reference denials retained.
  Virtual-clock fixtures are not production operating history.
- No raw sensitive content or signing material in proof, reports or logs.
- Before/after fingerprints of approvals, dispatches, dead letters, calls,
  messages and contracts; no provider delivery/approval actions in tests.

Use existing PGlite fixtures and guarded disposable actual Postgres qualification,
including migration idempotence, SQL security, transaction concurrency and cleanup.
Do not point test DDL at production or weaken evaluation-target guards.

Run the existing source-evidence, coverage, audit, qualification, approval and
packaging regressions, supported Node 22 typecheck/lint/build and relevant isolated
bridge smokes. Independent security review must cover completeness, transaction
closure and privacy before publication is proposed.

## Decisions Left To Implementation

Exact table/index names, bounded page sizing, commit-aware closure mechanism,
manifest tree shape and journal integrity representation require testable proofs
during implementation. None may weaken the constraints above. If they require a
different security contract or cannot close under the existing budgets, stop for
design review rather than silently narrowing the evidence claim.
