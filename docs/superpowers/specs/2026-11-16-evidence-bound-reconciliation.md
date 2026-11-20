# Evidence-Bound Backlog Reconciliation

## Approved Scope

The founder approved recording verified internal recovery while keeping unknown
deliveries locked. This is a metadata-only extension of the existing bridge and
Postgres evaluation store, not a replay worker or an approval decision endpoint.

## Safety Contract

- Authentication and approval gates remain unchanged.
- No seller calls, messages, delivery retries, provider reads/writes, or tool invocations.
- Never modify approvals, dispatches, dead letters, source payloads, or worker configuration.
- A completed QA job is not proof of provider delivery or of full worker recovery.
- All unresolved dispatches retain `manual_review_locked`; every dead letter retains
  `review_required` until a separate complete recovery contract is proven.
- No automatic dispatch unlock or dead-letter closure exists in this version.
- Existing audit findings, organic coverage gaps, and launch gates are never bypassed.

## Sources And Binding

Use fixed, PBK-only SELECTs in a bounded, repeatable-read, read-only transaction.
Read at most 64 unresolved dispatches and 64 dead letters; detect overflow with one
extra row and fail the entire collection closed. Include matching approval status,
the exact `call-qa-event-<event_id>` QA receipt, and bounded matching call-embedding
evidence. Do not invoke processing while collecting.

QA recovery requires the original supported `call.completed` event/source, explicit
PBK scope, nonempty string call identity and transcript, the exact deterministic QA
receipt id, matching tenant/call identity and full trimmed transcript, and valid
nonfuture receipt timestamps. A completed receipt must also contain valid scoring
outputs consistent with the existing scorer, not a null/default placeholder.
Truncated snippets cannot prove a longer transcript.
Memory verification requires matching scope/call identity, exact transcript hash
and source text, a real embedding, and nonsynthetic evidence. Missing short-call
embeddings remain unverified: payload length alone cannot prove that canonical call
fallbacks, exclusions, or optional follow-up work were completed.

Persist only opaque keyed record references, keyed source bindings, fixed enums,
counts, and a keyed full-source fingerprint. Never persist contacts, transcripts,
raw exception strings, provider ids, provider payloads, or credentials in receipts.
Bind all selected original/proof rows, including updated timestamps and failures,
so changed source data invalidates the previous receipt.

## Interfaces

`collectBacklogReconciliation({ pool, secret, now = Date.now() })` returns
`{ ok, result, reconciliation }`. Successful `reconciliation` has exactly:

```text
sourceFingerprint: hex64
complete: true
noContact: true
providerWritesBlocked: true
counts: { dispatchesLocked, deadLettersOpen, qaRecovered, qaUnverified,
          memoryVerified, memoryUnverified }
dispatches: [{ recordRef: hex64, sourceBinding: hex64,
               status: manual_review_locked, deliveryProof: unverified,
               binding: present|missing, approval: approved|pending|other|missing }]
deadLetters: [{ recordRef: hex64, sourceBinding: hex64,
                status: review_required, qa: verified|unverified,
                memory: verified|unverified, fullRecovery: unverified }]
```

Export `validateBacklogReconciliation(value)` for strict shape/count validation.
All source failures, invalid shapes, timeouts and overflow return no usable snapshot.

`executeBacklogReconciliation({ pool, revision, secret, collect, now, createId })`
and `readBacklogReconciliation({ pool, revision, secret, collect, now, id })`
persist/verify a separate `backlog_reconciliation_v1` suite in `pbk_eval_runs`,
source `server:backlog-reconciliation:v1`, schema `pbk-backlog-reconciliation-v1`.
Use a domain-separated HMAC and exact revision/tenant/row binding. Commit a signed
pending admission before collection; release its connection before source reads.
Bind the exact database admission-order timestamp, including microseconds, into
the signature and finalization comparison. Use one end-to-end 60-second execution
deadline, including database acquisition/queries and independent readbacks.
Latest admission wins even when older collection finishes late. Finalize only the
matching pending receipt, then independently read it back and recheck current sources.
Reports expire after 24 hours from start and may take at most 60 seconds to execute.
A pending, invalid, expired, mismatched, or changed-source newest receipt blocks
older evidence. No success/revision filtering may select an older report.
Evaluation `ok` is always false, `passed` is always zero, and `failed == total`
because this path does not close source records or certify launch readiness.

## Bridge And Readiness

Add empty-body founder-only `POST /api/admin/reconciliation/run`, using the existing
qualification authorizer. Reject delegation/proxy headers (including empty values),
query parameters, other methods, caller-supplied reports and override fields. Block
this route in the Netlify proxy using its existing founder-route boundary.

Expose the newest verified, source-current receipt as `backlogReconciliation` in
the existing production maturity snapshot, with summary counts and explicit
`launchQualified: false`. This is supplementary diagnostic evidence, not a
replacement for the operational audit or any approval, canary or delivery gate.
Never reduce `provider_dispatch` or `dead_letters` outstanding counts based on QA alone.

## Verification And Release Boundary

Use test-first collector/database cases, signed-store tamper/concurrency/expiry
cases, founder/proxy boundary regression tests, isolated bridge smoke, typecheck,
lint, build and dependency-closure checks. Include an independent security review.
This request authorizes building and local verification, not a push or deployment.
Do not run the new endpoint in production before a separately authorized release.
