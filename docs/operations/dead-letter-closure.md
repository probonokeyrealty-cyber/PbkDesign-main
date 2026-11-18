# Internal Dead-Letter Closure

## Meaning And Authority

An effective `close_internal` is a signed, append-only internal recovery receipt,
not provider delivery, worker execution, a QA passing grade, or launch qualification.
Every original dead letter, payload, error and earlier receipt remains unchanged.
Unknown provider dispatches stay locked. This lane never contacts sellers, retries
delivery, repairs sources, creates leases or changes dispatch state.

Only the direct founder can preview/propose through the existing bridge:

- `GET /api/admin/reconciliation/dead-letters/:recordRef/preview`
- `POST /api/admin/reconciliation/dead-letters/:recordRef/propose`
- `POST /api/admin/reconciliation/dead-letters/:recordRef/propose-revocation`

`recordRef` is the keyed lowercase hex64 reference, not a raw source ID. Requests
accept no evidence, action, approval ID, clock, revision or report; POST body is `{}`.
Existing global auth/TOTP and founder protections apply. The Netlify proxy cannot
lend founder authority to this route family. There is no public execute endpoint
or invoke tool. A proposal enters the existing admin approval queue; canonical
approved authority is independently reloaded at execution and readback. Cached
approval, transport identity or a signed intent alone is not execution authority.

## Effective Closure And Revocation

Current closure requires the exact authenticated original, supported event handler,
current eligible evidence manifest, current canonical approval decision, revision,
installation and newest ledger head. A reused intent cannot append twice. A later
change is a new approval bound to the current predecessor, never an edit to history.
`revoke_internal` appends a withdrawal with a new approval. Lost QA/memory evidence
does not prevent withdrawing an otherwise authenticated close.

Missing originals, authority changes, source/proof drift or expiry, broken chains,
unreadable data, installation drift, overflow and timeouts fail closed. A failed
read is not an empty backlog. Restored identical proof can restore only previously
signed credit; a newer beneficial closure cannot improve an old audit. A v3 audit
uses actual transaction snapshot visibility, not timestamps alone: a close held
uncommitted at capture cannot gain historical credit after commit. The newest head
is still selected; there is no fallback to an older good receipt.

The fixed limits remain 64 rows plus a 65th overflow sentinel, 65,536-byte evidence
and report bounds, 2-second query/acquisition, 15-second collection, and a shared
60-second closure write/readback deadline. Earlier audit limits are unchanged.

## Database Trust Boundary

The reviewed SQL asset is `scripts/migrations/20261117-dead-letter-closure.sql`.
The runtime packages it for exact installation verification, not startup execution.
No startup migration runner or production workflow was added. The ledger rejects
UPDATE/DELETE/TRUNCATE using an ALWAYS trigger in normal and replica modes. The
verifier checks exact columns, constraints, indexes, trigger/function, RLS and ACLs.

The existing trusted database owner and superuser can change DDL and remain outside
this tamper boundary. This is not immunity against a hostile owner. Production
roles are not created by this migration. Schema changes and rollout require a
separate reviewed release authorization, backup/rollback procedure, selected
database/role identity and reviewed SQL checksum. This local work authorizes none
of those production actions. Do not run the migration or close live records based
on a build, PGlite run, or disposable native result alone.

## Proposal And Preview Behavior

Identical proposals reuse one durable, currently valid pending approval only when
case, action, complete original/evidence bindings, policy, current revision and
predecessor agree. A bounded per-case database lock serializes proposal creation;
the existing approval creation service performs an insert-only admission. Reuse
does not refresh expiry, rewrite a payload or repeat queue/notification fanout.
Missing storage, overflow, ambiguous candidates, lock timeout or failed durable
readback blocks confirmation. Cached/file-only approvals never qualify. Approved
payloads are not rewritten; approved execution still independently reloads every
authority/evidence binding and cannot obtain authority from proposal reuse.

Current preview cases include `eligibility: { eligible, reasons }`. The bounded
reason vocabulary is `source_ambiguous`, `source_unverified`, `qa_unverified`,
`memory_skip_unverified`, `memory_unverified`, `script_proof_unsupported`. No raw
rows, notes, errors, IDs or seller data are exposed. Incomplete proof never creates
an approvable intent. These diagnostics do not alter the frozen v1 audit-reference
case shape or signing domain; audit readback can still only downgrade signed credit.

Already-decided closure callbacks require exact canonical identity, signed intent,
status, actor and decision time. Mismatches return sanitized HTTP409, not status-only
success. Exact approved replay still requires independent closure verification.
Slack's transport acknowledgement is not proof of successful closure; verified
Slack decisions use the same mismatch rule, and forged Slack requests stay denied.

## Inherited Security Release Blocker

HIGH PRIORITY: nonclosure raw approval callbacks lack the standard route's
canonical decision-role parity. Global bearer/team authentication exists, but it
does not replace authorization for the particular approval. This inherited P1 is
unchanged by the closure work and is NOT certified safe. A separate security owner
must disposition and resolve it, with transport-parity tests, before broad safety
or release certification. The closure lane's own canonical admin/verified-Slack
gate does not repair or certify other callback actions. Do not interpret local
closure test results as approval to release the wider runtime.

## Local Verification

Use Node 22 first in PATH. Remove ambient DB URLs/native opt-ins before unit tests.

```powershell
npm run test:dead-letter-closure
npm run test:dead-letter-closure-bridge
npm run test:unit
$env:PBK_CLOSURE_TEST_ENABLE='1'
try { npm run test:dead-letter-closure-postgres } finally {
  Remove-Item Env:PBK_CLOSURE_TEST_ENABLE
}
```

The native command refuses without explicit opt-in; that refusal is a proof gap,
not a passing skip. It requires already-running local Docker Desktop context
`desktop-linux` with endpoint `npipe:////./pipe/dockerDesktopLinuxEngine` and the
already-downloaded `pgvector/pgvector:0.8.7-pg17` image at digest
`sha256:b513c48566e4777cd3370451400000c78eda6a08131d68f4c31d4a76f27bd8fd`.
It never starts/repairs Docker, pulls an image, resets/prunes data, provisions a
remote database, or reads runtime database settings.

The wrapper creates only a unique `pbk.closure-test` labelled, auto-removed
container with tmpfs data and literal `127.0.0.1` publication. It generates
`pbk_closure_test_<32 random hex>` and a nonsuperuser/non-BYPASSRLS owner with no
role/database creation rights. Passwords exist only in process/child environment
and PostgreSQL protocol, never CLI arguments, reports, source files or saved URLs.
Container environment holds its temporary bootstrap password until auto-removal.
Do not dump container inspect output or logs while this temporary fixture runs.

Only the test child receives `PBK_CLOSURE_TEST_DATABASE_URL`, `EXPECT_HOST`,
`EXPECT_DATABASE`, `EXPECT_ROLE` (each with the same `PBK_CLOSURE_TEST_` prefix),
and `PBK_CLOSURE_TEST_ENABLE=1`. `closureNativeEnvironment` validates these fields
using the existing strict migration guard and maps them to the standalone body's
`PBK_CLOSURE_MIGRATION_*` fields plus `PBK_CLOSURE_PG_TEST_ENABLE=1`. This mapping
is test-only, not the runtime `PBK_DATABASE_URL`/`DATABASE_URL` pool selector.
The wrapper does not accept an ambient target. It passes a fixture-only bootstrap
credential to install pgvector after the empty guard and ledger migration; the
runtime owner is never promoted to superuser. Replica testing uses fixture-only
`GRANT SET ON PARAMETER session_replication_role`.

The runtime deliberately rejects incompatible database/server clock ordering.
Synchronize clocks before release; a database clock ahead of server completion
can deny even a valid closure. The native fixture buffers unchanged database time
responses until the host catches up, capped at 100 ms inside the unchanged 2s query
budget. It also proves a backwards completion clock refuses without appending.
This is a transport-only fixture, not a runtime clock tolerance or readiness claim.

Before fixtures/migration, both wrapper and native body verify connected identity,
least privilege and generated empty DB. Finally all clients/pools close; cleanup
rechecks generated database ownership, exact container ID/image/label/tmpfs and
loopback mapping before dropping that verified DB and stopping only that container.
If a cleanup guard fails, investigate the owned resource manually; never broaden
cleanup to a prune/reset or unrelated database/container. Aggregate results belong
in the validation report; raw source rows and credentials do not.
