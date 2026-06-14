# Communication Identities

Communication identity controls which phone number or email address PBK uses
when an operator sends a seller message.

## Identity Sources

| Source                  | Endpoint                                                  |
| ----------------------- | --------------------------------------------------------- |
| SMS/Telnyx numbers      | `GET /api/communication-identities`                       |
| Email sender identities | `GET /api/communication-identities`                       |
| Thread recommendation   | `POST /api/conversations/:threadId/sender-recommendation` |

The UI should show the recommended sender under the contact name in unified
conversation views. The sender identity should not move with message scrolling.

## Manual Send Contract

Manual seller messages are operator-authored one-to-one sends. They include:

```json
{
  "source": "manual",
  "threadId": "string",
  "leadId": "string|null",
  "to": "string",
  "from": "string",
  "channel": "sms|email",
  "body": "string",
  "idempotencyKey": "string"
}
```

Manual sends:

- bypass the approval queue
- still enforce DNC, STOP, consent, and sender identity checks
- require a valid recipient
- require a valid PBK-owned sender
- write provider proof, failure, or reconcile state
- project into the unified seller timeline

## Approval-Gated Sends

Agent-generated campaigns, nurture sequences, contract sends, and risky provider
actions remain approval-gated. The manual bypass applies only when the operator
directly authors and sends the message.

## Troubleshooting

| Symptom                       | Check                              | Fix                                                                            |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| SMS returns 409               | Manual source and idempotency key. | Ensure one-to-one manual path bypasses approval queue but keeps safety checks. |
| Wrong sender                  | Sender recommendation response.    | Refresh identities and require explicit sender selection.                      |
| No timeline event             | Unified conversation projection.   | Record outbound message after provider proof or failure.                       |
| Mobile cannot create new lead | Quick-create control state.        | Open inline canonical lead form tied to the compose target.                    |

Related files:

- `src/app/utils/runtimeBridge.ts`
- `src/app/routes/Inbox.tsx`
- `scripts/openclaw-local-server.mjs`
- `docs/modern-shell-bridge-data-map.md`
