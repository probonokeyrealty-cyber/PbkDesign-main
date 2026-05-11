# Hermes Launch Runbook

PBK now has two safe Hermes paths:

- Internal path: PBK bridge uses the existing DeepSeek strategist lane and marks Hermes as a suggest-only analyst in `/health` and `/api/hermes/status`.
- External path: optional NousResearch Hermes Agent sidecar in `ops/hermes/`, reachable through `PBK_HERMES_GATEWAY_URL`.

## Guardrail

Hermes is not allowed to execute provider writes. Calls, SMS, email sends, DocuSign envelopes, deletes, admin env updates, and offer increases still go through PBK approval mode.

## Render Env

Required for internal path:

```text
PBK_HERMES_ENABLED=true
PBK_HERMES_SUGGEST_ONLY=true
PBK_DEEPSEEK_API_KEY=<set privately in Render>
PBK_STRATEGIST_PROVIDER=deepseek
```

Optional for external sidecar:

```text
PBK_HERMES_GATEWAY_URL=http://<reachable-hermes-host>:8642
PBK_HERMES_API_KEY=<API_SERVER_KEY>
PBK_HERMES_SLACK_CHANNEL=#hermes-insights
```

## Local Sidecar

```powershell
Copy-Item .\ops\hermes\.env.example .\ops\hermes\.env
# Fill DEEPSEEK_API_KEY, OPENAI_API_KEY, API_SERVER_KEY in ops/hermes/.env
docker compose -f .\ops\hermes\docker-compose.yml up -d
npm.cmd run hermes:smoke
```

## Production Smoke

```powershell
npm.cmd run test:hosted
npm.cmd run health:weekly:json
npm.cmd run hermes:smoke
```

Set `PBK_HERMES_RUN_RECOMMENDATION=true` only when you want the smoke to create a stored strategist recommendation.
