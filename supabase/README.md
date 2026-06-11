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

Verification:

- `GET /health` should report `features.stateBackend = "postgres"`.
- `GET /health` should report `runtime.productionReady = true`.
- Render Postgres should contain the bridge feature tables required by `/health` and `/api/observability/status`.
- Supabase should expose no PBK table or routine to `anon` or `authenticated` unless a future migration intentionally adds a reviewed policy.
