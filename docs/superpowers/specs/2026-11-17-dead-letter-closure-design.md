# Append-Only Evidence-Bound Dead-Letter Closure

## Status And Authority

The founder approved this design for local implementation and tests on 2026-11-17.
The founder selected a dedicated append-only Postgres ledger after
considering signed receipts in the existing evaluation store. All other technical
choices below were included in the reviewed design.

This is a backend project extending the existing reconciliation, approval and
readiness lanes. Local planning, implementation and isolated testing are authorized;
production migration, push, deployment and live closure remain outside this task.
The pasted prior-release transcript is historical reference, not new release
authorization.

## Intent And Existing Evidence

Represent a proven internal recovery without deleting or rewriting its original
failure. Readiness may discount only an explicitly approved closure whose complete
evidence is independently reverified against current durable sources.

The previous investigation, not a new live check, found four retained provider-origin
`call.completed` dead letters: four matching QA artifacts, one matching real memory
embedding, and three short inputs without execution-backed memory-skip receipts.
None required the optional script-outcome branch. One is a review candidate, not an
already closed case. Six dispatches lack final delivery proof and remain locked.

Current `backlog-reconciliation-collector.mjs` verifies QA/memory artifacts but
always reports `review_required` and `fullRecovery: unverified`. Its signed store
is diagnostic, not a closure ledger. The operational audit counts all original
dead letters, including old ones. `event-worker.mjs` defines the required QA,
memory and conditional script-outcome steps. Existing memory-skip receipts are
produced only by genuine execution of the guarded insufficient-memory branch.

## Approaches

1. Dedicated append-only Postgres ledger: selected by the founder. Adds a narrowly
   scoped migration, immutable records and explicit revocation history. Requires
   schema/privilege verification and a new readback contract.
2. Signed closure receipts in `pbk_eval_runs`: reuses storage with less schema work,
   but that table supports receipt updates and cannot itself enforce closure-only
   immutability. Not selected.

Updating/deleting original failures or treating diagnostic QA counts as closure
does not satisfy the requested history and evidence requirements.

## Non-Negotiable Boundaries

- Preserve every original dead letter, error, payload, artifact and earlier receipt.
- No source repair, worker replay, tool execution, provider lookup, seller contact,
  calls, messages, delivery attempts or delivery retries in this feature.
- Never update `provider_action_dispatches`, create provider leases, mark a delivery
  successful, or make unknown dispatches reclaimable. All six remain locked.
- Preserve existing authentication, founder/passcode protections, Slack decision
  validation, approval identities and approval-decision semantics.
- A bearer credential, free-form note or `approved: true` field is not approval.
- No new UI, navigation, autonomous scheduler or independent recovery tool.
- Do not relax memory minimums, query/row/size limits, audit windows, coverage rules,
  timing policies, independent-canary requirements or other readiness gates.
- Internal recovery is not provider delivery, a quality passing grade, a historical
  execution claim or full launch qualification.

## Ledger Contract

Proposed table: `public.pbk_dead_letter_closure_ledger`. It contains PBK-only,
append-only signed records, not copies of seller data. Fields include:

- Server-generated receipt ID, database-assigned ordering value and database UTC
  admission time, schema version, tenant fixed to `pbk`, deployed revision.
- Keyed dead-letter reference, exact original-row binding, handler-policy version,
  keyed complete evidence-manifest binding and keyed approval/decision binding.
- Action `close_internal` or `revoke_internal`, fixed reason enum, and previous
  record ID/hash for this failure. Revocation identifies the closure it supersedes.
- Strict bounded manifest: required step IDs, verified outcomes, keyed artifact
  references/bindings, true observation/execution times and explicit non-applicability.
- Server observation/completion times, approval expiry and a domain-separated HMAC
  over all meaningful fields, including database order/time and chain predecessor.
- Fixed guards: no contact, no provider writes, no retry, no delivery proof and
  `launchQualified: false`.

No names, contacts, addresses, transcripts, embeddings, raw errors, provider IDs,
free-form notes, credentials or connection URLs in the ledger/public summary.
Use keyed references/bindings for low-entropy source material; a plain transcript
hash must not become a new public disclosure. Existing source tables retain data
under their existing access controls. Derive signing keys from the existing server
secret with a separate namespace; never accept a caller's key or signature.

Rows have no mutable status. Effective status is computed from the newest record
for a reference, its chain and current source validation. A newer invalid/revoked
record blocks older closures; readers never filter to an older successful record.
Revocation requires a new decision and an append, not deletion. It cannot create
delivery authority. Re-closing a revoked case requires a fresh proposal/approval
bound to the new predecessor, even if the artifacts have not changed.

Allocate ordering and admission inside the transaction before signing. Gaps from
aborted transactions are allowed; sequence allocation alone is not commit proof.
Serialize each case with a transactional advisory lock and verify the predecessor
at commit. No pending record is updated into a final record: a transaction either
commits a complete final receipt or leaves no closure. No receipt means open.

## Database Enforcement And Migration

Use an explicit targeted migration, not automatic startup DDL. Follow the existing
guarded migration pattern: expected database/role checks, transactional install,
idempotent exact-definition verification and rollback on drift. No history backfill,
cleanup, role creation, broad grants/revokes or source-table schema changes.

Enable RLS; deny public/browser roles access. Grant only required access to the
existing trusted server role. Add `ENABLE ALWAYS` triggers rejecting UPDATE, DELETE
and TRUNCATE; disallow cascading deletion paths. Readers validate table constraints,
trigger definitions/enabled modes, RLS and actual grants/ownership before using it.
Include the new table in the existing database-security inventory with narrow
expected privileges. Missing installation or drift is unverified, never empty/pass.

If runtime is an existing owner role, do not silently replace it or claim that
triggers withstand malicious owner DDL. Triggers enforce ordinary DML immutability;
signatures, current-source readback and installation checks detect invalid evidence
within that trust boundary. Database/server owners and the signing authority remain
trusted. Any required role separation beyond current architecture needs a separate
decision, not a hidden migration change. No SQL function may expose arbitrary SQL,
disable triggers or relax source permissions; any unavoidable security-definer
helper has a fixed search path and narrowly verified execution grants.

## Complete Handler Evidence

Use fixed PBK-only SELECTs and a shared pure verifier, independent of the writer.
Bind the entire original failure row, including error, payload and timestamps; also
bind all applicable proof rows and canonical source-selection inputs. Do not call
the event worker or bridge tools to obtain missing proof.

Version 1 supports only nonsynthetic `call.completed` events from the existing
reconciliation source allowlist. Require consistent explicit PBK scope, event/call
identity, valid clocks and unambiguous bounded source resolution. Unsupported types,
unknown payload branches, duplicate/conflicting identities or schema drift stay open.

Required steps:

1. QA: exact deterministic event receipt, matching scope/call/full scoring input,
   valid scorer outputs and timestamps, nonsynthetic metadata. A low but valid score
   proves completion, not that the call passed quality review. A truncated snippet
   cannot prove a longer input; keep it blocked rather than invent a proof format.
2. Memory: apply the existing canonical/event best-transcript selection and exclusion
   policy. Require either the exact real, finite, nonzero 1536-dimensional embedding
   with matching source/model/provenance, or an independently verified signed current
   `call_memory_skip_v1` execution receipt for the same event/call/source and unchanged
   minimum-80 policy. Short text, missing embeddings, or an error string alone are
   insufficient. Honor current receipt revision/expiry/source rules; never extend
   them or manufacture/backdate a skip. Ambiguous or excluded sources stay blocked.
3. Script outcome: derive applicability from all aliases used by the worker. If
   applicable, version 1 reports unsupported proof and blocks closure. It does not
   infer completion from a generic outcome row. A later proof contract requires a
   separate reviewed extension. For the investigated four, absent script selectors
   can be bound as `not_applicable`; contradictory aliases are invalid.

Proof timestamps may reflect genuine repair after failure; report the true repair
time rather than pretending the original worker succeeded. Evidence that is stale,
missing, controlled, synthetic, cross-tenant or modified cannot qualify.

## Approval And Execution Boundary

Extend the current approval lane with one explicitly internal action, proposed name
`dead_letter_internal_closure`; it must be dispatched before any provider-action
lease or generic execution fallback and must never be classified as outbound work.
Do not alter who can approve, protected-passcode requirements, Slack verification or
existing approval routes. If durable authority cannot be established through those
gates, the closure remains blocked; do not add a founder-bearer-only apply bypass.

Proposed founder-only empty-body preview/proposal routes live under
`/api/admin/reconciliation/dead-letters/:recordRef/preview` (GET) and `/propose`
(POST). They use the existing direct-founder/header boundary; Netlify proxy access
is denied just like the existing founder reconciliation runner. No arbitrary report,
payload, action, clock, revision, secret or evidence override is accepted. The
proposal route creates only a pending entry using the existing approval creation
service and operator queue, never automatic approval. Its fixed internal action
selects `close_internal` or `revoke_internal` via a server-built proposal, not a
generic caller-supplied executor. Revocation proposals use a separate fixed
`/propose-revocation` POST with the same rules.

The server-generated intent binds one record, one original/evidence manifest,
deployed revision, handler-policy version, predecessor and expiry no more than
24 hours after proposal. This expiry limits admission/execution only: a committed
closure does not expire merely because its proposal's 24 hours later elapse.
Readback verifies that approval and any step receipts met their temporal rules at
closure admission, and independently revalidates their unchanged durable facts,
current authority state, source bindings and supported policy. Do not weaken the
existing current-read requirements for memory-skip receipts: if their existing
verifier rejects current evidence as stale/revision-mismatched, closure credit
remains blocked. These separate rules must not be conflated with proposal expiry.
A closure proposal exists only for a complete verified
manifest. Public preview of an incomplete case gives fixed missing-proof reasons,
not an approvable incomplete intent. Repeated identical proposals reuse the
existing pending intent where safe; they never mutate its approved payload.

Approved execution reloads the canonical durable PBK approval, validates the exact
intent/decision and actual approval state, and rejects pending, denied, missing,
changed, expired or unrelated approvals. Actor labels and cached bridge state are
not authority. Bind the durable decision facts and immutable intent, not generic
execution-history fields that legitimately change after execution.

Within one bounded serializable transaction, lock the approval and case, re-read
all required current sources, verify the exact approved manifest/predecessor and
append the signed ledger record. Check current server revision/clock and database
installation. Serialization/conflict/timeouts return blocked; there is no automatic
action retry. Exact repeated execution returns the existing verified receipt only
if all bindings still agree; it never creates a second closure or invokes a provider.
Use a uniqueness constraint on approval/intent binding to enforce single use.
After commit, independently read the receipt and current sources back; a readback
failure never returns verified closure even if the historical append committed.

## Readiness And Audit Readback

Keep legacy reconciliation-v1 receipts and semantics intact. Add a separately
versioned closure summary to the existing maturity response: verified count,
open count, invalidated count and fixed reason codes, plus explicit internal-only
guards. Effective states are `open`, `closed_internal_verified` or `invalidated`;
open/invalidated remain blockers. Receipt presence is not effective closure.
`invalidated` describes the current failed verification, not a silently persisted
revocation. If storage cannot establish per-case status, the entire summary is
unverified with no usable counts; do not invent zero counts or append from a GET.
If exactly the originally approved evidence and authority become independently
verifiable again after a transient outage, the same closure can regain credit.
No new evidence, changed intent, changed predecessor or durable revocation can be
substituted under that rule. An explicit revocation is permanent for that closure
and can only be superseded by a fresh, approval-backed closure record.

Use a new operational-audit schema/suite/source version for closure-aware counts.
Retain old audit rows; legacy audits cannot acquire closure credit retrospectively.
Do not change other checks or treat a new version as qualification by itself.

For the fixed audit cutoff, retain total original count and report:
`outstanding = totalOriginalsAtCutoff - verifiedInternalClosuresAtCutoff`.
Resolved rows remain visible in total and separate resolved counts. Only closures
committed by the cutoff, with valid authority and complete proofs observed by that
cutoff, may be discounted. Current source/approval/ledger readback must also pass.
New closures cannot improve an already stored audit; a fresh audit is required.
Read-time invalidations/revocations may only downgrade the signed stored result;
they never promote it beyond its originally signed verified counts/status. A later
successful read of identical evidence may remove a transient downgrade and restore
at most that signed result. No permanent outage latch or implicit mutation from a
reader is introduced. A durable revocation cannot be cleared by successful reads.

Bind the exact closure set, predecessor/history head and source manifest used by
the audit into its signed receipt. On every audit read, independently reverify
those references and current evidence, then recheck newest audit admission. Do this
even when coverage is unverified: the existing early coverage return must not skip
closure validation. Changed/missing proof, revoked approval, superseded ledger,
clock/revision mismatch or unavailable storage denies closure credit and prevents
`silentErrors.passed`. Never fall back to an older passing audit. An invalidated
closure returns its original failure to outstanding without editing either row.

Unknown dispatch, coverage, canary, monitoring, qualification, provider-delivery and
agent-readiness gates remain independent. This work cannot make their missing
evidence pass or turn a single repaired dead letter into overall readiness.

## Bounds, Failure Handling And Privacy

Retain the collector's 64-record limit with a 65th-row overflow sentinel, 65,536-byte
source/report bounds, 2-second query limit and 15-second collection deadline. New
closure reads share that end-to-end budget, not one allowance per source. Writes
and independent readback share a maximum 60-second execution deadline. Existing
audit deadlines remain unchanged; overflow or timeout fails closed, not partial.
Bound receipts/history by the same 64-plus-sentinel rule per selected case and
overall within each operation; history is retained when it outgrows a read budget,
but verification blocks until a separately reviewed bounded-history design exists.

Use parameterized fixed queries, bounded acquisition/locking, rollback on errors,
and destroy abandoned clients. No COMMIT queued behind a timed-out query. Handle
client errors and late acquisition without process crashes or connection leaks.
Read-only paths use read-only transactions and never append even diagnostic rows.
Return only sanitized fixed errors and aggregates; no raw SQL or seller data.

## Verification Required Before Any Release Proposal

- Isolated database migration twice; exact schema/role/grant/trigger checks;
  UPDATE/DELETE/TRUNCATE rejection, including replica mode; no source-row changes.
- Complete original + QA + genuine embedding closes only with an exact approved
  intent. Short-source case requires a real signed execution receipt. Missing,
  forged, stale, expired, cross-tenant, edited or ambiguous evidence stays blocked.
- Conditional-script cases block explicitly; unsupported event types do not inherit
  a partial handler manifest. No repair, replay or skip writer is invoked.
- Approval denial/pending/revocation, forged actor, payload/intent/predecessor drift,
  protected gate rejection and duplicate execution fail safely. Existing approval
  behavior and direct-founder/proxy boundaries retain regression coverage.
- Transaction conflicts, competing closure/revocation, concurrent source updates,
  bad newest receipts, interrupted transactions, deadline expiry and late clients
  cannot cause older-proof fallback, duplicate closure or partial success.
- Audit cutoff, current-source invalidation, legacy/new-version separation and
  coverage-unverified early-return cases cannot hide an original failure. Missing
  schema, ledger tampering and storage failures deny closure credit.
- Before/after hashes show originals, dispatches and unrelated approvals unchanged
  in fixtures. Provider/network stubs fail on every attempted external operation;
  unknown-dispatch lock/lease tests stay unchanged and pass.
- Privacy tests, focused unit/integration tests, guarded isolated real-Postgres
  proof, bridge auth/proxy smoke, Docker import closure, typecheck, lint and build.
  Independent correctness/security review before publication is proposed.

No production tests, seller playback or hosted writes are required to finalize this
design. Later rollout must be separately authorized, run migration preflight and
verify source/dispatch/auth fingerprints without contacting sellers. Rollback means
stop using closure credit and preserve ledger/source history, never DROP/TRUNCATE.

## Builder Discretion And Next Gate

Module/helper/index names, test fixture layout and extraction of shared pure
validators are builder choices. Keep edits scoped to reconciliation/approval
integration, ledger migration and closure-aware audit/readiness; no unrelated
refactor or new dependency unless needed and justified. Do not reinterpret
unsupported proof as sufficient to save implementation effort.

After founder approval of this design, invoke the writing-plans workflow for local
implementation and tests. Push, PR, merge, production migration/deployment and live
closure execution still require separate explicit authorization.

## Design Review Record

An independent builder check raised proposal-expiry and transient-readback questions.
Both were resolved above as proposed engineering decisions: expiry limits execution,
and readback may restore only the exact signed result after a transient failure;
durable revocation requires a fresh decision. The follow-up builder check reported
no important planning questions remaining. This is a design review, not a product
security audit or implementation/test result. Only this document changed; no product
tests, database connections, production actions or seller contact were performed.
