# PBK Supabase / Postgres Runtime

PBK uses Supabase/Postgres as the hosted OpenClaw bridge state backend when `PBK_DATABASE_URL` is set on Render.

Runtime behavior:
- The bridge auto-creates `public.bridge_state` on startup if it is missing.
- The migration in `migrations/20260430000000_pbk_bridge_state.sql` documents the same table for reproducible Supabase setup.
- The state row id is `singleton`.
- `migrations/20260430001000_pbk_operational_schema.sql` adds the normalized PBK operational tables used for CRM/UI wiring: leads, property details, BrowserOS analyzer cache, messages, calls, appointments, lead-stage transitions, contract path templates, contracts, approvals, Rex admin tasks, CRM sync events, and repository documents.
- Supabase Auth and RLS are intentionally deferred. These tables are designed for the trusted bridge/database connection first, then can receive RLS policies when the frontend moves to direct Supabase client access.

Render environment:
- Required for hosted persistence: `PBK_DATABASE_URL`
- Recommended: `PBK_BRIDGE_API_KEY` so mutating endpoints require bearer auth.

Apply migrations:
- Local or Render shell: `npm run db:migrate`
- The migration runner uses `PBK_DATABASE_URL` first, then `DATABASE_URL`.
- Applied files are tracked in `public.pbk_schema_migrations`.

Verification:
- `GET /health` should report `features.stateBackend = "postgres"`.
- `GET /health` should report `runtime.productionReady = true`.
- After applying the operational schema, Supabase should include `lead_profiles`, `property_details`, `property_cache`, `unified_messages`, `appointments`, `lead_stage_transitions`, `contract_path_templates`, `contracts`, `agent_tasks`, and `crm_sync_events`.
