# PBK Authentication Email Recovery

## Active Sources

- Staff Property Log and the approved-investor portal use Supabase project `asumndiooctluuecydhj`, live function `pbk-investor-portal`.
- Staff entry: `https://pbkcenter.netlify.app/property-log`. Netlify team protection remains required on all deployments.
- Neon PBK CC does not have Auth enabled on its default branch. Do not provision it as a second login system.
- Neon Academy Test has Auth enabled on branch `br-purple-recipe-b4mgs6in`; its email application name is `PBK Academy | Probono Key Realty`. It retains Neon's shared mail provider.

## Password Recovery

1. Enter the approved account email in its correct staff or investor entry and choose **Forgot password?**.
2. Keep that PBK tab open. Type the code from the newest PBK email into **Password recovery code**.
3. Choose **Continue to set password**. The account owner chooses, confirms, and saves their password themselves.

Recovery email contains `{{ .Token }}` and no recovery URL. A mail scanner cannot consume it by opening a link. Codes are still single-use, expire under Supabase settings, and are replaced by a new recovery request. Do not claim a code never expires or bypass provider rate limits.

`verifyRecovery` posts the email and code to Supabase `/auth/v1/verify` with `type: recovery`. Only the verified identity passes through the existing approval, role, origin, and session-registration checks. `setPassword` uses that user's bearer token, never an admin password-reset credential. Secrets remain in tab memory and are never written to local storage or logs.

Unknown and unapproved addresses receive the same generic send response. A successful send request is not proof of inbox delivery. Do not infer delivery from `recovery_sent_at` alone. Never print raw auth logs containing verification URLs.

## Branding

`scripts/auth-email-templates.mjs` contains reviewed copy and responsive HTML for all 13 Supabase authentication and security-notification templates. Recovery and reauthentication are code-only. Other action emails retain Supabase's `{{ .ConfirmationURL }}` placeholder. Security notices have no action links. Existing notification enablement and SMTP credentials are unchanged.

When editing the hosted source editor, explicitly select all and replace its full content. Verify the preview shows exactly one heading and no leftover default template. A successful Save alone does not detect appended content.

Hosted settings are separate from the code deploy: publish templates in the Supabase dashboard. Changing local HTML alone does not update hosted Auth.

Neon's shared email service supports application-name branding. Fully custom HTML requires a signed email-delivery webhook and a verified, configured sending provider. Do not enable the delivery override before successful send testing: it suppresses Neon's default delivery.

## Verification

```powershell
npm run test:investor-portal
node --test scripts/auth-email-templates.node-test.mjs
npm run build
node scripts/staff-property-log-browser-smoke.mjs
```

Browser tests use isolated fixtures and stop before any real password is entered. A positive personal-account verification requires the owner to complete the live code/password flow; it cannot be claimed from fixtures or negative endpoint tests.
