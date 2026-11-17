# Readiness Timing And Coverage Implementation Plan

> **For agentic workers:** REQUIRED WORKFLOW: Use superpowers:subagent-driven-development. REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with independent task and whole-branch review. Steps use checkbox syntax for tracking.

**Goal:** Build the approved length-aware timing and forward-only coverage paths locally without manufacturing operating evidence or changing production.

**Architecture:** Reuse the existing bridge, timing/registry helpers, fixed audit and Postgres eval store. Separate policy, signed timing proof, signed source observations, continuous checkpoint proof and audit promotion. All unavailable evidence remains blocked.

**Tech Stack:** Node ESM, existing Jest/PGlite/Postgres, existing AsyncLocalStorage, Node crypto, guarded disposable Neon evaluation; no new dependency/provider/schema.

**Spec:** docs/superpowers/specs/2026-11-17-readiness-timing-coverage-design.md

## Global Constraints

- Local implementation and isolated tests only. No push, merge, deploy, production DB/configuration change or production collection.
- Keep unknown dispatches locked, four original dead letters open, authentication/SSO/approval/RLS/provider gates unchanged; no seller calls/messages, delivery retries, memory backfill or event replay.
- Timing is measurement only: do not alter generation tokens, request deadlines, streaming, stop/cancel semantics or playback length.
- Approved pilot: first token 1800 ms; chat/phone completion 3000 + 20 ms/output code point; phone first media 2500 ms; final media 2500 + 1.10 * actual media duration + 2000 ms; research completion 120000 + 20 ms/output code point; provider/internal completion 30000 ms.
- Coverage: 60000 ms sampling, maximum gap 90000 ms, 86400000 ms window, at most 2000 checkpoints. New boot/revision resets the segment. No backward coverage.
- Store only fixed classifications, aggregate numbers, opaque references/bindings and signatures in new proof; never raw prompts/answers/audio/seller identities/contact data or keys.
- Caller timing/channel/length/provenance/source labels are not evidence. Controlled, diagnostic, unknown, failed/cancelled and legacy data cannot become completed organic work.
- Reuse domain-separated HMAC from the existing signing secret. Preserve freshness, sample, business-result and independent canary gates. No budget or heartbeat alone can qualify the fleet.
- Preserve unrelated output/ files and the Analyzer changes on base ca9905846d15045c097cc8c1cb3fc35cd216ba74. No UI work.
- Use apply_patch for manual edits. Focused RED/GREEN tests and independent review for each task. Stage only owned paths; local commits carry [skip netlify] [skip render]. Do not spawn child agents from an implementer/reviewer.

## Review Focus

- A forged long length or mismatched run makes a short slow answer falsely pass; bind actual output and score paired per-run ratios.
- A healthy new process or late pool completion fills a missing past interval; enforce boot/lease/sequence/time/commit fences.
- A legacy/backdated/new unknown source disappears from the census; anchor first actual observation, include unknown changes/deletions and never relabel history.
- Caller-provided source/diagnostic flags hide a genuine error; authority comes from internal execution context and known failures remain findings.
- A newer pending/invalid audit falls back to an older success; newest admission across old/new namespaces wins and proof is reread.

## File And Interface Map

- Policy/measurement: extend agent-latency-policy.mjs, agent-registry.mjs and agent-fleet-measurement.mjs; new agent-timing-proof.mjs.
- Provenance: new runtime-evidence-context.mjs and runtime-source-evidence.mjs, paired receipts in pbk_eval_runs.
- Collection: new runtime-coverage-store.mjs and runtime-coverage-sampler.mjs, fixed source queries owned by source-evidence helper.
- Integration: existing bridge and conversation-store.mjs; existing request-timing helper only as needed for actual measured callbacks.
- Audit: existing operational-audit-collector.mjs/store.mjs and their focused tests; v2 proof contract, existing endpoints.
- Packaging: Dockerfile.openclaw, .env.example, existing CI and guarded targeted-readiness-postgres.node-test.mjs, operational runbook.

## Progress

- [ ] Task 1: signed length-aware timing core.
- [ ] Task 2: authoritative source observation/provenance core.
- [ ] Task 3: durable coverage chain and sampler.
- [ ] Task 4: trusted bridge/source measurement adapters.
- [ ] Task 5: versioned audit and readiness integration.
- [ ] Task 6: packaging, isolated Postgres proof and whole-branch validation/review.

### Task 1: Signed Length-Aware Timing Core

**Files:** Create scripts/agent-timing-proof.mjs and its .test.mjs; extend scripts/agent-latency-policy.mjs, scripts/agent-registry.mjs, scripts/agent-fleet-measurement.mjs; add scripts/agent-latency-v2.test.mjs. Existing v1 tests remain unchanged unless genuine compatibility assertions require extension.

**Interfaces:**
- getAgentLatencyPolicy(env, { requireVersion2 = false } = {}) preserves legacy parsing and reads PBK_AGENT_LATENCY_POLICY_V2 preferentially. Produces {version:2, ready, hash, rules, budgets, issues, source} for v2; blocked rules/budgets/hash are unusable.
- Export frozen AGENT_LATENCY_PILOT_V2 = {schemaVersion:2, channels:{...}}. Rules: fixed {kind:'fixed',ms}; text {kind:'text',baseMs,msPerCodePoint}; media {kind:'media',startMs,durationMultiplier,drainMs}. Exact values are in Global Constraints.
- resolveAgentLatencyBudget(policy, {channel,kind,outputCodePoints,mediaDurationMs}) -> {verified,budgetMs,reason}. Reject ambiguity/overflow, do not clamp.
- buildAgentTimingProof({secret,revision,policy,agentId,runId,channel,startedAt,completedAt,timings,answer,media,provenance,successful,origin}) -> signed strict plain-data proof or unverified result. Count actual answer code points internally. media accepts only actual {codec:'PCMU',sampleRate:8000,byteCount}; derive duration, never accept caller duration.
- verifyAgentTimingProof(proof,{secret,revision,policy,agentId,runId,now}) -> {verified,reason,data?}. Schema pbk-agent-timing-v2; PBK tenant, accepted_turn origin and fixed milestone allowlist; signature binds identity, actual wall-clock bounds, policy and measurement values.
- collectAgentFleetEvidence(state,{now,policy,secret,revision,requireTimingV2=false}) verifies proof attached at metadata.timingProof or metadata.executionEvidence.timingProof. Produces latencyObservations with proof and binding, plus separate unverified diagnostics. No public payload creates trust.
- buildStableAgentFleetMeasurement accepts timingEvidenceSecret/revision/latencyPolicy in internal options, verifies proof again for the current agent/run and evaluates p95 per-run elapsed/allowed ratios <= 1 for v2. Keep raw p95, min/max budgets and counts diagnostic. v1 remains fixed.

- [ ] Step 1: Add RED tests for all pilot formulas, Unicode (emoji counts once), overflow/nonfinite/unknown policy, invalid-v2/no-fallback, wrong tenant/agent/run/revision/hash, forged length/timing, replayed signature, expired/future timestamps, failed/cancelled/empty output and missing audio. Assert long and short runs are paired individually, not p95-of-budget; duplicate runs are not extra samples and conflicts fail closed.
- [ ] Step 2: Run the new focused Jest paths with runtime DB URLs scrubbed; record expected failures before implementation.
- [ ] Step 3: Implement the interfaces above using canonical/domain-separated HMAC and strict fixed fields. Reject accessor/prototype tricks before canonicalization. No raw answer/media retained. Missing milestones remain absent.
- [ ] Step 4: Integrate the v2 cohort without permanently poisoning it with legacy/stale diagnostics: expired/legacy records do not count, but remain visible; invalid recent v2 proof or an invalid latest business action cannot fall back to old success. Preserve v1 behavior and all context/provenance gates.
- [ ] Step 5: Run new and existing policy/registry/fleet tests; confirm RED/GREEN, no added timeouts/output caps. Commit only Task 1 files; self-review and write the task report.

### Task 2: Authoritative Source Observation Core

**Files:** Create scripts/runtime-evidence-context.mjs, scripts/runtime-source-evidence.mjs and corresponding .test.mjs. No bridge/source writer changes yet.

**Interfaces:**
- withRuntimeEvidenceContext(origin, operation) and getRuntimeEvidenceContext(): internal AsyncLocalStorage, fixed allowlisted server origins operator_chat, phone_turn, registered_business, runtime_circuit and diagnostic; the first four are operational source origins, diagnostic is not business work. Internal controlledExecution scope takes precedence. Missing/unrecognized context stays unknown. Source writers inherit context; wrapping a QA/projector write alone must not invent operational origin.
- recordRuntimeSourceEvidence({pool,secret,revision,sourceKind,sourceId,now}) rereads a successful persisted source and writes a bounded signed opaque paired receipt; no supplied row, provenance, timestamp or success claim. Supported sourceKind values runtime_archive, conversation_projection, qa, safety. Signature domain and suite/source namespaces separate from timing/audit/checkpoints.
- collectRuntimeSourceSnapshot({client,secret,revision,windowStart,windowEnd,now}) runs fixed PBK-only queries over actual supported source rows and their durable proof, returning per-source counts/fingerprints, actual observation bounds, unknown/controlled/diagnostic/operational counts and eligibility. No source SQL, schemas or scopes from callers.
- Source receipts use suite runtime_source_evidence_v1/source server:runtime-source-evidence:v1 in existing pbk_eval_runs. They are monitoring data, not passed tests. No source mutation or schema change. A report has an 8192-byte maximum; whole-source census is bounded to 10000 rows and 16 MiB, otherwise unverified.
- A separately labeled observed_unknown receipt may anchor when the sampler FIRST actually saw a row/change/deletion. It never claims original write time or organic provenance. This permits old unchanged unknown rows to leave a future rolling window without assuming a backdated created_at is trustworthy. A new backdated row/change is unknown in the current window. No historical source row is rewritten.

- [ ] Step 1: Add RED tests using fixed clocks and PGlite/fake bounded clients: trusted successful source binding; no raw private content; context-free and caller-labeled origins unknown; controlled scope never writes an organic receipt; foreign workspace, source mismatch, edited/deleted row, future/missing/reversed clock, unknown metadata and oversized census fail closed.
- [ ] Step 2: Demonstrate new unbound/backdated rows cannot age out using their claimed date. First-observed unknown anchors contain real current observation time only. Re-observing an unchanged source does not refresh its first observation; mutation/tombstone creates a new unknown observation.
- [ ] Step 3: Implement fixed source projections for fields actually audited, opaque HMAC identifiers, bounded idempotent writes/readback and read-only census. Late receipt persistence or query failure remains a gap; it must not turn a successful business write into a false business failure.
- [ ] Step 4: Test missing/tampered/replayed proof, cross-source/tenant binding and late client acquisition/release, with no late commits after timeout. Never skip unknown rows or known failures based on caller labels.
- [ ] Step 5: Run focused tests, self-review privacy/bounds, commit only Task 2 files and report the exact interfaces used for snapshots and classified source rows to Task 3.

### Task 3: Durable Coverage Chain And Sampler

**Files:** Create scripts/runtime-coverage-store.mjs, scripts/runtime-coverage-sampler.mjs and corresponding .test.mjs. Consumes Task 2; no bridge startup changes yet.

**Interfaces:**
- createRuntimeCoverageSampler({pool,secret,revision,enabled=false,hosted=false,health,now,monotonicNow,setTimer,clearTimer,bootId}) -> {start,stop,sample,status}. health is an internal fixed health supplier, never request data. Defaults disabled; controlled/local runs cannot enable it with payload data.
- health returns authenticationConfigured, bootstrapReady, archiveReady, providerCircuitsReady, observabilityReady, eventBusConnected booleans and approvalMode string, matching the existing audit runtime-health contract.
- sample({cutoff?}) closes only a current pending interval with actual server/DB observations. No historic gap filling. Initial sample establishes start; subsequent same-boot/revision contiguous samples are required.
- readRuntimeCoverage({pool,secret,revision,now,cutoff=now}) -> {verified,result,proof,sources,diagnostics}. proof binds fixed coverage policy, instrumentation version, current revision/boot, segment, cutoff, ordered receipt references/digests and source census. At most 2000 checkpoint rows; max 8192 bytes/row, 16 MiB aggregate, 15-second total operation, 2-second query budget.
- Checkpoint suite runtime_coverage_v1/source server:runtime-coverage:v1; control lease has separate runtime_coverage_control_v1 namespace. Evidence rows must not be counted as passing tests or agent business work.
- Lease is PBK-scoped, signed and transactionally fenced with advisory locking plus durable owner/generation/expiry. Lease TTL 120000 ms; maximum accepted observation gap remains 90000 ms. Nonowners do not append another boot's chain; ownership loss breaks the segment.

- [ ] Step 1: RED tests for first sample not covering the past, a genuine full 24h chain, short windows, quiet and active source windows, gap >90000, stale/latest pending/failed row, restart/revision change, duplicate/conflicting sequence, deletion/tamper, clock jumps, lost lease and competing replicas. Test chain endpoints and exact audit cutoff, not just min/max timestamps.
- [ ] Step 2: Implement bounded atomic checkpoint writes/readback, canonical signatures and previous-record bindings. Never emit provider/agent/delivery calls. New boot/revision or failed observation starts a new forward-only segment.
- [ ] Step 3: Verify current source census against signed per-interval bindings with one bounded source scan and interval grouping; do not run a full census once per checkpoint. Include trusted first-observed unknown/tombstone changes. Missing rows/proof or changed source fields invalidate proof.
- [ ] Step 4: Test sampler start only after enabled+hosted+ready internal conditions; no overlap, clean stop/unref and late-work cancellation; failed queries/writes and no late commit cannot fill coverage. A quiet covered source does not produce organic fleet samples.
- [ ] Step 5: Run focused tests, commit Task 3 files, self-review and report proof shape/fixed health contract needed by Tasks 4/5.

### Task 4: Trusted Bridge And Source Adapters

**Files:** Modify scripts/openclaw-local-server.mjs, scripts/conversation-store.mjs and scripts/ava-request-timing.mjs only as necessary; create scripts/readiness-timing-coverage-wiring.test.mjs and optional focused scripts/agent-timing-adapters.mjs/.test.mjs when a real private boundary needs it. Update existing VM fixture stubs only for genuine new imports/dependencies.

**Interfaces:**
- Internal bridge options obtain secret, revision, active policy and context themselves. Public params never supply signing material, trust, callback clocks or measured size/channel.
- Trusted adapters map actual operator-chat/phone entry paths to chat/phone and validated registered research/advisory handlers to research, non-generative internal/provider handlers to provider. Ambiguous handlers remain unknown. This does not label recommendations as seller delivery.
- Actual final result supplies answer count. Existing first content/audio callback captures monotonic milestone; actual PCMU transport byte count supplies phone media duration. Missing events stay absent. Browser onended/client metadata is not phone authority.
- Existing runtime archive, QA/safety writes and conversation append paths pair successful durable source writes with Task 2 receipts under authoritative context. Generic caller-posted runtime events are unknown even if labels claim operational. Controlled execution isolation remains authoritative.
- Sampler is instantiated with PBK_RUNTIME_COVERAGE_ENABLED opt-in and hosted+bootstrap-ready conditions, starts once after bootstrap and stops on existing shutdown. Lifecycle internal state is not a new public command endpoint.

- [ ] Step 1: RED tests execute real extracted functions/handlers with controlled clocks and dependencies: long/short answers get genuine size; public forged timing/channel/length/attestation/context ignored; no lost first-token/finish hooks; absent milestones remain absent; cancelled/partial replies and controlled diagnostics cannot qualify.
- [ ] Step 2: Integrate helpers from Tasks 1-3 at the named runtime boundaries. Never import/start the monolith in a unit test or add a parallel client measurement service. Keep secret/private context outside request params; count only actually processed media frames.
- [ ] Step 3: Add source-write success/failed-persistence tests for archive, QA, safety and conversation projection; assert paired evidence follows actual writes, missing authority remains unknown, caller flags cannot hide known errors and no existing source/approval/dispatch row is rewritten for backfill.
- [ ] Step 4: Test opt-in startup/shutdown with isolated runtime dependencies and outbound denial; disabled/local/controlled/missing-DB startup performs no evidence writes. Assert timeout/token/cancel/voice behavior and original provider gates unchanged.
- [ ] Step 5: Run focused wiring/source/streaming/voice/controlled-execution regressions, self-review, commit only Task 4 files, report any genuinely unavailable live milestone as unverified rather than synthesizing it.

### Task 5: Audit V2 And Readiness Integration

**Files:** Modify scripts/operational-audit-collector.mjs, scripts/operational-audit-store.mjs, their tests, scripts/operational-audit-bridge-smoke.mjs and the small bridge audit/readiness call sites. Add focused scripts/operational-audit-coverage.test.mjs as needed.

**Interfaces:**
- Preserve existing executeOperationalAudit/readOperationalAudit export semantics and protected fixed HTTP route; add internal secret/revision/coverage verifier dependencies as required. All new production audit writes use v2 canonical signed proof; v1 reads are legacy diagnostics, never v2 qualification.
- Keep the eight existing check IDs. V2 audit.coverage carries schema/policy/instrumentation/segment/cutoff/reference binding in addition to verified, and store readback validates it against durable Task 3/source proof, not a signed Boolean alone.
- Map Task 2 qa/safety source snapshots into the existing safety_qa check; do not add or rename check IDs.
- Newest admission across legacy/new audit namespaces wins regardless of status/signature/revision; pending or invalid latest proof blocks older success. Preserve the 60-second audit execution deadline, 24h freshness and 65536-byte report bounds.
- Both bridge fleet read paths require v2 policy and pass Task 1 proof-verification options. Maturity exposes coverage/source diagnostics alongside unchanged existing delivery/memory/canary gates.

- [ ] Step 1: RED tests show forged coverage true, missing references, stale proof, changed source census, wrong revision/boot/policy and newer pending/invalid legacy or v2 receipt cannot pass. Old signed audit remains untouched and visible only as legacy.
- [ ] Step 2: Integrate fresh current-boundary sampling into fixed internal audit collection. It may close the current interval within 90000 ms, never past gaps. Separate observation cutoff and actual collection time, check DB time and no future/reversed interval. An initial audit cannot manufacture a day.
- [ ] Step 3: Derive per-source audit status from complete provenance+coverage. Full verified quiet windows may report no findings/zero activity but never business validation. Preserve every unresolved dispatch/dead-letter finding regardless of age, runtime/security failures and source unknowns.
- [ ] Step 4: Update canonical v2 report signing/readback with real durable validation. Keep all existing denial, tamper, admission-ordering and race tests; migrate fixtures to genuine isolated v2 proof rather than deleting assertions. Do not accept a readiness override/report from HTTP.
- [ ] Step 5: Run store/collector/bridge/fleet tests and isolated audit smoke, self-review and commit Task 5 files; no production route called.

### Task 6: Packaging, Durable Proof And Full Verification

**Files:** Modify Dockerfile.openclaw, .env.example, existing CI proof steps only if needed, scripts/targeted-readiness-postgres.node-test.mjs and validation smokes; create docs/operations/readiness-timing-coverage.md. Update plan progress and approved spec status where appropriate.

**Interfaces:** Consume prior tasks' actual module names and APIs. Existing guarded targeted-readiness fixture verifies real fresh TTL Neon branch/endpoint and explicit driver fields before any schema reset. All database evaluation is disposable, never Render.

- [ ] Step 1: Write failing packaging/CI checks for all new runtime imports; include a complete non-secret v2 pilot JSON and PBK_RUNTIME_COVERAGE_ENABLED disabled in the example. Do not set production values or introduce mandatory new secrets.
- [ ] Step 2: Extend mandatory disposable Postgres proof with actual source receipt write/reread/tamper denial, checkpoint/lease behavior and audit references. Keep original migration proof and zero-skip six-suite qualification. Assert original approval/dispatch/dead-letter/call snapshots unchanged.
- [ ] Step 3: Run all focused paths, full unit suite using recycled workers when needed, typecheck, lint, build, import closure, package-script/subagent-plan checks, and isolated bridge/approval/reconciliation/streaming/voice safety smokes. Save exact bounded results, do not claim skipped local PG tests executed.
- [ ] Step 4: Use the existing guarded Neon harness with runtime URLs scrubbed for real PG proof and the six conditional suites, then verify temporary branches deleted. No project-global roles, source replay or external provider actions.
- [ ] Step 5: Whole-branch independent security/spec/quality review, resolve real findings with RED/GREEN regressions, rerun changed checks and update the ledger. A full-day fixture is algorithm proof only, not operating history.
- [ ] Step 6: Finish with a scoped local commit/test receipt and honest remaining gates. Leave production unchanged and preserve the worktree/unrelated files. No publication or release authorization is inferred.

## Execution Rulings And Record

- Design and pilot targets approved for local build/testing by explicit founder reply on 2026-11-17.
- Execution uses the established subagent-driven task/review workflow; no further policy/scope decision is needed to begin the approved local work.
- Existing linked worktree verified; named feature branch, not a submodule. No second worktree or main-checkout edit.
- Baseline: 67 suites, 1678 passed, 12 database-conditional skips; recycled workers, runtime URLs scrubbed. Current base preserves merged Analyzer PR #16.
- Ruling: secret/clock/source parameters in pure helpers are internal dependencies only; adapter tests must prove public params cannot supply them.
- Ruling: untrusted diagnostic labels cannot hide source errors; actual internal controlled context is authoritative. Legacy rows are diagnostic, not silently upgraded or permanently used as a new v2 cohort.
- Ruling: first-observed unknown/tombstone anchors are observation evidence, not retrospective write/organic proof. Current mutations/backdates must enter unknown coverage before they can naturally age out.
- Ruling: maximum-gap policy proves sampled collection, not literal uninterrupted uptime. Process/revision resets require new real history.
- Ruling: no production budgets or sampler activation in this task. Existing unknown dispatches/memory and canary gaps remain real blockers.
