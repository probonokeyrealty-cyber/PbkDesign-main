# Provider Live Proof Harness

The live proof harness verifies that provider proof runs are pointed at PBK-controlled proof destinations before any adapter can send to a real provider. Never use a seller, lead, buyer, customer, or counterparty recipient for proof runs.

## Required Environment

- SMS: `PBK_LIVE_PROOF_SMS_TO`, `PBK_TELNYX_FROM_NUMBER`
- Email: `PBK_LIVE_PROOF_EMAIL_TO`, `PBK_INSTANTLY_DEFAULT_FROM_EMAIL`
- DocuSign: `PBK_LIVE_PROOF_EMAIL_TO`, `PBK_DOCUSIGN_ACCOUNT_ID`
- Slack: `PBK_SLACK_APPROVAL_CHANNEL_ID`

## Required Provider Receipts

- SMS: capture the provider message id, delivery event type, delivery status, sent timestamp, and delivered or failed webhook receipt.
- Email: capture the provider message id, processed or delivered event, recipient proof mailbox, timestamp, and bounce or failure receipt when applicable.
- DocuSign: capture the envelope id, account id, recipient proof email, sent timestamp, and terminal envelope status receipt such as delivered, completed, declined, or voided.
- Slack: capture the channel id, posted message timestamp, API `ok` result, and any provider error response.

## Running The Harness

Run the smoke check:

```bash
npm run test:provider-live-proof-harness
```

`runProviderLiveProof({ provider, dryRun: true })` only reports readiness after the required proof-only environment values are present. Non-dry-run execution currently returns `not_implemented` until the live adapters and receipt collectors are selected.
