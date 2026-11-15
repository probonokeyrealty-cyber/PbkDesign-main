# Neon Auth Mail

## Scope

The existing Render bridge hosts `/api/webhooks/neon-auth-mail`. Only signed email events from the existing Neon Academy Test Auth endpoint are accepted. PBK staff/investor sign-in remains on Supabase. No Command Center visibility or permission changes are required.

The initial rollout is deliberately owner-only. `PBK_NEON_MAIL_TEST_TO` is an exact recipient allowlist, not a default recipient: mail for every other account is refused, never redirected to the owner. Do not enable this override on a customer-facing branch until its rollout policy is explicitly reviewed.

## Microsoft 365 Configuration

Set these in Render's secret environment settings, never in Git or chat:

- `PBK_NEON_SMTP_USER`: the existing Microsoft 365 SMTP mailbox.
- `PBK_NEON_SMTP_PASSWORD`: its authorized SMTP credential.
- `PBK_NEON_MAIL_FROM`: exactly the same mailbox address.
- `PBK_NEON_MAIL_TEST_TO`: the explicitly authorized owner's test email.

The mailer uses `smtp.office365.com:587`, mandatory STARTTLS, TLS 1.2 or higher, and certificate verification. No SMTP protocol debug logs or tokens are emitted. The paid Render bridge can reach this SMTP port; hosted Supabase Edge Functions block it. Microsoft 365 must permit SMTP AUTH for this mailbox; do not weaken tenant security or authentication policies to make a test pass.

## Activation Order

1. Deploy the handler, pinned Nodemailer runtime dependency, and Docker packaging. Keep Neon webhooks disabled.
2. With the existing bridge admin bearer key, `POST /api/admin/neon-auth-mail` with `{"action":"verify"}`. Require `smtpVerified: true`.
3. Call the same protected endpoint with `{"action":"test"}`. It can only send a benign verification email to the configured owner. `smtpAccepted` means Microsoft 365 accepted it, not that it reached the inbox. Confirm receipt and sender identity before continuing.
4. Preserve the prior Neon webhook configuration. Only then enable `send.otp` and `send.magic_link` for the Academy Test branch, with the exact public bridge HTTPS callback and a 10-second timeout.
5. Request recovery for the owner's already-existing Neon account. Never create a replacement identity, reset its password as an admin, or contact customers. Confirm a real signed event was accepted, its ledger status is `sent`, and the owner recognizes the branded message.
6. Verify anonymous staff Command Center routes still return 401. Record exact commit/deploy and test evidence; do not infer delivery from green unit tests.

## Signature and Delivery Safety

The verifier preserves raw bytes and validates Neon's Ed25519 detached-JWS format, including its double-base64url signing payload. It pins the JWKS origin and Academy endpoint, checks timestamp freshness and signed/header event IDs, and limits JWKS refreshes. Recipients, email purpose, expiry, channel, and link origins are checked after signature verification. Auth codes and reset URLs never enter activity logs.

`pbk_neon_auth_mail_events` stores only event ID, payload hash, delivery status, and timestamps. A primary-key claim deduplicates concurrent deliveries durably across bridge replicas and restarts. An SMTP acceptance followed by a lost acknowledgement or DB error is ambiguous: the event becomes `unknown` (or remains `sending` after a crash) and must not be automatically resent. The owner may request a new code while the old event is reconciled. There is no exactly-once SMTP guarantee.

`GET /api/admin/neon-auth-mail` is admin-key protected and returns configuration presence plus aggregate event counts, never secrets or recipient lists. Unconfigured mail fails closed. No secrets means no activation.

## Rollback

Restore the previously recorded Neon webhook configuration. If there was no earlier webhook, disable it with `enabled: false`; that restores Neon's built-in delivery. Do not disable staff SSO or replace Supabase Auth. Leave the audit ledger intact.

## Local Verification

```powershell
node --test scripts/neon-auth-mail.node-test.mjs
npm run test:bridge
npm run test:mcp
```

Local tests use generated signing keys, fake SMTP, and controlled HTTP servers. They are not proof of Microsoft 365 authentication, inbox receipt, SPF, DKIM, or DMARC.
