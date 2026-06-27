# PBK Founder Release Checklist

Use this checklist before calling the founder build production-ready.

## Build

- Run `npm run build`
- Run `npm run test:mcp`
- Run `npm run test:bridge`
- Run `npm run test:neon-evaluation-harness`
- Run `npm run test:mobile-browser-proof`
- Run `npm run test:hosted` when hosted bridge secrets are available

## Bridge

- `GET /health` returns:
  - a non-empty `revision`
  - `features.authRequired = true`
  - `features.stateBackend = "postgres"` on hosted Render
- `GET /state` without auth returns `401`
- `GET /state` with the bearer key returns live runtime state
- `POST /invoke` with `getBrainState` succeeds
- `POST /api/documents/pdf` returns a valid PDF
- Hosted founder smoke passes against the live Render bridge

## Analyzer + Contracts

- Analyzer is reachable through `analyzer.html`
- `window.PBKAnalyzer.getState()` returns a populated snapshot for the current deal
- Contract actions use analyzer-backed seller, address, and pricing data
- If the PDF renderer is unavailable, analyzer preview fallback still opens cleanly
- If the PDF renderer is healthy, the bridge returns a downloadable PDF

## n8n

- Lead intake workflow uses the `PBK Bridge Bearer` credential
- Approval fanout workflow uses the `PBK Bridge Bearer` credential
- Lead replay with the same event ID does not create duplicate import activity
- Approval replay with the same decision payload does not create duplicate approval activity
- Keep-warm workflow is active if Render is still on the free tier

## Founder UI

- Settings shows:
  - connection status
  - revision
  - backend mode
  - auth state
  - last successful sync
- Approval queue makes stale bridge state obvious when disconnected
- Brain header shows last successful sync context when disconnected
- Contract panel clearly distinguishes:
  - `PDF renderer live`
  - `Analyzer preview fallback`

## Hosted Runtime

- Render envs are set:
  - `PBK_BRIDGE_API_KEY`
  - `PBK_DATABASE_URL`
  - `PBK_N8N_APPROVAL_WEBHOOK`
  - `PBK_N8N_LEAD_WEBHOOK`
- Hosted bridge is not relying on file-backed state for important data
- Netlify still renders all current tabs cleanly after a hard refresh

## Disposable Eval Lane

- `npm run neon:evaluation:dry-run` prints a sanitized branch payload and eval environment
- PBK Agent Evals workflow passed with a disposable Neon branch
- Live Neon evals use `NEON_API_KEY` and `NEON_PROJECT_ID`, not `PBK_DATABASE_URL`
- Default eval commands receive `PBK_TEST_DATABASE_URL` and `PBK_EVAL_DATABASE_URL`
- `PBK_DATABASE_URL`, `DATABASE_URL`, `SUPABASE_DB_URL`, and `PBK_MIGRATION_DATABASE_URL` stay scrubbed unless `--inject-runtime-db` is used intentionally
- Temporary Neon branches have `expires_at` and are deleted after the child command exits
- No `pbk-eval-*` branches remain after CI completion

## Proof, Policy, and Autonomy Release Gate

- Provider proof ledger smoke passed.
- Live provider proof harness dry-run passed.
- Approval unison source and live proof passed.
- Ava action decision policy passed.
- CRM field provenance smoke passed.
- Call learning backfill dry-run passed.
- Operator copy smoke passed.
- Mobile browser proof passed against a fresh preview build.
- Neon disposable eval dry-run passed locally, and live CI eval passed when secrets are available.
- System Health operator panel smoke passed.
- Compliance audit trail smoke passed.
- Production hardening smoke passed.
- `npm run test:proof-policy-autonomy` passed.
