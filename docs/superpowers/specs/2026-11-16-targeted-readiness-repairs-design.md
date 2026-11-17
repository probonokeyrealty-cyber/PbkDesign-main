# Targeted Readiness Repairs

## Intent And Boundary

Implement the repairs requested after the read-only investigation of release
8cea9ae. Build and verify locally; no production migration, execution, push,
deployment, provider call, seller message, delivery retry or dispatch unlock.
Authentication, founder authorization, provider approvals and tenant boundaries
remain unchanged. Preserve the existing command-center UI and bridge architecture.

## Approach

Use a narrowly scoped explicit Render migration and existing bridge-backed evidence
stores. Do not run the full Supabase migration history, auto-migrate privileged
security changes during startup, weaken readiness checks or invent missing history.
This implements the repair direction requested by the founder; detailed engineering
defaults below are implementation decisions, not additional founder-approved policy.

### Schema And Security

Restore unified_messages using its existing operational, recording and learning
column contracts. Keep its indexes/update behavior compatible with current bridge
and conversation-store reads/writes. Enable RLS on the eleven known legacy tables
and the restored table, without forcing RLS on owners, changing application
credentials, granting PUBLIC/anon/authenticated access or altering approvals.
Use explicit PBK tenant checks and preserve the existing privileged bridge-owner
access contract. Abort on unexpected/missing legacy schema; do not silently create
unrelated tables or broaden role permissions. Supply an explicit reviewed migration
runner/dry-run path, never a startup hook. Test repeatability, role compatibility,
tenant isolation, cross-tenant rejection and original dispatch/approval preservation.

### Memory Outcome Evidence

Add a durable evidence-bound outcome for a genuinely executed short-transcript skip
through the existing memory pipeline. Reuse PBK Postgres/evaluation patterns and
signing; persist no transcript, phone, address or other seller content. Bind tenant,
call/event identity, exact normalized source, policy version/minimum and execution
time. Distinguish verified skip from verified embedding and from full event recovery.
Missing/changed/forged/stale/cross-tenant receipts fail closed. Do not infer a
historical completed skip from transcript length or manufacture embeddings for the
three old events. Any new public shape must preserve compatibility or explicitly
version its signed schema. Unknown dispatches and full-recovery gates stay locked.

### Fleet Evidence

Replace empty latency-budget wiring with a validated server-side policy adapter.
Separate chat/phone/research/provider channels and first-token/completion/speech
milestones. Policy readiness must not impose a generation cutoff on detailed Ava
replies. Reject invalid or absent policy values rather than inventing a pass.
Preserve unknown/legacy observations as unverified; do not fabricate operational
samples. Require real source-bound context freshness. Add tests showing valid
configured timing can qualify while malformed/old/mixed evidence cannot.

### Still Blocked

New release qualification and signed operational audit require explicit execution
after a separately authorized release. Real organic provenance, monitoring
continuity, independent canary evidence and provider delivery proof are not produced
by this implementation or by local tests. Keep their gates fail-closed.

## Verification

Test-first per module, independent security/spec review, focused regressions,
typecheck, lint, production build, Docker import closure, and isolated bridge smokes.
Use disposable PGlite/Postgres only for migrations and fixtures; never production.
Document remaining gaps honestly and preserve unrelated output/user work.
