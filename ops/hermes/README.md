# PBK Hermes Sidecar

Hermes is optional because PBK already has a live DeepSeek strategist lane inside the bridge. This sidecar lets you add the full NousResearch Hermes Agent as a separate suggest-only analyst without changing Ava's approval gates.

## Setup

1. Copy `ops/hermes/.env.example` to `ops/hermes/.env`.
2. Add real secrets locally: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and a generated `API_SERVER_KEY`.
3. Copy `config.example.yaml` to `data/config.yaml` after running the Hermes setup wizard, or use it as the reference when editing Hermes config.
4. Copy `SOUL.example.md` to `data/SOUL.md` if you want Hermes to use the PBK suggest-only identity.
5. Start the gateway:

```powershell
docker compose -f .\ops\hermes\docker-compose.yml up -d
```

6. Point the PBK bridge at it:

```powershell
$env:PBK_HERMES_ENABLED="true"
$env:PBK_HERMES_GATEWAY_URL="http://127.0.0.1:8642"
$env:PBK_HERMES_API_KEY="<same API_SERVER_KEY>"
$env:PBK_HERMES_SUGGEST_ONLY="true"
```

## Safety

Hermes is treated as an analyst, not an executor. PBK provider writes are still blocked behind the bridge approval gates.

## Smoke

```powershell
npm.cmd run hermes:smoke
```
