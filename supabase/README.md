# PBK Supabase / Postgres Runtime

PBK uses Supabase/Postgres as the hosted OpenClaw bridge state backend when `PBK_DATABASE_URL` is set on Render.

Runtime behavior:
- The bridge auto-creates `public.bridge_state` on startup if it is missing.
- The migration in `migrations/20260430000000_pbk_bridge_state.sql` documents the same table for reproducible Supabase setup.
- The state row id is `singleton`.

Render environment:
- Required for hosted persistence: `PBK_DATABASE_URL`
- Recommended: `PBK_BRIDGE_API_KEY` so mutating endpoints require bearer auth.

Verification:
- `GET /health` should report `features.stateBackend = "postgres"`.
- `GET /health` should report `runtime.productionReady = true`.
