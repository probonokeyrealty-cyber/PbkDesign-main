# PBK n8n Lite Workflows

These workflows are the production n8n pieces the founder build relies on:

1. `pbk-lead-intake.workflow.json`
2. `pbk-approval-fanout.workflow.json`

The keep-warm workflow can stay managed in n8n cloud if you already have it active. OpenClaw remains the brain; n8n only normalizes, notifies, and callbacks.

They are intentionally deterministic. OpenClaw remains the brain.

## What they do

### Lead Intake / Import
- Trigger: CSV import, webhook, or manual POST into n8n
- Normalizes lead payload shape
- POSTs the normalized payload to the OpenClaw bridge at `POST /events`
- Uses the shared `PBK Bridge Bearer` credential instead of per-node manual headers
- OpenClaw appends activity and queues an analyzer run when an address is present
- Repeat deliveries with the same event ID are replay-safe at the bridge layer

### Approval Fanout
- Trigger A: OpenClaw sends a new approval request into n8n
- Fanout: n8n forwards that approval into your notification layer
- Trigger B: a callback webhook receives approve/reject
- Callback: n8n POSTs the decision back to the OpenClaw bridge at `POST /events`
- Uses the shared `PBK Bridge Bearer` credential instead of per-node manual headers
- Repeat callbacks for the same decision are replay-safe at the bridge layer

## Import steps

1. Make sure the OpenClaw bridge is reachable:

```bash
npm run openclaw:local
```

2. In n8n, create one credential named exactly `PBK Bridge Bearer`:
- Type: `Bearer Auth`
- Value: the same raw `PBK_BRIDGE_API_KEY` value you set on Render or your local bridge

3. Open n8n and import both workflow JSON files from this folder.

4. Open each HTTP Request node that talks to OpenClaw and confirm:
- `Authentication` = `Generic Credential Type`
- `Generic Auth Type` = `HTTP Bearer Auth`
- Credential = `PBK Bridge Bearer`

5. In the approval workflow, replace the generic notification webhook if you want a real channel:
- Slack incoming webhook
- Telegram bot node
- Email node

6. Use these defaults unless your environment differs:
- OpenClaw: `https://pbk-openclaw-bridge.onrender.com`
- n8n: `http://127.0.0.1:5678`

## Recommended local variables

Set these in n8n if you want to avoid hardcoding values inside nodes:

- `PBK_OPENCLAW_URL=https://pbk-openclaw-bridge.onrender.com`
- `PBK_BASE_URL=http://127.0.0.1:5678`
- `PBK_APPROVAL_NOTIFY_WEBHOOK=https://your-slack-or-automation-webhook`

Set these in the bridge environment so OpenClaw can fan deterministic work into n8n:

- `PBK_N8N_APPROVAL_WEBHOOK=http://127.0.0.1:5678/webhook/pbk-approval-request`
- `PBK_N8N_LEAD_WEBHOOK=http://127.0.0.1:5678/webhook/pbk-lead-intake`

## Test payloads

### Lead intake

```json
{
  "leadId": "lead-20260425-001",
  "source": "batchdata-probate-apr25.csv",
  "seller": {
    "name": "Diane Kowalski",
    "phone": "+1 (614) 555-0142",
    "email": "diane@example.com"
  },
  "property": {
    "address": "202 Cherry Ln, Columbus OH",
    "city": "Columbus",
    "state": "OH"
  },
  "tags": ["probate", "high-equity", "ohio"]
}
```

### Approval request

```json
{
  "id": "approval-offer-202-cherry",
  "leadId": "lead-diane-kowalski",
  "leadName": "Diane Kowalski",
  "address": "202 Cherry Ln, Columbus OH",
  "offerPrice": 78000,
  "mao": 91500,
  "notes": "Quick-close empathy anchor after probate rapport.",
  "createdAt": "2026-04-25T18:15:00.000Z"
}
```

### Approval callback

```json
{
  "id": "approval-offer-202-cherry",
  "status": "approved",
  "actor": "Jordan",
  "actedAt": "2026-04-25T18:17:00.000Z"
}
```
