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

## Microsoft Graph OAuth Setup

The approved alternative is a dedicated single-tenant Microsoft application using delegated `Mail.Send`, `User.Read` (sender verification), and `offline_access`. No application-wide mailbox permissions, inbox-read permissions, or staff-login changes are needed. Keep the Neon webhook disabled during setup.

Use the existing bridge mail endpoint, branding, exact owner-recipient allowlist, and durable send ledger. Select this transport explicitly with `PBK_NEON_MAIL_PROVIDER=microsoft_graph`; never silently fall back to password SMTP after an OAuth failure.

Store `PBK_NEON_MS_CLIENT_ID`, `PBK_NEON_MS_TENANT_ID`, `PBK_NEON_MS_CLIENT_SECRET`, and a dedicated base64-encoded 32-byte `PBK_NEON_MS_CACHE_KEY` in Render secrets. Never put them in Git, chat, browser storage, activity logs, or screenshots. Client-secret creation and secure entry are completed by the owner. Preserve the encryption key during redeployments; rotating it requires reconnecting OAuth.

Register the Web redirect URI `https://pbk-openclaw-bridge.onrender.com/api/webhooks/neon-auth-mail/oauth/callback`. The callback accepts form-post authorization responses, validates a short-lived one-time state and PKCE verifier, and verifies the signed-in mailbox against `PBK_NEON_MAIL_FROM`. It does not grant a PBK staff session or send email. MSAL token cache and PKCE data are encrypted in backend-only Postgres tables; setup starts only through the protected admin endpoint using `{"action":"oauth_start"}`.

After owner sign-in and consent, require `{"action":"verify"}` to return `mailVerified: true` with provider `microsoft_graph`, then send the existing benign owner-only test using `{"action":"test"}`. Microsoft Graph acceptance is not inbox-delivery proof. Confirm owner receipt and sender branding before enabling Neon events, then verify a real signed owner-only event and the unchanged private staff routes.

## SMTP Activation Order

1. Deploy the handler, pinned Nodemailer runtime dependency, and Docker packaging. Keep Neon webhooks disabled.
2. With the existing bridge admin bearer key, `POST /api/admin/neon-auth-mail` with `{"action":"verify"}`. Require `smtpVerified: true`.
3. Call the same protected endpoint with `{"action":"test"}`. It can only send a benign verification email to the configured owner. `smtpAccepted` means Microsoft 365 accepted it, not that it reached the inbox. Confirm receipt and sender identity before continuing.
4. Preserve the prior Neon webhook configuration. Only then enable `send.otp` and `send.magic_link` for the Academy Test branch, with the exact public bridge HTTPS callback and a 10-second timeout.
5. Request recovery for the owner's already-existing Neon account. Never create a replacement identity, reset its password as an admin, or contact customers. Confirm a real signed event was accepted, its ledger status is `sent`, and the owner recognizes the branded message.
6. Verify anonymous staff Command Center routes still return 401. Record exact commit/deploy and test evidence; do not infer delivery from green unit tests.

## Signature and Delivery Safety

For a connection timeout, call the protected admin endpoint with `{"action":"diagnose"}`. It performs a credential-free SMTP/STARTTLS verification against the fixed Microsoft 365 host with a bounded 12-second connection window, without accessing the mail ledger or sending email. The result includes reachability, elapsed time, and allowlisted error/command labels only. `smtpReachable: true` is not authentication or inbox-delivery proof. Never enable the webhook on this signal alone.

With explicit owner authorization, `{"action":"diagnose","authenticate":true}` tests the saved SMTP login without sending mail. Its sanitized result includes an SMTP response code, never provider response text. A `535`/`EAUTH` result is an authentication rejection, not a network outage; verify the mailbox credential and its authorized SMTP AUTH policy with the mail administrator. Do not disable MFA or tenant security defaults. Live diagnosis found STARTTLS reachable in 202 ms and a 535 rejection after 7146 ms; the original 5-second socket deadline concealed that rejection as a timeout. The normal socket deadline is now 8 seconds. Leave Neon delivery unchanged until authenticated verification and owner inbox receipt both pass.

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
