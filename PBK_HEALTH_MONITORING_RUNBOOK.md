# PBK Command Center Health Monitoring Runbook

Date: 2026-05-08

This runbook turns the troubleshooting checklist into a repeatable, read-only health pass. It does not send SMS, email, calls, contracts, or provider writes.

## What `/health` now shows

The bridge `/health` payload still includes the existing provider metadata, plus a new plain-English `components` block:

- `bridge`: bridge revision, runtime mode, and state backend.
- `postgres`: whether production state is Postgres-backed.
- `telnyx`: phone and SMS provider readiness.
- `deepgram`: speech-to-text readiness.
- `browserVoice`: dashboard microphone session readiness.
- `elevenlabs`: text-to-speech readiness.
- `openAiWebSearch`: OpenAI Responses API web search readiness.
- `docusign`: contract envelope provider readiness.
- `n8n`: workflow automation readiness.
- `slack`: approval and notification readiness.
- `render`: deploy/restart operations readiness.
- `batchdata`: optional skip-trace enrichment.
- `browseros` and `bytebot`: optional desktop/browser workers.

Required components report `up`, `degraded`, `missing`, or `unknown`. Optional components report `optional` or `optional_missing` without blocking the core launch posture.

## Weekly health command

Run from the PBK repo:

```powershell
npm run health:weekly
```

For machine-readable output:

```powershell
npm run health:weekly:json
```

For strict mode where optional warnings fail the run:

```powershell
node ./scripts/pbk-weekly-health-check.mjs --strict
```

## Environment variables

- `PBK_BRIDGE_URL`: hosted bridge URL. Defaults to `https://pbk-openclaw-bridge.onrender.com`.
- `PBK_BRIDGE_API_KEY`: optional bearer token for protected read-only checks.
- `PBK_COMMAND_CENTER_URL`: frontend URL. Defaults to `https://pbkcommandcenter.netlify.app`.
- `PBK_SLACK_ALERT_WEBHOOK`: optional Slack webhook for health alerts.
- `PBK_HEALTH_NOTIFY_SLACK=true`: sends Slack alert only when required checks fail.
- `PBK_HEALTH_STRICT=true`: treats optional warnings as failures.

## What the script checks

- Bridge `/health`.
- Netlify frontend `HEAD /`.
- Browser voice health endpoint.
- Deepgram health endpoint.
- TOTP status endpoint.
- Component readiness from the new `/health.components` block.

## Safe launch interpretation

Production-ready core means:

- `bridge`, `postgres`, `telnyx`, `deepgram`, `browserVoice`, `elevenlabs`, `openAiWebSearch`, `docusign`, `n8n`, `slack`, and `render` are `up`.
- `batchdata`, `browseros`, and `bytebot` can remain optional until you intentionally enable them.
- Provider writes remain approval-gated.
- Real phone proof still requires one answered call with speech.

## Suggested Monday cadence

1. Run `npm run health:weekly`.
2. Run `npm run test:hosted`.
3. Check Render logs for recent `error` or `warn`.
4. Check n8n execution history for failed workflows.
5. Confirm Slack approvals still log Approve, Decline, and Modify decisions.

