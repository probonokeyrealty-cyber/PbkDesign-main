# Targeted Readiness Repairs

## Build Is Not Release

This branch adds an explicit migration and evidence wiring. It does not authorize
publication, deployment, production migration, memory backfill, event replay,
seller contact, dispatch unlocks or delivery retries. Authentication and approval
gates remain unchanged. Production state stays on Render; Neon is disposable
evaluation state only.

## Schema And Security

`npm run migration:targeted-readiness` is an offline dry run. It ignores ordinary
runtime database URLs and reports one migration checksum, not secret credentials.
Configure the dedicated `PBK_TARGETED_MIGRATION_*` variables documented in
`.env.example` to name the exact target host, database and owner role. Explicit
application additionally requires `--apply --confirm-sha256=<reviewed checksum>`.
The checksum confirms the exact reviewed SQL, not permission to execute it.

The migration restores `unified_messages` with base, recording and learning
contracts and enables RLS on that table and eleven known legacy tables. It creates
no permissive policies or grants, does not FORCE RLS, and preserves privileged
table-owner access. Nonowner access remains denied. Authentication, approval
decisions and original dispatch/message records are not rewritten.

Unexpected ownership, ACLs, policies, tenant columns, inherited/partitioned tables,
helper/trigger contracts or incompatible message schema abort the transaction.
Do not bypass a refusal by broadening grants, forcing policies or running the full
Supabase migration batch. Inspect the actual target and revise/review the narrow
migration first. This default-deny owner contract does not make the bridge owner
itself tenant-restricted; existing bridge authorization and scoped SQL remain essential.

For a separately authorized Render one-off job, the image contains the migration
module and SQL. Its exported `applyTargetedReadinessMigration(client, expected)`
requires a dedicated connected client and explicit expected database/role identity.
Do not import the running bridge entrypoint or change persistent startup commands.
The CLI requires verified TLS for nonlocal URLs; Render internal self-signed TLS
needs a separately reviewed connection policy using the existing private runtime
boundary, not a public allowlist expansion or a blanket TLS-disable environment flag.

## Memory Skip Evidence

The real memory tool records a skip only after evaluating its insufficient-source
branch, and only when an original event identifier is supplied. The store rereads
the PBK dead letter and canonical call/alias records, checks source identity and
normalization, and signs an opaque receipt in existing `pbk_eval_runs`.

Receipts contain keyed source bindings, not seller transcripts/contact details.
They are revision/policy/time/source bound and idempotent. Changed source data,
forged/tampered/expired receipts, ambiguous calls, cross-tenant identities,
controlled fixtures and incomplete database reads remain unverified.

`backlogReconciliation.memoryPolicyOutcomes` is supplementary. `verified_skip`
means the short-source branch actually executed and has matching durable evidence.
`not_applicable` means the source is not short; it is not a verified embedding.
Neither can certify full worker recovery, provider delivery or launch readiness.
The signed backlog-v1 embedding counts and all unknown-dispatch locks stay unchanged.
The three old short transcripts are not automatically backfilled or declared recovered.

## Fleet Timing Policy

`PBK_AGENT_LATENCY_BUDGETS_MS` is a server-only JSON matrix. It is not a model
timeout and cannot cut off a detailed answer or speech. Allowed channels are
`chat`, `phone`, `research`, `provider`; milestones are `first_token`, `completion`,
`speech_start`, `speech_completion`. Values must be positive finite numbers.

Only the existing 1800 ms chat/phone first-token SLO is supplied as a default.
Completion budgets for all four channels and phone speech milestones require
reviewed explicit configuration. Missing, partial or invalid policy returns no
usable budgets and blocks fleet qualification. Unknown keys/values are not echoed
into operator diagnostics.

For every observed channel the required milestones must actually be measured:
chat first token/completion; phone first token/completion/speech start/speech
completion; research/provider completion. A completion-only phone/chat run cannot
qualify. Timing provenance, fresh source-bound context, minimum samples and channel
separation remain required. Rebuilding a packet never refreshes its source timestamp.

## Checks And Remaining Evidence

- `npm run test:targeted-readiness-migration`: disposable PGlite schema/role tests.
- `npm run test:unit`: signed receipts, policy, bridge wiring and CI guard regressions.
- `npm run test:backlog-reconciliation-bridge`: isolated runtime with outbound access blocked.
- Release Qualification additionally runs the guarded real-Postgres fixture on a
  dedicated `pbk-eval-targeted-readiness-*` branch. The guard validates actual Neon
  metadata and endpoint identity before resetting the disposable fixture schema.
  It rejects connection/session overrides and supplies explicit verified driver
  fields, never an unchecked URI that could override the verified host.
- Founder/Release CI retains its existing approval, dispatch, Postgres and browser gates.

After a separately approved release/migration, execute the existing fixed
founder-only qualification and operational audit for the new deployed revision.
Do not carry forward a previous revision's signed pass. Organic provenance,
monitoring continuity, source freshness, independent canary comparisons and actual
delivery proof still need genuine evidence; local tests do not fill those gaps.
