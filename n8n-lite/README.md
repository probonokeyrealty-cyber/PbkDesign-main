# PBK n8n Lite Workflows

These workflows are the only n8n pieces required for the 2-day PBK MVP:

1. `pbk-lead-intake.workflow.json`
2. `pbk-approval-fanout.workflow.json`

They are intentionally deterministic. OpenClaw remains the brain.

## What they do

### Lead Intake / Import
- Trigger: CSV import, webhook, or manual POST into n8n
- Normalizes lead payload shape
- POSTs the normalized payload to the local OpenClaw bridge at `POST /events`
- OpenClaw appends activity and queues an analyzer run when an address is present

### Approval Fanout
- Trigger A: OpenClaw sends a new approval request into n8n
- Fanout: n8n forwards that approval into your notification layer
- Trigger B: a callback webhook receives approve/reject
- Callback: n8n POSTs the decision back to the local OpenClaw bridge at `POST /events`

## Import steps

1. Start the local PBK OpenClaw bridge:

```bash
npm run openclaw:local
```

2. Open n8n and import both workflow JSON files from this folder.

3. In the approval workflow, replace the generic notification webhook if you want a real channel:
- Slack incoming webhook
- Telegram bot node
- Email node

4. Use these local defaults unless your machine differs:
- OpenClaw: `http://127.0.0.1:8788`
- n8n: `http://127.0.0.1:5678`

## Recommended local variables

Set these in n8n if you want to avoid hardcoding values inside nodes:

- `PBK_OPENCLAW_URL=http://127.0.0.1:8788`
- `PBK_BASE_URL=http://127.0.0.1:5678`
- `PBK_APPROVAL_NOTIFY_WEBHOOK=https://your-slack-or-automation-webhook`

Set this in the PBK local bridge environment if you want OpenClaw to fan approval requests directly into n8n:

- `PBK_N8N_APPROVAL_WEBHOOK=http://127.0.0.1:5678/webhook/pbk-approval-request`

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
