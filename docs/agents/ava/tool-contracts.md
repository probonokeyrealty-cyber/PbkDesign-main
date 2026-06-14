# Tool Contracts

The bridge is the source of truth. Ava may recommend tools, but the browser must
not execute provider writes directly.

## `analyzeDeal`

```json
{
  "propertyAddress": "string",
  "leadId": "string|null",
  "arv": "number|null",
  "repairs": "number|null",
  "maoPercent": "number",
  "assignmentFee": "number",
  "holdingCosts": "number",
  "closingCosts": "number"
}
```

## `telnyx_call`

```json
{
  "leadId": "string",
  "to": "string",
  "fromNumber": "string|null",
  "callerId": "string|null",
  "reason": "string"
}
```

Requirements: DNC, consent, calling-window, caller-id, and approval checks must
pass before dialing.

## `sendDocuSign`

```json
{
  "leadId": "string",
  "contractTemplate": "cash|rbp|creative|subject_to|land",
  "offerAmount": "number",
  "path": "string",
  "approvalId": "string|null"
}
```

Requirements: offer policy, approval state, contact info, and provider proof.

## `selectContextAwareScript`

```json
{
  "leadId": "string",
  "pathKey": "cash|rbp|creative|subject_to|land",
  "sentiment": "number|null",
  "lastObjection": "string|null",
  "stage": "string|null"
}
```

## `humanHandoff`

```json
{
  "leadId": "string",
  "reason": "string",
  "risk": "low|medium|high",
  "summary": "string"
}
```

Use handoff when legal, tax, threat, complaint, angry escalation, title dispute,
or large offer exception appears.

## Manual seller message

Manual one-to-one SMS and email sends are operator-authored messages from the
Command Center. They bypass the approval queue, but they do not bypass safety,
DNC, STOP, consent, sender identity, provider proof, idempotency, or timeline
projection.

```json
{
  "source": "manual",
  "threadId": "string",
  "leadId": "string|null",
  "channel": "sms|email",
  "to": "string",
  "from": "string",
  "body": "string",
  "idempotencyKey": "string"
}
```

Requirements:

- `from` must be a PBK-owned Telnyx number or configured sender email.
- `to` must match the selected seller/contact identity.
- DNC, STOP, consent, and quiet-hour rules still apply.
- The bridge must return provider proof, failure, or reconcile state.
- The result must project into the unified seller timeline.

See `docs/operations/communication-identities.md`.
