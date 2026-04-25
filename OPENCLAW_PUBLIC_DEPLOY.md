# PBK OpenClaw Public Launch

This file is the shortest path from "PBK is live on Netlify" to "PBK has a public brain endpoint".

## 1. Internal launch on the OptiPlex

Run the bridge in LAN mode if you want other devices on your network to reach it:

```bash
npm run openclaw:reset
npm run openclaw:lan
```

Default LAN endpoint:

```text
http://YOUR-LAN-IP:8788
```

Use that URL in the OpenClaw Settings card inside PBK Paradise.

## 2. Public launch on Render

Render web services need to bind to `0.0.0.0` and the platform-provided `PORT`. The bridge now supports both.

Official references:

- Render web services: `https://render.com/docs/web-services`
- Render Blueprint spec: `https://render.com/docs/blueprint-spec`
- Render health checks: `https://render.com/docs/health-checks`

### What is already included

- `Dockerfile.openclaw`
- `render.yaml`
- support for `PORT`, `HOST`, and `PBK_OPENCLAW_STATE_DIR`

### Render steps

1. Push this repo to GitHub.
2. In Render, choose `New` -> `Blueprint`.
3. Point Render at this repo.
4. Confirm the `pbk-openclaw-bridge` service from `render.yaml`.
5. After deploy, copy the Render URL:

```text
https://pbk-openclaw-bridge.onrender.com
```

6. In the live PBK app, open Settings and set the OpenClaw endpoint to that URL.

### Important note about free tier

Render free web services can spin down when idle. That is fine for testing, but it creates a cold start on the first request. For always-on behavior, move the service to a paid plan.

### Important note about state

Without a persistent disk, Render uses an ephemeral filesystem. That means `.pbk-local/openclaw-state.json` can reset on restart or redeploy.

For serious usage, attach a persistent disk in Render and set the mount path so `/app/.pbk-local` stays durable.

## 3. n8n for launch

The public bridge works without n8n, but approvals and lead imports get better when the webhook URLs are set.

Use these environment variables on the public bridge:

```text
PBK_N8N_APPROVAL_WEBHOOK=https://your-n8n-host/webhook/pbk-approval-request
PBK_N8N_LEAD_WEBHOOK=https://your-n8n-host/webhook/pbk-lead-intake
```

Import the workflow files from:

- `n8n-lite/pbk-lead-intake.workflow.json`
- `n8n-lite/pbk-approval-fanout.workflow.json`

## 4. Quick launch checklist

- Netlify frontend is live.
- Bridge answers `GET /health`.
- Bridge answers `GET /state`.
- Settings endpoint in PBK points to the public bridge URL.
- Analyzer can call `analyzeDeal`.
- Approval queue updates after `POST /events`.
- Brain page loads from public bridge state.
