# Evidence-Bound Dead-Letter Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close only approved, completely proven internal dead-letter recoveries through an append-only ledger, with independent current readback before readiness credit.

**Architecture:** Extend existing reconciliation and approval lanes, with a separate immutable Postgres ledger and shared pure evidence validation. A closure-aware operational audit v3 records bounded closure references and independently revalidates them on reads. No worker/provider execution is used to acquire evidence.

**Tech Stack:** Existing Node 22 ES modules, `pg`, Postgres, Jest, `node:test`, existing PGlite fixtures, TypeScript AST/VM bridge tests. No new dependency planned.

**Spec:** `docs/superpowers/specs/2026-11-17-dead-letter-closure-design.md` (founder-approved for local implementation and tests).

## Global Constraints

- Preserve every original dead letter, error, payload, artifact and earlier receipt.
- No source repair, worker replay, tool execution, provider lookup, seller contact, calls, messages, delivery attempts or delivery retries in this feature.
- Never update `provider_action_dispatches`, create provider leases, mark a delivery successful, or make unknown dispatches reclaimable. All six remain locked.
- Preserve existing authentication, founder/passcode protections, Slack decision validation, approval identities and approval-decision semantics.
- No new UI, navigation, autonomous scheduler or independent recovery tool.
- Internal recovery is not provider delivery, a quality passing grade, a historical execution claim or full launch qualification.
- Retain the collector's 64-record limit with a 65th-row overflow sentinel, 65,536-byte source/report bounds, 2-second query limit and 15-second collection deadline.
- Writes and independent readback share a maximum 60-second execution deadline. Existing audit deadlines remain unchanged; overflow or timeout fails closed, not partial.
- Bound receipts/history by the same 64-plus-sentinel rule per selected case and overall within each operation.
- No production migration, push, deployment, live closure or external test database provisioning is authorized by this plan.
- Use existing linked worktree after isolation checks; preserve untracked `output/`. Execution uses a `codex/` implementation branch; no destructive reset or unrelated edits.

## Review Focus

1. Closure started before cutoff but committed afterward must receive no retrospective audit credit (Task 5 real transaction test).
2. Closure execution history changes must not invalidate stable approval authority; an intent/decision change must invalidate it (Tasks 1 and 4).
3. Short event text with a longer canonical transcript must not qualify for a policy skip (Task 3).
4. An outage may deny proof but cannot persist a hidden revocation or allow a newer closure to improve a stored audit (Tasks 4 and 5).
5. Internal action misclassification must never enter a provider lease/tool fallback or bypass admin protections (Task 6).

## File And Interface Map

New modules are deliberately separate from worker startup and provider execution:

- `scripts/dead-letter-closure-protocol.mjs`: constants, strict pure manifest/intent/receipt validation, keyed hashes, signatures and approval projections.
- `scripts/dead-letter-closure-migration.mjs`, `scripts/migrations/20261117-dead-letter-closure.sql`: explicit guarded installation and metadata verification; never startup apply.
- `scripts/dead-letter-closure-evidence.mjs`: bounded fixed SELECTs and complete handler proof resolution, reusable inside a caller-owned transaction.
- `scripts/dead-letter-closure-store.mjs`: append/read/revoke, transaction budgets, current readback and audit-reference verification.
- `scripts/dead-letter-closure-approval.mjs`: proposal generation/request validation and internal action classification; no approval decision bypass.
- Tests alongside their modules; `scripts/fixtures/dead-letter-closure-fixture.mjs` holds anonymized synthetic test rows only. No fixture imports in runtime.
- Modify `scripts/call-memory-outcome-store.mjs` only to expose its existing pure current-proof verifier, keeping writer/summary behavior unchanged.
- Modify `scripts/operational-audit-{collector,store}.mjs`, bridge and Netlify proxy for versioned integration; legacy reconciliation stays unchanged.
- Modify `Dockerfile.openclaw`, `package.json` and local operations documentation for packaging and test entry points only.

Shared result convention: failures are `{ok:false, verified:false, result:<fixed_enum>, counts:null, ...guards}` with no usable reference. Guards are `{noContact:true, providerWritesBlocked:true, deliveryRetries:false, providerDeliveryVerified:false, launchQualified:false}`. All exported runtime arguments are trusted internal dependencies, never passed wholesale from HTTP bodies.

### Task 1: Strict Evidence, Intent And Receipt Protocol

**Files:** Create `scripts/dead-letter-closure-protocol.mjs`, `scripts/dead-letter-closure-protocol.test.mjs`, `scripts/fixtures/dead-letter-closure-fixture.mjs`.

**Interfaces:** Export frozen `DEAD_LETTER_CLOSURE_POLICY` (version `dead-letter-handler-v1`, required steps `qa`, `memory`, `scriptOutcome`, minimumChars 80, embeddingDimensions 1536) and `DEAD_LETTER_CLOSURE_LIMITS` with the spec values. Export `closureBinding(secret, domain, value):hex64`, `validateClosureManifest(value):boolean`, `createClosureIntent({approvalId,action,recordRef,manifest,predecessor,revision,createdAt,secret}):Intent`, `verifyClosureIntent({intent,approvalId,secret,revision,now}):Result`, `projectClosureApproval(row):DecisionProjection`, `signClosureReceipt({report,secret}):hex64`, `verifyClosureReceipt({row,secret,revision,now}):Result`.

`Intent` has exactly schemaVersion, tenantId, approvalRef, action (`close_internal|revoke_internal`), recordRef, originalBinding, manifestBinding, policyVersion, predecessor (`null|{id,hash}`), revision, createdAt, expiresAt and attestation. Use `pbk-dead-letter-closure-intent-v1`; expiry is exactly createdAt + 86400000ms. Signed receipts use `pbk-dead-letter-closure-v1`, bind ordinal/admittedAt/insertXid and complete manifest, and contain no mutable effective status. Approval projection requires durable row `workspace_id='pbk'`, type `admin`, exact internal action, status `approved`, consistent payload identity and actual decided_at. Bind signed intent and stable decision facts, excluding generic updated_at/execution-history changes. No `provider-action` authorization helper is reused as execution authority.

`Manifest` has exactly `{schemaVersion:'pbk-dead-letter-handler-manifest-v1',recordRef,originalBinding,selectionBinding,policyVersion,steps}`. Steps are ordered qa/memory/scriptOutcome, each exactly `{id,outcome,artifactRef,binding,executedAt}`. qa uses `completed`; memory uses `completed|skipped_short_source`; scriptOutcome uses `not_applicable` with null artifactRef/executedAt and a keyed applicability binding. Completed/skip steps require hex64 artifactRef/binding and valid true execution time. All other combinations are invalid. `selectionBinding` binds canonical/event source resolution, including absent rows. Revoke intents carry the exact prior closure manifest and identify its head; no new handler proof is needed to withdraw credit, but current original identity and fresh revocation approval must verify. This permits safe revocation even when the original closure's proof is no longer complete.

- [ ] Write tests named `strict shapes and scope`, `tampered binding denied`, `expiry controls admission not committed receipt lifetime`, `execution metadata is not decision authority`, `revoked or changed intent denied`, `manifest privacy`, `invalid clocks and hostile objects denied`. Assert unknown properties, ambiguous aliases, accessors/proxies, cycles, NaN, oversized values and cross-tenant rows cannot sign/verify; receipt lifetime never overrides step-proof current freshness rules.
- [ ] Run `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand --runTestsByPath scripts/dead-letter-closure-protocol.test.mjs`; confirm expected missing-module/export failure.
- [ ] Implement the named pure interfaces using existing canonical JSON conventions and domain-separated HMACs. Reject shapes before traversing data; bound depth/bytes and compare signatures in constant time. No source rows in public values.
- [ ] Repeat the same command; require zero failures/skips. Commit only protocol/fixture/tests.

### Task 2: Guarded Immutable Ledger Migration

**Files:** Create migration modules above, `scripts/dead-letter-closure-migration.test.mjs` and the schema section of `scripts/dead-letter-closure-postgres.node-test.mjs`.

**Interfaces:** Export `validateClosureMigrationConfig(env):Config`, `applyDeadLetterClosureMigration(client,{expectedDatabase,expectedRole}):Result`, `verifyDeadLetterClosureInstallation(query):Promise<Result>`. `query(text,values)` is caller-owned and bounded. Config uses dedicated `PBK_CLOSURE_MIGRATION_*` names with explicit TARGET/EXPECT_HOST/EXPECT_DATABASE/EXPECT_ROLE/DATABASE_URL; ignore ambient DB URLs. CLI defaults dry-run and requires reviewed SQL SHA256 plus explicit apply. Apply is never invoked by runtime startup/import.

Table `public.pbk_dead_letter_closure_ledger`: `id text PRIMARY KEY`, `tenant_id text CHECK tenant_id='pbk'`, `ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE`, `admitted_at timestamptz NOT NULL`, `insert_xid xid8 NOT NULL`, `record_ref text` hex64, `approval_ref text` hex64, `intent_binding text UNIQUE` hex64, `action text` constrained enum, `previous_id text NULL` self-reference RESTRICT, `report jsonb` bounded to 65536 bytes. Report authenticates every column. Index `(tenant_id,record_ref,ordinal DESC)`; no source-table FK/cascade. Allocate ordinal/admission/xid within writer transaction; gaps are not closure proof.

Allocate ordinal with the verified identity sequence, fetch database admission time/current xid, sign, and use `INSERT ... OVERRIDING SYSTEM VALUE`; never insert an unsigned row and update it later. Encode bigint ordinal/xid as bounded positive decimal strings, not lossy JavaScript numbers. Constraint/readback checks bind the columns to the signed report.

- [ ] Write `migration refuses wrong target and drift`, `repeat apply preserves rows`, `immutable in normal and replica modes`, `browser roles denied`, `missing trigger blocks verification`, `owner trust boundary explicit`. Assert UPDATE/DELETE/TRUNCATE rejection, RLS, actual column/table/sequence privileges, exact trigger/function definitions and no source schema changes. Assert missing required xid/snapshot SQL functions fails preflight closed.
- [ ] Run the new Jest migration test and observe the expected missing-module failure.
- [ ] Implement transactional migration and exact installation readback using existing targeted/census migration patterns. Deny PUBLIC/browser access, grant only required existing trusted-server privileges; no role creation, global grants, secrets or startup schema installation. Reject conflicting existing installation rather than overwrite it. Runtime-owner DDL is outside the claimed tamper boundary.
- [ ] Run Jest migration tests to zero failures/skips. Prove replica immutability and concurrent behavior later in Task 7's isolated real Postgres, not only PGlite. Commit migration and tests.

### Task 3: Read-Only Complete Handler Evidence

**Files:** Create `scripts/dead-letter-closure-evidence.mjs`, `scripts/dead-letter-closure-evidence.test.mjs`; modify `scripts/call-memory-outcome-store.mjs` and its existing tests.

**Interfaces:** Add `verifyCallMemorySkipEvidence({original,calls,receipt,secret,revision,now}):Result` as a pure adapter over existing skip context/source/verify functions. Export `collectDeadLetterClosureEvidence({query,secret,revision,now,recordRefs}):Promise<Result>`, returning bounded cases with keyed refs/bindings, `eligible:boolean`, fixed reasons and strict manifest. Export `verifyDeadLetterHandlerEvidence({original,calls,qa,memory,skipReceipt,secret,revision,now}):Result` for pure fixture tests. Raw rows stay within this module/transaction; success manifests contain only keyed references, outcomes and true proof times.

- [ ] Write `complete embedding evidence eligible`, `short source without executed skip blocked`, `canonical longer than event rejects skip`, `genuine signed skip accepted then stale rejected`, `script selector always blocks v1`, `contradictory aliases blocked`, `low valid QA is completion not quality pass`, `changed original or artifacts invalidates manifest`, `65th row or oversize denies all`. Assert no write/tool/worker/skip-writer import or invocation.
- [ ] Run new evidence and existing memory-outcome Jest tests; observe intended new-interface failure, retaining existing behavior expectations.
- [ ] Implement fixed PBK-only bounded SELECTs for originals, canonical aliases, QA, real embeddings and skip rows. Verify cross-tenant identity collisions without returning foreign content. Use existing canonical transcript/exclusion helpers and unchanged skip verifier. Do not reuse reconciliation-v1 summary as complete handler proof. All script selectors require unsupported-proof blocker, not guessed completion.
- [ ] Run both test files to zero failures/skips. Assert fixture fingerprints before/after collection identical. Commit shared adapter, evidence module and tests.

### Task 4: Append, Revoke And Independently Read Back

**Files:** Create `scripts/dead-letter-closure-store.mjs`, `scripts/dead-letter-closure-store.test.mjs`; extend real Postgres tests/fixtures.

**Interfaces:** Export `executeDeadLetterClosure({pool,secret,revision,approvalId,now=Date.now}):Promise<Result>`, `readDeadLetterClosures({pool,secret,revision,now=Date.now(),cutoff,reference,boundary}):Promise<Result>` and `verifyDeadLetterClosureReference({pool,secret,revision,now,reference}):Promise<Result>`. Reads return `counts:{total,closedInternal,open,invalidated}`, bounded per-case statuses, and authenticated audit reference; failure counts are null. A reference binds exact ledger heads, original/manifest/decision bindings, cutoff and optional Task 5 boundary. Reference revalidation never selects a newer beneficial closure.

- [ ] Write `exact approved append and readback`, `pending denied missing expired approval blocked`, `same intent single use`, `newest bad receipt never falls back`, `revocation requires fresh approval and append`, `source or decision drift blocks`, `temporary outage restores only identical proof`, `late client and timeout destroy without commit`, `pool max one does not deadlock`, `global history overflow denies all`. Assert originals/dispatches/unrelated approvals unchanged; ledger rows never updated/deleted.
- [ ] Run new store Jest tests and confirm the expected missing-module failure.
- [ ] Implement bounded serializable write transaction: validate installation, acquire per-case advisory lock, reload/lock canonical approval, re-read sources/predecessor and approved intent, allocate order/time/current xid, sign and INSERT. Do not retry serialization errors. Read-only repeatable-read verification uses the independent protocol/evidence validators, full bounded chain and current canonical approval; explicit revocation blocks credit. Exact replay returns existing verified receipt only, including after proposal expiry if it was valid at original admission. Release transaction connection before independent readback to support max:1 pools.
- [ ] Implement shared end-to-end fences (15s reads, 60s write plus readback, <=2s queries), client error handling, rollback/destruction and late acquisition disposal. No COMMIT after abandonment. Current summaries can regain proof after transient failure but never overwrite durable history.
- [ ] Run new store/protocol/evidence tests to zero failures/skips; extend real tests with two-client source/approval/ledger races. Commit store and tests.

### Task 5: Closure-Aware Operational Audit v3

**Files:** Modify `scripts/operational-audit-store.mjs`, `scripts/operational-audit-collector.mjs`, their test files and `scripts/operational-audit-test-fixture.mjs`; extend closure store/Postgres tests.

**Interfaces:** Add `captureDeadLetterAuditBoundary({pool,now=Date.now}):Promise<Result>` to closure store. Boundary contains database snapshot text (max 8192 bytes), captured database UTC time and server observation time; audit cutoff is captured afterward and must not predate the boundary. Write ledger stores real `pg_current_xact_id()`. Boundary membership uses `pg_visible_in_snapshot(insert_xid, snapshot)` and signature/manifest validation, not ordinal/time alone. `collectOperationalAudit` accepts trusted `closureBoundary`; returns `closures:{verified,reference}` alongside existing coverage. Never accept snapshot/cutoff/reference from an HTTP caller.

Use schema `pbk-operational-audit-v3`, suite `operational_audit_v3`, source `server:operational-audit:v3`, domain-separated v3 signing key. Newest admission query spans v1/v2/v3 without success filtering; explicit supported schema/key mapping, no unknown-version fallback. Legacy rows retain signatures/semantics and never gain closure credit. New dead-letter counts include `totalOriginals`, `resolvedInternal`, `outstanding`, `invalidatedClosures`; strict normalizer recomputes their relationship. Reference size shares 65536-byte report limit.

- [ ] Write `post-cutoff commit denied despite earlier timestamp`, `closure after signed audit cannot improve it`, `revocation downgrades stored audit`, `coverage unverified still validates closures`, `legacy schema never gains closure credit`, `newest pending or invalid v3 blocks older pass`, `unavailable ledger never means zero outstanding`, `originals total retained and exact subset subtracted`. Pin boundary text tamper/clock skew/overflow rejection.
- [ ] Run audit/store/coverage and new cutoff tests, confirming expected new-schema/interface failures.
- [ ] Capture a read-only database snapshot after pending audit admission and before choosing the server observation cutoff, within the existing audit fence; retain the original audit start/admission behavior. Keep signed boundary with reference. A ledger transaction in progress or absent at that snapshot is ineligible even if its admission timestamp is older. Snapshot xid visibility is a conservative committed-before-cutoff witness; no new clock/ordinal shortcut. Refuse unavailable snapshot support or impossible clock ordering. This is the chosen implementation of the spec's commit-cutoff rule, not an expanded collection window.
- [ ] In the dead-letter scan, count every original and discount only the bounded complete verified subset eligible at cutoff. Missing current sources, unsupported cases or invalidated closures stay outstanding; unreadable summary makes check unverified. Add ledger to fixed security inventory (22 existing tables + ledger = 23), retaining all existing tables/checks and expected privileges.
- [ ] Revalidate signed closure reference on every audit read, before the current coverage early-return path; recheck newest audit admission after async work. Current failures may downgrade only; successful identical revalidation restores at most signed result. Do not mutate stored audit or let new closures improve old counts. Keep independent gates untouched.
- [ ] Run audit regression tests and real two-client held-transaction cutoff test to zero failures/skips. Commit versioned audit integration and tests.

### Task 6: Existing Approval Lane, Founder Routes And Readiness

**Files:** Create `scripts/dead-letter-closure-approval.mjs`, `scripts/dead-letter-closure-approval.test.mjs`, `scripts/dead-letter-closure-wiring.test.mjs`, `scripts/dead-letter-closure-bridge-smoke.mjs`; modify `scripts/openclaw-local-server.mjs`, `netlify/functions/pbk-bridge-proxy.ts`, `scripts/netlify-qualification-founder-boundary.test.mjs` and maturity fixtures.

**Interfaces:** Export `isDeadLetterClosureApproval(value):boolean`, `authorizeClosureProposalRequest(request,apiKey):Result`, `prepareDeadLetterClosureProposal({pool,secret,revision,recordRef,action,approvalId,now}):Promise<Result>`. Prepare returns pending approval params, not a persisted/approved decision. Action is fixed by route: close proposal or revoke proposal. Params use existing type `admin`, action `dead_letter_internal_closure`, signed intent in `metadata.deadLetterClosureIntent`; no lead/contract association, no provider flags. Server generates approval ID before signing, then calls existing `createApprovalTask` and confirms exact durable pending intent before reporting success. No cached-only or local-file authority accepted.

- [ ] Write `team denied existing admin approval rules`, `protected passcode and Slack checks retained`, `founder bearer cannot apply without approval`, `proposal cannot inject evidence or approval status`, `internal approval never touches dispatch or generic tool fallback`, `maturity cannot merge closure diagnostics into other gates`, `proxy denies all founder closure routes`. Test GET preview read-only; POSTs empty-body/no-query; reject duplicate/proxy/delegated headers, wrong methods, malformed refs and trailing/encoded route bypasses.
- [ ] Run new wiring tests and existing founder/proxy tests; confirm new routing expectations fail first.
- [ ] Implement preview/propose/propose-revocation under approved paths. Use existing direct-founder header checks and all existing admin approval gates; type `admin` ensures team/admin protection is inherited. No apply/execute HTTP route or invoke tool. Deny proxy access to the exact closure route family before lending bridge credentials; adjacent unrelated paths retain behavior.
- [ ] Add internal approval handling in existing approval-callback after durable decision claim and before provider lease/contract/generic fallback. Exact internal decision replays may read the existing receipt but never invoke other handlers. Ignore execution overrides; only canonical signed intent is authority. Any internal-action/type mismatch fails before fallback. Proposal approval creation uses existing pending service; any normal operator notification is stubbed in local tests, never seller-facing.
- [ ] Add `deadLetterClosures` summary to existing production maturity response while retaining reconciliation-v1 and memory-policy diagnostics. Use closure-aware `readOperationalAudit` for audit evidence only; direct closure diagnostics never become execution/coverage/canary/delivery qualification.
- [ ] Run focused plus existing reconciliation, approval dispatch, founder authorization, Netlify boundary and maturity tests to zero failures/skips. Run isolated bridge smoke with all provider/network side effects stubbed/denied. Commit only integration/test files.

### Task 7: Isolated Postgres Proof, Packaging And Whole-Branch Review

**Files:** Finish `scripts/dead-letter-closure-postgres.node-test.mjs`; modify `Dockerfile.openclaw`, `package.json`; create `docs/operations/dead-letter-closure.md`, `docs/operations/2026-11-17-dead-letter-closure-validation.md`.

**Interfaces:** New npm scripts `test:dead-letter-closure`, `test:dead-letter-closure-bridge`, `test:dead-letter-closure-postgres`. Real proof uses only dedicated `PBK_CLOSURE_TEST_*` target variables, never ambient runtime URLs. Require loopback host, explicit expected database/role and unique disposable database name `pbk_closure_test_<random hex>`; verify generated empty DB before any fixtures/migration. Drop only that verified generated DB in finally. No remote Neon/Render provisioning or writes under this local authorization; absence of a local server is a reported verification gap, not a successful skipped proof.

- [ ] Add packaging tests for new runtime imports and migration verifier SQL asset. No startup migration runner or new production workflow action. Add local operations instructions explaining effective closure, revocation, current-proof failures, owner trust boundary and separate release authorization.
- [ ] Run new tests to expected missing-packaging failure; add only needed Docker COPY/package script entries, preserving node22 and existing build settings.
- [ ] Run guarded local real Postgres proof, including normal/replica immutability, exact installation drift detection, single-use concurrency, original/dispatch fingerprint preservation, max:1 pool, held-transaction cutoff and independent readback. Fixture approvals may be created/decided only in generated disposable DB. Network observer asserts zero external calls and sender stubs throw on access. Save aggregate redacted results, not source rows/secrets.
- [ ] With pinned Node22 first in PATH, run `npm run test:dead-letter-closure`, `npm run test:dead-letter-closure-bridge`, `npm run test:backlog-reconciliation-bridge`, `npm run test:operational-audit-bridge`, `npm run test:provider-action-dispatch`, `npm run test:render-docker-imports`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`. Run targeted existing memory/audit/canary/approval/proxy Jest suites too. Inspect build-generated files and preserve unrelated existing work; do not blindly revert them.
- [ ] Obtain independent correctness/security review of full diff, fixing findings with regression tests. Recheck proof replay, trust boundaries, privacy, cutoff race, auth/admin classification and dispatch noninterference. Record exact commands/results, failures/skips and remaining gaps. Do not claim production readiness from a build or PGlite-only proof.
- [ ] Commit scoped code/tests/docs locally. No push, PR, production migration, deployment or live closure. Report local results and remaining genuine blockers without changing production.

## Execution Checkpoints

- [ ] Founder reviews this plan and chooses execution method before product edits.
- [ ] Check linked-worktree isolation via using-git-worktrees; preserve `output/`; create `codex/dead-letter-closure` branch for execution.
- [ ] Follow test-first tasks above, committing/reviewing each independently testable unit.
- [ ] Whole-branch review and honest local validation summary complete; production unchanged.

## Plan Self-Review

Every design section maps to Tasks 1-7. Approval lifetime/authority distinctions are
pinned in Tasks 1/4; current skip-proof expiry stays unchanged in Task 3. Database
immutability/trust limits and history caps are in Tasks 2/4. Cutoff, downgrade and
legacy behavior are in Task 5. Existing approval/proxy/dispatch boundaries are in
Task 6. Privacy, local-only real proof, packaging and release boundary are in Task 7.
All five Review Focus conditions have named owning tests. Function/result names
above are the cross-task contracts; implementation must not silently rename them.

Recommended execution: subagent-driven, with a fresh implementer and independent
review for each task, then a full-branch security review. These components share
security-sensitive evidence interfaces, so catching contract drift between tasks
is worth the additional review contexts. No implementation has started yet.
