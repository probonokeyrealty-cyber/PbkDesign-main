# Targeted Readiness Migration

## Authorization Boundary

This is a build artifact, not authorization to migrate or release. Current work
permits only disposable in-memory PGlite execution. Do not access production,
run the Supabase migration batch, attach this to startup, push/deploy, contact
sellers, retry deliveries, change approvals, or unlock dispatches. An offline
dry run does not connect and is not a live schema/security assessment.

## Artifacts And Scope

- `scripts/migrations/20261116-targeted-readiness.sql`: the only allowlisted SQL.
- `scripts/targeted-readiness-migration.mjs`: explicit standalone runner and
  transaction helper; importing it never starts a connection or migration.
- `scripts/targeted-readiness-migration.node-test.mjs`: mandatory disposable
  PGlite tests, executed with Node rather than discovered by Jest.

The SQL restores `public.unified_messages` using the existing operational
contract, five recording columns, four learning columns, five secondary indexes,
and the existing `public.pbk_set_updated_at()` trigger helper. An existing
compatible base table receives only the known recording/learning additions.
Missing base columns or incompatible types, nullability, defaults, lead foreign
key, named indexes or named update trigger cause rollback, not guessed repair.

RLS is enabled on the restored table and these eleven existing tables:
`activity_log`, `approvals`, `bridge_state`, `calls`, `contracts`, `lead_imports`,
`lead_profiles`, `pbk_feedback`, `pbk_intent_events`, `pbk_knowledge`, `pbk_memories`.
Only `public` is targeted. No unrelated tables, extensions, roles, credentials,
policies, grants, tenant constraints, migration-history tables or data backfills
are created. Existing approval, dispatch, delivery and message values are not
updated. Adding learning defaults does not certify any historical processing.

## Owner And Tenant Contract

The connected role must exactly match the expected role, own every affected
existing ordinary table, retain SELECT/INSERT/UPDATE/DELETE, and have public
schema CREATE/USAGE plus EXECUTE on the existing invoker update helper.
Owner writes on the new table are checked too, including default-ACL effects.
Missing schema, different owners, inherited/partitioned tables, FORCE RLS,
existing policies, and any nonowner table/column grants abort atomically.
Unexpected ACLs are not repaired by issuing grants or revocations.
Existing `anon`/`authenticated` roles with superuser/BYPASSRLS or membership
in the owner also abort. The migration never creates those roles.

Operational tenant columns are validated as nonnullable unrestricted TEXT
`workspace_id`; memory/knowledge/feedback/intent tables use `tenant_id`.
`bridge_state` is a tenantless singleton, not a source for inferred tenant IDs.
No PBK-only CHECK is imposed on uninspected existing data.

No permissive policies are installed: nonowners have no access to PBK or other
tenants, even if a table DML grant is subsequently made. This intentionally does
not support a nonowner bridge role. If one is required, stop for review of a
separate least-privilege policy with explicit PBK USING/WITH CHECK predicates;
never add an all-rows policy or broad grants to make this migration pass.

There is no FORCE RLS. Owners, superusers, BYPASSRLS roles and trusted owner-role
members are not tenant-isolated by this change. The existing bridge's privileged
owner contract and its application-level PBK authorization must remain intact.
RLS is not a substitute for founder/provider approval gates or for protecting
the owner's credentials. It does not protect against owner-issued TRUNCATE or
DDL. No newly scoped nonowner tenant access is claimed.

## Verification Allowed Now

Run from the specified worktree on `codex/targeted-readiness-repairs`:

```powershell
node --test scripts/targeted-readiness-migration.node-test.mjs
```

Tests create in-memory databases only. Fixture roles are NOSUPERUSER/NOBYPASSRLS
and disappear when PGlite closes; no external database URL is read. They use
the repository's real schema contracts and bridge full/base write SQL without
starting the bridge, assert owner compatibility and browser/unrelated role
denial across tenants, and compare original approval/state/dispatch snapshots.
Test-only grants exercise RLS independently from missing ACLs. Drift failures
must leave both schema/security and original approval state unchanged.

There is deliberately no real-Postgres/Neon test path in this module. In
particular, do not create/drop project-global roles or use an ambient
`PBK_TEST_DATABASE_URL`. A future external evaluation would require separate
authorization and the existing isolated evaluation-marker contract.

## Offline Plan

The runner reads only the dedicated `PBK_TARGETED_MIGRATION_*` variables:

| Suffix | Required value |
| --- | --- |
| `DATABASE_URL` | Explicit PostgreSQL URL for the intended target |
| `TARGET` | `local` or `render` |
| `EXPECT_HOST` | Exact URL hostname; loopback for local, validated Render host otherwise |
| `EXPECT_DATABASE` | Exact URL database name |
| `EXPECT_ROLE` | Exact URL username and affected-table owner |

`PBK_DATABASE_URL`, `DATABASE_URL`, full-batch `PBK_MIGRATION_*` settings and
apply flags are ignored. Do not put credentials into this runbook, source files,
shell history or logs. Obtain target settings through an authorized secure
process only after the future target is approved.

```powershell
node scripts/targeted-readiness-migration.mjs
```

This prints only target metadata and the SHA-256 of the single SQL file. It
does not connect, inspect a live schema, verify the supplied owner's privileges,
or mark anything ready. Query-string target/TLS/session overrides are rejected.
Render TLS certificate verification stays enabled. A target mismatch fails
before connecting; database/role identity is rechecked inside the transaction.

## Future Explicit Apply: Not Authorized Now

After independent review and separate authorization for the exact database,
role, SQL checksum and maintenance window, a future operator may use the
standalone runner with `--apply` and
`--confirm-sha256=<exact reviewed dry-run SHA-256>`. This document does not
authorize that command. Check the deployed artifact includes both runner and
SQL and do not wire them into bridge startup.

Use a dedicated connection, not a pool. The runner sets a local context guard,
checks the connected database/role, and applies the single SQL file in one
transaction with a 5-second lock timeout and 5-minute statement timeout. It
takes exclusive table locks; plan an appropriate maintenance window. The SQL
guard prevents accidental execution through the batch runner or raw SQL alone;
it is an accident-prevention marker, not a new authorization credential.

Reapplication validates the same contract and is idempotent. The checksum is
reported, not stored in a new global history table. Keep separately approved
change evidence, catalog/ACL snapshots, a secure backup and rollback procedure.
On any preflight/DDL failure, the transaction rolls back; investigate the
specific drift and obtain review instead of broadening permissions. There is
no automatic destructive down migration. After a committed future apply,
rollback or any RLS disablement is a separate reviewed security operation.

Local fixtures do not prove production schema compatibility, live role access,
runtime delivery, seller contact, recovered events, release qualification or
organic provenance. Those remain unverified until separately authorized work.
