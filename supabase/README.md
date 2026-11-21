# PBK Database Boundaries

PBK uses two PostgreSQL surfaces with different responsibilities:

- Render Postgres is the canonical OpenClaw bridge runtime database bound through `PBK_DATABASE_URL`.
- Supabase provides Storage and selected service-role-only mirrors such as `pbk_memories`.
- The browser never receives a Supabase service-role key and does not access PBK tables directly.
- Public-schema tables use RLS plus revoked `anon` and `authenticated` grants as a default-deny boundary.

Runtime behavior:

- The bridge auto-creates `public.bridge_state` on startup if it is missing.
- The migration in `migrations/20260430000000_pbk_bridge_state.sql` documents the same table for reproducible Supabase setup.
- The state row id is `singleton`.
- `migrations/20260430001000_pbk_operational_schema.sql` adds the normalized PBK operational tables used for CRM/UI wiring: leads, property details, BrowserOS analyzer cache, messages, calls, appointments, lead-stage transitions, contract path templates, contracts, approvals, Rex admin tasks, CRM sync events, and repository documents.
- Direct browser access to operational tables is prohibited. Any future authenticated client access requires a reviewed, table-specific RLS policy.

Render environment:

- Required for hosted persistence: `PBK_DATABASE_URL`
- Recommended: `PBK_BRIDGE_API_KEY` so mutating endpoints require bearer auth.

Apply migrations:

- Run `npm run db:migrate` first as a dry-run.
- Set `PBK_MIGRATION_DATABASE_URL` explicitly. Runtime variables such as `PBK_DATABASE_URL` and `DATABASE_URL` are ignored.
- Set `PBK_MIGRATION_TARGET` to `supabase`, `render`, or `local`.
- Set `PBK_MIGRATION_EXPECT_HOST` to the exact hostname from the migration URL.
- Set `PBK_MIGRATION_ALLOWLIST` to a comma-separated list of reviewed migration filenames.
- Set `PBK_MIGRATION_APPLY=true` only after the dry-run plan is reviewed.
- Applied files and SHA-256 checksums are tracked in `public.pbk_schema_migrations`.
- The runner uses an advisory lock and bounded lock/statement timeouts.

Recording retention rollout:

- Before releasing the updated bridge, apply `20261120016000_pbk_recording_retention_approvals.sql` to the canonical Render Postgres with the migration runner. The Render bridge verifies the schema and runtime-role access before opening its listener; it does not apply migrations on startup.
- Set `PBK_RECORDING_RETENTION_FOUNDER_KEY` in the bridge's private server environment and give it only to the founder. Use a high-entropy secret separate from `PBK_BRIDGE_API_KEY`. Never put it in provider settings, browser builds, or proxies.
- Direct retention decisions (`POST /api/approvals/:id/:decision` or `PUT /api/approvals/:id`) require both `Authorization: Bearer <PBK_BRIDGE_API_KEY>` and `x-pbk-recording-retention-founder-key`. The retention run verifies the durable grant using the server's founder key; the run request does not send that key. Missing or reused configuration blocks decisions and new grant consumption. Re-request unconsumed approvals signed with the old bridge key or before a founder key rotation.
- Resolve ambiguous legacy recording pointers before retention or recording storage writes. A rejected upload is released only after a recognized pre-write rejection and unchanged Storage readback. Ambiguous reservations remain locked; do not clear them or replay Storage writes without independent evidence.
- Live retention selects up to 25 eligible recordings from Postgres, oldest first. A response with `moreCandidates: true` means another batch needs its own approval; quarantined rows do not count toward that batch. The dashboard-only dry run is not a full inventory.

Verification:

- `GET /health` should report `features.stateBackend = "postgres"`.
- `GET /health` should report `runtime.productionReady = true`.
- Render Postgres should contain the bridge feature tables required by `/health` and `/api/observability/status`.
- Supabase should expose no PBK table or routine to `anon` or `authenticated` unless a future migration intentionally adds a reviewed policy.
