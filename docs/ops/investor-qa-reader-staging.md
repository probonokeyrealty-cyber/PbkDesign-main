# Investor QA reader on Render staging

This source belongs to `pbk-composio-staging` only. It uses the existing
internal staging Postgres connection. It must not use production storage,
change the network allowlist, seed a lead, or create/release a packet.

- `POST /api/staging/investor/qa-lead` is off unless a dedicated bearer
  and an unexpired server-side grant pin `staffUid`, `accountId`,
  `leadId`, and `revision`. The source owner must verify that identity
  mapping independently before provisioning the grant. Reject browser
  origins; never substitute a team passcode or the founder bridge key.
- The transaction is read-only and checks the database and role before
  looking up the exact record. A record must have a QA/sample/synthetic
  lead ID, an explicit JSON Boolean fictional marker, and no saved phone
  or email. Revision is the stored lead profile's UTC `updated_at` to
  microsecond precision. Only packet projection fields are returned.
- Temporary staging setting `PBK_INVESTOR_QA_DISCOVERY_UNTIL` enables a
  startup check for one existing eligible lead. The log emits only the
  tuple if a second exact read agrees, or a generic reason. No data is
  created. The setting stops having effect at expiry; it does not
  enable the HTTP route.
- Roll back by deploying the prior staging commit. The public investor
  portal, production, and draft-write configuration are out of scope.

Local verification: `node --test scripts/investor-qa-staging-source.node-test.mjs`.
The optional loopback Postgres test is explicitly for a disposable local
database, not any hosted service.
