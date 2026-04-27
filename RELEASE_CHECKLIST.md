# PBK Founder Release Checklist

Use this checklist before calling the founder build production-ready.

## Build

- Run `npm run build`
- Run `npm run test:mcp`
- Run `npm run test:bridge`
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
