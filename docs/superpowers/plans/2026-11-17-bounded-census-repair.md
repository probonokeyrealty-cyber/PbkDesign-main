# Bounded Census Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track each test-first task below.

**Goal:** Collect prospective coverage over a large retained inventory with bounded pages, authenticated completeness and transactionally ordered mutation tracking.

**Architecture:** Keep the legacy whole-source v1 contract unchanged. Introduce an explicitly opted-in paged-v2 source protocol, backed by a targeted migration, serial transactional journal, signed bootstrap state and immutable hierarchical manifest proofs. Coverage and audit use protocol-bound source roots and bounded interval journal witnesses; no history becomes organic evidence during bootstrap.

**Tech Stack:** Existing Node 22 ESM, PostgreSQL, PGlite, Jest/node:test, HMAC-SHA256, existing PBK pool/fence/runtime seams.

**Spec:** `docs/superpowers/specs/2026-11-17-bounded-census-repair-design.md`.

## Global Constraints

- Local/disposable only; no push, deployment, production SQL, provider calls, messages, delivery retries, approval decisions or dispatch unlocks.
- Preserve 10000 total loaded observations / 16777216 bytes per operation; 8192-byte proof reports; shared 15000-ms operation and 2000-ms query fences.
- Preserve 60000-ms samples, 90000-ms gaps, 86400000-ms genuine window and 2000 checkpoint verification bound.
- No source/history deletion, timestamp-based exclusion or limit-only completeness claims.
- Keep auth/approval gates unchanged; new SQL objects owner-only with explicit RLS; no new credentials or roles.
- Use a global PBK journal head row updated transactionally by fixed AFTER source triggers. No nontransactional sequence watermark. Updating the head serializes source mutation commits; rollback removes journal advancement and entries.
- Journal contains opaque SHA-256 references and projection digests, never bodies or tuple versions. Existing operational RETURNING/xmin receipts remain separate authority; bootstrap/journal observations remain unknown absent independently verified actual-writer proof.
- Repeatable-read page snapshots bind their observed journal head. A row observed at head H cannot be overwritten by catch-up entries <=H. Inserts behind cursors, old/new keys and deletes are journaled.
- Versioned immutable proof nodes have database-generated body digests so bounded metadata readback detects missing/changed nodes without materializing all historical leaf bodies. Signed parent references bind child identities, digests, counts and ranges. Mutable indexes are caches, never proof authority.

## Review Focus

1. Old transactions allocating work before a boundary and committing later: transactional head lock and actual-PG concurrency tests.
2. Mutation behind a keyset cursor and identity changes: SQL journal plus bootstrap/catch-up tests.
3. Tampered cache versus authoritative proof: validate touched bucket against signed leaf state; missing signed dependency blocks every read.
4. Cumulative budgets hidden by pagination or metadata queries: one poisonable operation fence and budget object shared through commit/readback.
5. Quiet monitoring mistaken for business success: all historical bootstrap rows unknown, no organic promotion; qualification/readiness gates independent.

## Task 1: Transactional Journal And Targeted Migration

Files: create `scripts/migrations/20261117-bounded-census.sql`,
`scripts/bounded-census-migration.mjs`, `scripts/bounded-census-schema.test.mjs`.

Interfaces: SQL tables `pbk_runtime_census_head`, `pbk_runtime_census_journal`,
`pbk_runtime_census_state`, `pbk_runtime_census_entries`, `pbk_runtime_census_proofs`.
Expose fixed SQL functions for identity/projection digest, bounded page reads and
installation verification. Exact SQL contracts are recorded alongside migration.
Head has `epoch`, `sequence`, `chain_hash`. Journal has contiguous transactional
`sequence`, `source_kind`, old/new opaque refs, digest, presence/outcome/clock and
previous/current chain hash. An identity change may use two ordered journal entries.

- [x] Write schema tests first: DDL security/idempotence, fixed source projections, insert/update/delete/key/scope changes, rollback, generated digest, no raw proof fields.
- [x] Observe RED on missing migration, then implement SQL and explicit-target/checksum-guarded migration runner (no ambient production URL fallback).
- [x] Run PGlite tests and owned lint; actual concurrent commit behavior is mandatory in Task 5.

## Task 2: Paged Census And Authenticated Manifest Store

Files: create `scripts/runtime-paged-census.mjs`, `scripts/runtime-paged-census.test.mjs`.

Interfaces: `preparePagedCensusObservation({client,secret,revision,now,fence})`,
`collectPagedCensusSnapshotInTransaction({client,secret,revision,now,windowStart,windowEnd,fence,admission})`,
`readPagedCensusIntervalRoots({client,secret,revision,reports,fence})`.
The snapshot is versioned and includes inventory/coverage/sources aggregate shapes
compatible with the coverage/audit consumer, plus a signed manifest reference;
never substitute empty row arrays for real v1 source completeness.

- [x] RED: complete large retained inventory via bounded pages, no completed snapshot during bootstrap, stale/cross-bound state rejection.
- [x] Implement signed resumable generation, fixed-kind keyset pages, per-row observed-head versions, transactional catch-up and closure; no MAX(sequence) approximation.
- [x] Implement <=8192-byte immutable leaf/branch/root manifests, authenticated dependencies and bounded independent readback. Prefer small leaf pages and 16-way branches; verify generated digest and exact installed functions/columns.
- [x] RED/GREEN: holes, tampering, duplicate/range overlap, cache poisoning, deleted nodes, partial journal, post-close edits, behind-cursor inserts, deletes and cumulative budgets.
- [x] Preserve legacy v1 behavior and actual-writer evidence authority; unknown data cannot count as successful organic work.

## Task 3: Coverage, Audit And Hosted Wiring

Files: modify `scripts/runtime-coverage-store.mjs`, `scripts/runtime-coverage-sampler.mjs`,
`scripts/openclaw-local-server.mjs`, `Dockerfile.openclaw`, `.env.example`;
extend/create focused wiring tests.

The existing bridge already wires the sampler and audit store. No change to
`openclaw-local-server.mjs` or an additional public route was necessary.

- [x] Add failing opt-in `PBK_RUNTIME_CENSUS_PROTOCOL=paged-v2` integration test; default stays legacy v1 until targeted migration and separate rollout.
- [x] Bind coverage instrumentation/schema to protocol version; use paged adapter for admission/snapshot/interval witnesses, never v1 interval reconstruction over fabricated empty arrays.
- [x] Retain one inherited fence, atomic checkpoint/source/root completion, independent readback, failed admission blocking and first-anchor/24h semantics.
- [x] Include all transitive runtime modules and reviewed migration assets in Docker; no UI/auth/approval route changes.
- [x] Prove original v1 source/coverage/audit regressions still pass.

## Task 4: Scale And Adversarial Local Proof

Files: create `scripts/bounded-census-scale.test.mjs` and extend focused fixtures as needed.

- [x] RED/GREEN: at least 112693 rows and >102213520 projected bytes across operations, unchanged source fingerprints and no increased limits.
- [x] Verify complete baseline, genuine forward checkpoint chain, journal edit/delete/reset failures, readback metadata bounds and unknown-only historical provenance.
- [x] Measure maximum loaded rows/bytes/query and operation deadlines; prove late abort never commits a checkpoint or advances a cursor.

## Task 5: Actual Postgres, Security Review And Branch Verification

Files: create guarded `scripts/bounded-census-postgres.node-test.mjs`; operations doc and validation receipt.

- [x] Run only through existing authenticated disposable-target guard; never production. Prove out-of-order/open transactions, head serialization, rollback, independent manifest readback, migration idempotence/security and cleanup.
- [x] Snapshot protected approval/dispatch/dead-letter/call/message/contract state around fixtures. No source replay or provider invocations.
- [x] Run focused plus broad unit/typecheck/lint/build, isolated coverage/audit/approval bridge smokes and static Docker import closure on supported Node 22 with ambient runtime DB URLs scrubbed.
- [x] Dispatch independent whole-branch security/completeness review; address substantive findings with failing regressions before green.
- [x] Record exact passed/failed/skipped evidence, limitations and local-only authorization. No claim of production collection or 24-hour history.

Final results and residual rollout requirements:
`docs/operations/2026-11-17-bounded-census-validation.md`.
