# PBK Hybrid Skill Studio Design

## Status

Approved product direction. This document defines the implementation contract for a production-ready Skill Studio in PBK Command Center.

## 1. Purpose

PBK needs one controlled workspace where operators can import sales knowledge, turn it into reusable agent skills, test those skills, combine them into chains, assign them to agents, approve exact versions, activate them gradually, and measure outcomes.

The system must improve Ava, Rex, Nurture, and Max without allowing imported or AI-generated content to reach production accidentally.

### Goals

- Add a fast "Add Skill" entry point to Memory & Analytics.
- Add a dedicated Skill Studio for review, testing, chaining, assignment, approval, activation, and outcome analysis.
- Reuse the existing YouTube training, skill-learning, context-aware selection, and outcome-recording systems.
- Make Render Postgres the only operational authority.
- Mirror approved data asynchronously to Supabase for analytics, semantic retrieval, and recovery.
- Require human approval for every imported or generated candidate.
- Let AI suggest skill chains while keeping ordering, approval, and activation under operator control.
- Support desktop and mobile operator workflows without reducing safety.
- Preserve complete provenance, version history, audit history, and one-click rollback.

### Non-goals

- Replacing the existing context-aware runtime selector.
- Allowing Supabase to become a runtime write target or failover authority.
- Automatically activating imported content.
- Building a general visual programming system.
- Adding a new orchestration framework when the existing PBK runtime can support the feature.
- Reworking unrelated Command Center pages.

## 2. Approved Architecture

### 2.1 Authority model

Render Postgres is the authoritative source for:

- Skill definitions and immutable versions.
- Import records and extraction results.
- Chain definitions and immutable chain versions.
- Agent assignments.
- Approvals and activation state.
- Runtime selection inputs.
- Audit events and rollback state.
- Projection outbox records.

Supabase is an asynchronous, read-only projection for:

- Analytics dashboards.
- Embedding and semantic retrieval workloads.
- Reporting and research queries.
- Rebuilding non-authoritative read models.

The browser must never receive credentials that can mutate the Supabase projection. Projection writes use server-only credentials from a bridge worker.

### 2.2 Runtime availability

The production runtime reads only approved, active versions from Render Postgres or from a last-known-good cache produced from Render Postgres.

If Render Postgres and the approved cache are both unavailable, the runtime fails closed for new skill selection. It must not read operational state from Supabase as a substitute.

Existing active calls may continue with their pinned, already-approved skill snapshot. New candidates, stale approvals, and projection-only rows are never executable.

### 2.3 Transactional projection

Every authoritative mutation and its corresponding projection event are written in one Render Postgres transaction.

An outbox worker leases pending events, projects them to Supabase, retries transient failures with exponential backoff and jitter, and moves exhausted records to a dead-letter state. Supabase lag never blocks the authoritative transaction.

## 3. Existing PBK Capabilities to Reuse

The implementation should extend existing modules instead of creating parallel systems:

- `scripts/youtube-training.mjs` for YouTube ingestion and training evaluation.
- `scripts/auto-skill-learner.mjs` for candidate extraction and learning signals.
- `scripts/context-aware-script-rotator.mjs` for runtime scoring, anti-repeat behavior, objections, sentiment, and learned weights.
- `scripts/openclaw-local-server.mjs` for authenticated bridge routes and runtime integration.
- `src/app/routes/MemoryAnalytics.tsx` for the quick import entry point and skill health summary.
- `src/app/routes/AgentFleet.tsx` for agent context and assignment visibility.
- Existing skill outcome, trend, reload, and YouTube training endpoints where their contracts remain suitable.

The current schema and reload behavior must be hardened before new ingestion is enabled. A candidate status or candidate level must never be interpreted as active.

## 4. Domain Model

The model separates stable identity from immutable versions, operational activation, and analytical projections.

### 4.1 Authoritative tables

#### `skill_definitions`

Stable identity for a skill.

Key fields:

- `id`
- `slug`
- `display_name`
- `owner_id`
- `risk_class`
- `created_at`
- `retired_at`

#### `skill_versions`

Immutable content and behavior for one skill revision.

Key fields:

- `id`
- `skill_definition_id`
- `version_number`
- `content_hash`
- `instructions`
- `trigger_policy`
- `input_schema`
- `output_schema`
- `tool_allowlist`
- `source_provenance`
- `safety_scan`
- `created_by`
- `created_at`

Published rows are never edited. Revisions create a new version.

#### `skill_imports`

Tracks YouTube, text, and file ingestion.

Key fields:

- `id`
- `source_system`
- `source_id`
- `source_url`
- `extractor_version`
- `content_hash`
- `idempotency_key`
- `status`
- `scan_results`
- `candidate_count`
- `created_by`
- `created_at`

The unique idempotency key is derived from:

`source_system + source_id + extractor_version + content_hash`

#### `skill_chains`

Stable identity for a chain.

#### `skill_chain_versions`

Immutable chain metadata, trigger policy, fallback policy, and content hash.

#### `skill_chain_steps`

Ordered references to exact skill versions.

Draft chains may reference candidate or test-ready versions so the complete workflow can be evaluated together. Chain approval requires every referenced skill version to be approved already, or requires a single bundled approval transaction that approves the exact skill versions and chain version together. Activation always requires all referenced versions to be approved and unchanged.

Each step includes:

- Position.
- Required or optional behavior.
- Entry conditions.
- Success and failure transitions.
- Timeout.
- Fallback behavior.

Cycles, duplicate positions, and references to inactive or unapproved versions are rejected.

#### `agent_skill_assignments`

Binds an approved skill or chain version to an agent.

Key fields:

- `agent_id`
- `subject_type`
- `subject_version_id`
- `scope`
- `priority`
- `effective_from`
- `effective_until`
- `created_by`

Assignments support global, campaign, lead-stage, deal-path, and explicit lead scopes.

#### `skill_approvals`

Approval of an exact subject version and hash.

Key fields:

- `subject_type`
- `subject_version_id`
- `subject_hash`
- `decision`
- `approver_id`
- `evidence_snapshot`
- `decided_at`

An approval becomes stale if the underlying version or hash changes. Approval does not activate a subject.

#### `skill_activations`

Records the active rollout state.

Key fields:

- `subject_type`
- `subject_version_id`
- `environment`
- `rollout_mode`
- `rollout_percent`
- `status`
- `rollback_thresholds`
- `activated_by`
- `activated_at`
- `ended_at`

#### `skill_audit_events`

Append-only event history for imports, edits, tests, approvals, assignments, activations, pauses, rollbacks, and retirement.

#### `skill_projection_outbox`

Transactional queue for Supabase projections.

Required fields:

- `event_id`
- `aggregate_type`
- `aggregate_id`
- `authority_version`
- `schema_version`
- `dedupe_key`
- `payload_hash`
- `payload`
- `available_at`
- `lease_owner`
- `lease_expires_at`
- `attempt_count`
- `last_error`
- `delivered_at`
- `dead_lettered_at`

### 4.2 Compatibility

Existing `skills` and `skill_usage` consumers should be migrated incrementally. During transition, compatibility views or adapter functions may expose the old shape from the new authoritative model.

No compatibility layer may mark a candidate as active or let Supabase-originated data enter the runtime.

## 5. Lifecycle

The canonical lifecycle is:

1. `candidate`
2. `needs_review`
3. `test_ready`
4. `testing`
5. `failed` or `ready_for_approval`
6. `approved_inactive`
7. `canary`
8. `active`
9. `paused`, `rolled_back`, or `retired`

### Lifecycle rules

- Every import produces candidates only.
- Candidate and testing states are never runtime-selectable.
- Testing evidence belongs to an exact version.
- Approval binds the exact version and content hash.
- Approval and activation are separate actions.
- Activation defaults to a canary rollout for new or materially changed skills.
- A paused or rolled-back version is excluded from new runtime selections immediately.
- Retirement is terminal for the definition unless a new definition is created.
- Re-review can be required by an expiration date, policy change, dependency change, or drift alert.

## 6. Ingestion and Candidate Extraction

### 6.1 Sources

The first release supports:

- YouTube URL.
- Pasted text.
- Uploaded text, Markdown, PDF, or supported transcript file.

### 6.2 Pipeline

1. Accept the source and create an idempotent import record.
2. Validate size, type, URL, ownership, and workspace limits.
3. Treat all imported content as untrusted.
4. Scan for secrets, personal data, prompt injection, executable payloads, unsafe links, and licensing or provenance concerns.
5. Extract normalized source text.
6. Generate one to five candidate skills with provenance links.
7. Deduplicate against existing definitions and versions.
8. Store candidates as `candidate`.
9. Notify the operator that review is required.

### 6.3 Extraction output

Each candidate includes:

- Proposed name and purpose.
- Source excerpts and timestamps or page references.
- Trigger conditions.
- Expected inputs and outputs.
- Allowed tools.
- Risk class.
- Suggested agents.
- Suggested chain placement.
- Known limitations.
- Confidence and extraction warnings.

The model may suggest. It cannot approve, assign, activate, or bypass safety checks.

## 7. Skill and Chain Validation

### 7.1 Scenario tests

Operators can run saved or ad hoc scenarios against a candidate version. A scenario records:

- Lead and deal context.
- Expected action or response.
- Prohibited actions.
- Tool-call expectations.
- Latency budget.
- Cost budget.
- Safety assertions.
- Actual output and structured diff.

### 7.2 Chain validation

Before approval, a chain validator checks:

- Every step references an exact skill version.
- Approval either finds every referenced skill version already approved or approves the exact dependency set atomically as a reviewed bundle.
- Ordering is complete and unique.
- No graph cycle exists.
- Trigger policies do not create an unresolved precedence conflict.
- Required tools are available to the assigned agent.
- Timeouts and fallbacks are present.
- The chain stays within the declared blast radius.
- Scenario coverage satisfies the chain risk class.

### 7.3 AI-assisted chain building

AI may suggest:

- Step order.
- Missing transitions.
- Agent assignment.
- Trigger policy.
- Fallback behavior.
- Conflicts with active skills.

The operator can reorder a numbered step list, edit conditions, reject suggestions, and approve the final immutable chain version.

## 8. Runtime Selection

The existing context-aware rotator remains the primary scorer and selector.

Before scoring, the runtime applies deterministic gates:

1. Read only approved, active Render versions.
2. Filter by agent, scope, effective dates, environment, and rollout cohort.
3. Enforce DNC, compliance, risk, tool, and deal-path restrictions.
4. Apply chain precedence and prevent cycles.
5. Exclude recently repeated or explicitly suppressed skills.
6. Score remaining candidates with existing context, objection, sentiment, outcome, and embedding signals.
7. Pin the selected version or chain snapshot to the current call or workflow.
8. Record selection rationale, inputs, version, latency, and outcome correlation.

Runtime decisions remain deterministic where safety or economics require exact rules. Models are used for adaptation and phrasing, not for bypassing activation or approval policy.

## 9. Bridge API Surface

Final paths should follow existing bridge conventions, but the required operations are:

- Create an import.
- Read import status and extraction warnings.
- List candidates and filters.
- Read an exact skill version.
- Create a revised skill version without mutating the prior version.
- Run scenarios against a version.
- Create and revise a chain version.
- Validate a chain version.
- Approve or reject an exact version.
- Activate an approved version as canary or full rollout.
- Pause, rollback, retire, or supersede an activation.
- Create and expire agent assignments.
- Read audit history.
- Read projection and runtime observability.

Representative routes:

- `POST /api/skills/imports`
- `GET /api/skills/imports/:importId`
- `GET /api/skills/candidates`
- `GET /api/skills/:skillId/versions/:versionId`
- `POST /api/skills/:skillId/versions`
- `POST /api/skills/:skillId/versions/:versionId/scenarios`
- `POST /api/skill-chains`
- `POST /api/skill-chains/:chainId/versions/:versionId/validate`
- `POST /api/skill-chains/:chainId/versions/:versionId/approve`
- `POST /api/skill-activations`
- `POST /api/skill-activations/:activationId/rollback`
- `POST /api/skill-assignments`
- `GET /api/skills/observability`

All mutations require authenticated operator identity, workspace authorization, CSRF or equivalent request protection, an idempotency key where retries are possible, and an audit event.

## 10. User Experience

### 10.1 Memory & Analytics

Memory & Analytics gains:

- A prominent `Add Skill` command.
- Source history and import status.
- Candidate opportunity count.
- Active skill and chain performance summary.
- Supabase projection health, clearly labeled as a mirror.
- An `Open Skill Studio` command.

The quick import flow asks for the source, validates it, starts extraction, and routes the operator to the resulting candidate. It does not expose activation controls.

### 10.2 Skill Studio

The dedicated workspace uses the approved Hybrid Workspace layout.

#### Desktop

- Left rail: review queue, search, filters, saved views, and skill repository.
- Center workspace: persistent lifecycle stepper:
  `Review -> Scenarios -> Chain -> Agents -> Approval -> Activate -> Outcomes`
- Right rail: provenance, safety findings, dependencies, reviewer, rollout, audit, and mirror health.
- Sticky primary action that changes with lifecycle state.

The workspace shows exact versions, source references, structured diffs, affected agents and tools, trigger conflicts, scenario evidence, canary settings, and rollback controls.

#### Mobile

- List-to-detail navigation instead of a compressed three-column canvas.
- Numbered, reorderable chain list instead of a node graph.
- One fixed context-aware primary action.
- Bottom-sheet inspector for provenance, safety, and audit details.
- Touch targets of at least 44 by 44 CSS pixels.
- No horizontal overflow at 320 CSS pixels.
- Inputs remain visible above the software keyboard.

### 10.3 Visual system

- Match the existing PBK dark and light themes.
- Use the current icon library and familiar symbols for commands.
- Use rounded message-like surfaces selectively, not nested cards.
- Use matte state colors for review, warning, canary, active, paused, and failed states.
- Keep lifecycle labels visible; color is never the only signal.
- Keep operational density high without turning the page into a marketing layout.

### 10.4 Required states

The UI must distinctly represent:

- Candidate.
- Needs review.
- Test ready.
- Testing.
- Failed.
- Ready for approval.
- Approved inactive.
- Canary.
- Active.
- Paused.
- Rolled back.
- Retired.

Approval never visually implies activation.

## 11. Safety, Approval, and Rollback

### 11.1 Approval gate

Approval must display:

- Exact version and content hash.
- Structured diff from the previous approved version.
- Source provenance.
- Safety scan.
- Risk class.
- Affected agents, tools, data, and deal paths.
- Scenario coverage and failures.
- Chain dependencies and conflicts.
- Rollout plan and rollback thresholds.
- Reviewer identity and decision timestamp.

The backend rejects stale approvals and can require the creator and approver to be different operators for high-risk subjects.

### 11.2 Activation

New or materially changed subjects default to canary activation. Operators choose the permitted cohort or rollout percentage within policy limits.

Activation checks approval freshness, assignment validity, dependency state, provider availability, and scenario coverage in one authoritative transaction.

### 11.3 Automatic rollback

Rollback thresholds can include:

- Compliance or safety failure.
- Tool error rate.
- Latency regression.
- Seller complaint.
- DNC event.
- Conversion or quality regression versus baseline.
- Operator kill switch.

Rollback immediately switches the Render runtime to the prior approved version or disables the subject. A replacement or tombstone projection event is then sent to Supabase.

Approved versions remain immutable and auditable.

## 12. Supabase Projection

Supabase receives read models, embeddings, and analytics facts only after authoritative Render commits.

Projection rules:

- Upsert only when `authority_version` is newer.
- Deduplicate by outbox event ID and dedupe key.
- Verify payload hashes.
- Preserve tombstones for rollback, pause, retirement, and deletion projections.
- Never project credentials or unnecessary personal data.
- Use server-only credentials and restrictive row-level security.
- Support a complete rebuild from approved Render state.

The UI labels Supabase as `Analytics mirror`, never as `Primary`, `Fallback`, or `Authority`.

## 13. Observability

The Settings and Skill Studio health surfaces report:

- Authoritative database connectivity.
- Last-known-good runtime snapshot age.
- Pending, retrying, delivered, and dead-letter outbox counts.
- Oldest pending outbox age.
- Supabase projection lag.
- Checksum or version drift.
- Import throughput and failures.
- Candidate review age.
- Approval latency.
- Stale approvals.
- Canary and active rollout counts.
- Automatic rollback events.
- Runtime selection latency.
- Skill and chain outcome attribution.

Alerts should distinguish runtime risk from analytics mirror lag. Supabase delay alone must not mark the bridge offline.

## 14. Testing Strategy

Implementation follows test-driven development.

### 14.1 Data and service tests

- Candidate imports are never executable.
- Existing active skills remain active only through explicit compatibility rules.
- Import idempotency prevents duplicate candidates.
- Immutable versions cannot be edited after approval.
- Approval binds the exact version and hash.
- Approval does not activate.
- Stale approvals are rejected.
- Chain cycles and duplicate positions are rejected.
- Inactive or unapproved steps are rejected.
- Assignments enforce scope and effective dates.
- Authority mutation and outbox insert are atomic.
- Outbox leases prevent duplicate concurrent delivery.
- Retries are idempotent and version-aware.
- Dead-letter and replay behavior preserve ordering.
- Supabase outage does not redirect operational writes.
- Runtime uses the cached approved Render snapshot or fails closed.
- Emergency disable works while Supabase is unavailable.
- Supabase can be rebuilt from authoritative Render state.

### 14.2 Security tests

- Untrusted source content cannot inject runtime instructions.
- Secrets and high-risk personal data are flagged or blocked.
- Unsafe URLs and executable payloads are rejected.
- Browser clients cannot mutate projection tables.
- Unauthorized operators cannot approve, activate, or rollback.
- High-risk separation-of-duties policy is enforced.

### 14.3 Runtime tests

- Existing context-aware scoring remains intact.
- Agent, scope, rollout, and effective-date filters work.
- Chain precedence is deterministic.
- A call pins exact versions.
- Rollback excludes the failed version from new selections immediately.
- Selection and outcome events preserve attribution.

### 14.4 Frontend tests

- Quick import supports YouTube, text, and file sources.
- Candidate review and source provenance are keyboard accessible.
- Chain ordering works with pointer and keyboard controls.
- Approval and activation are visually and behaviorally separate.
- Mobile navigation works at 320 CSS pixels without overflow.
- Sticky actions remain reachable above the software keyboard.
- Dark and light modes retain readable contrast and visible focus.
- Loading, empty, offline, error, retry, stale, and permission-denied states are explicit.

### 14.5 Regression verification

- TypeScript and production build.
- Existing founder and bridge smoke suites.
- Existing skill learner, YouTube training, rotator, and outcome tests.
- Browser verification across desktop and mobile.
- Accessibility checks for the new routes and dialogs.

## 15. Rollout Plan

### Phase 1: Authority and lifecycle hardening

- Prevent candidate execution.
- Remove Supabase operational fallback behavior.
- Introduce immutable versions, approvals, activations, audit events, and outbox.
- Add last-known-good Render runtime snapshot.

### Phase 2: Ingestion and Skill Studio review

- Generalize the existing YouTube pipeline for YouTube, text, and files.
- Add safety scanning, idempotency, candidate extraction, and quick import.
- Add the review, scenario, and approval workspace.

### Phase 3: Chains, assignments, and runtime selection

- Add immutable chain versions and validation.
- Add agent assignments and scope.
- Integrate approved chains with the existing runtime selector.
- Add canary activation and automatic rollback.

### Phase 4: Projection, outcomes, and refinement

- Enable Supabase analytics and vector projections.
- Add reconciliation, rebuild, dead-letter operations, and drift alerts.
- Add skill and chain outcome dashboards.
- Tune selection weights only from attributable, reviewed outcomes.

Each phase must be deployable and reversible without requiring the following phase.

## 16. Acceptance Criteria

The feature is ready for production when:

1. An operator can import a YouTube URL, text, or supported file and receive one or more reviewable candidates without any candidate becoming executable.
2. The operator can inspect provenance, risks, dependencies, diffs, and scenario evidence for an exact version.
3. AI can suggest a chain, while the operator can reorder, edit, validate, approve, assign, and activate it.
4. Ava, Rex, Nurture, and Max can select only approved, active Render-backed versions within their assignment scope.
5. Approval and activation are separate, audited operations.
6. A canary can be paused or rolled back immediately without Supabase availability.
7. Supabase receives idempotent, version-aware analytical projections and can be rebuilt from Render.
8. Mirror lag is observable but does not incorrectly mark the operational bridge offline.
9. Desktop and 320-pixel mobile workflows are complete, accessible, and free of horizontal overflow.
10. Existing PBK skill selection, YouTube training, outcome recording, and agent surfaces continue to pass regression tests.

## 17. Implementation Boundary

This design is one coordinated product capability, but implementation must follow the phased boundaries above. The first implementation plan must start with Phase 1 because the current candidate activation and Supabase fallback behavior are unsafe foundations for additional ingestion.

No new ingestion UI should ship to production before Phase 1 invariants are verified.
