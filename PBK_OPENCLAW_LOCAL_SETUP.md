# PBK Local OpenClaw Bridge

This repo now includes a local OpenClaw-compatible bridge for the 2-day PBK MVP.

## Start it

From [`C:\Users\Dell\Documents\New project 2\PbkDesign-main`](/C:/Users/Dell/Documents/New%20project%202/PbkDesign-main):

```bash
npm run openclaw:local
```

If you want the bridge reachable from other devices on your network:

```bash
npm run openclaw:lan
```

If you want to reset to the seeded demo state first:

```bash
npm run openclaw:reset
```

Default local endpoint:

```text
http://127.0.0.1:8788
```

LAN mode endpoint:

```text
http://YOUR-LAN-IP:8788
```

Use that value in the OpenClaw card under Settings in PBK Paradise.

## Endpoints

### `GET /health`

Returns runtime health, active tools, and whether n8n hooks are configured.

### `GET /state`

Returns the frontend snapshot used by PBK:

```json
{
  "status": {},
  "approvals": [],
  "activity": [],
  "brainDocs": [],
  "leadImports": [],
  "analyzerRuns": []
}
```

### `POST /invoke`

Accepted tool names:

- `analyzeDeal`
- `createApproval`
- `updateCRM`
- `ingestResearchDoc`
- `getBrainState`

Example:

```json
{
  "toolName": "analyzeDeal",
  "params": {
    "address": "202 Cherry Ln, Columbus OH",
    "deal": {
      "fee": 8000,
      "repairs": { "mid": 38000 },
      "comps": {
        "A": { "price": 182000 },
        "B": { "price": 188000 },
        "C": { "price": 185000 }
      }
    }
  }
}
```

### `POST /events`

Supported event types:

- `lead-intake`
- `approval-callback`
- `brain-doc`

Example lead intake:

```json
{
  "eventType": "lead-intake",
  "payload": {
    "leadId": "lead-20260425-001",
    "source": "batchdata-probate-apr25.csv",
    "seller": {
      "name": "Diane Kowalski",
      "phone": "+1 (614) 555-0142"
    },
    "property": {
      "address": "202 Cherry Ln, Columbus OH"
    },
    "tags": ["probate", "high-equity", "ohio"]
  }
}
```

## Persistence

The bridge writes its runtime state to:

```text
.pbk-local/openclaw-state.json
```

That folder is ignored by git so your local runtime data stays local.

## Optional n8n integration

If you want OpenClaw to fan approval requests directly into n8n, start the local bridge with:

```bash
$env:PBK_N8N_APPROVAL_WEBHOOK='http://127.0.0.1:5678/webhook/pbk-approval-request'; npm run openclaw:local
```

If you want lead events to forward into another local automation:

```bash
$env:PBK_N8N_LEAD_WEBHOOK='http://127.0.0.1:5678/webhook/pbk-lead-intake'; npm run openclaw:local
```

The importable workflow files live in [`C:\Users\Dell\Documents\New project 2\PbkDesign-main\n8n-lite`](/C:/Users/Dell/Documents/New%20project%202/PbkDesign-main/n8n-lite).
