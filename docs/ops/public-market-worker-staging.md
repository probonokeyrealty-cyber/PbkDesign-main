# Public market worker staging candidate

This code is default-off. Existing E2B inventory and QA sessions are unchanged. The worker formats public search evidence for Rex; it does not host Rex inference or perform underwriting.

## Operator flow

1. In Rex's existing Brain lane, enter `Rex prepare cloud market brief for Tampa, FL`.
2. Review and approve the sealed public-market task in the existing Settings approval queue. Preparation, opening pages, refreshing status and **Prepare another** perform no provider work.
3. The bridge claims the job permanently in Postgres, searches once, runs a fixed network-disabled E2B program and confirms termination. Review its summary, citations and limitations in Brain.
4. Failure or uncertainty never returns a successful brief. A new attempt requires a fresh approval. Starts are separated by a conservative five-minute lease, including after restart.

## Credential activation approved; storage approval pending

The founder approved the separate staging credentials and one Tampa public-market brief. Revision `e3f547aa20a49bc5a8ea02d47ce768d97dbff63c` deployed live to the isolated service in deployment `dep-dc00pc6c6qcc73ar06j0` at `2026-11-20T09:04:50.69162Z`.

The new E2B worker and Composio runtime keys are stored only in staging's protected environment settings. One restricted public-search session `trs_ZwQwm-ErumOd`, config1, user `pbk-public-market-research`, was created and independently read back. MCP exposes exactly `COMPOSIO_SEARCH_WEB`; actual input-schema SHA256 is `adcbb7d8695565f037b8aa16447b0ae074146d34c6d2788e7075cd8696e1388f`. No search was executed during inspection. The temporary Session management write key was revoked; its row disappeared and authentication returned HTTP401. Transient credential references were cleared.

Both new execution flags remain **false**. Authenticated hosted status, unchanged business collections, existing Ava/Rex E2B inventory reads, signed-in BrowserOS Settings and hosted desktop/iPhone/320px browser checks passed. No market job, public search or sandbox was started. Production settings were not changed.

The missing dependency is isolated staging Postgres. Staging currently uses file-backed state. The worker intentionally refuses durable claims without Postgres; do not weaken that guard or point staging at production CRM data. The initial release plan assumed this dependency existed and that assumption was disproved during live preflight.

### Concrete storage proposal — not executed

Create **pbk-composio-staging-db** in the existing PBK Render workspace, Ohio, PostgreSQL18, compute `0.1c-256mb`, fixed1GB storage, autoscaling and HA off. Database `pbk_composio_staging`, dedicated user `pbk_composio_staging_user`. The prepared Dashboard form confirms **$6.30/month before tax** ($6 compute + $0.30 storage), prorated by the second. Do not submit until the founder approves this new recurring resource.

After that approval: configure the new database for private access, store its internal connection only in the existing staging service's `PBK_DATABASE_URL`, keep staging's small connection pool bounded, initialize staging-only schema, and verify persistence/restart safety. Preserve production's database, credentials, network restrictions and plans. Do not copy production/customer rows. Then enable the two already-approved worker/search flags, redeploy staging and perform the already-approved single Tampa job. Stop on provider failure instead of spending the approved job again. Further compute/storage increases require separate approval.

An existing Neon evaluation project was inspected read-only as an alternative; no Neon branch, role, compute or database was created or modified. Persistent isolated Render Postgres is proposed to retain staging records across restarts without a disposable database expiring beneath the service.

## Approved credential/job scope

Only the existing isolated staging service `pbk-composio-staging` is proposed. No production settings, plans, CRM records, signing, outreach or autonomous schedules are included.

- Create a separate E2B backend key named **PBK Render public market worker** in the existing PBK project. E2B has no per-key scopes. Store it only as staging secret `PBK_E2B_MARKET_WORKER_API_KEY`; never retrieve/copy the existing Composio E2B credential.
- Create **PBK public market search runtime** in the PBK Composio project: Tools read, Session management read and Session tool execution write only. Store only as staging `PBK_COMPOSIO_MARKET_SEARCH_API_KEY`.
- Create one temporary Session management write key, provision exactly one no-auth session for `pbk-public-market-research`, then revoke that setup key. Pin only toolkit `composio_search` and tool/preload `COMPOSIO_SEARCH_WEB`. Disable instant, connection management, workbench, proxy execution, search, multi-account and multi-execute. No connected accounts/auth configs. Inspect actual metadata/schema and record non-secret session ID, user, config version and SHA256 pins in staging env. Do not use CLI playground auto-sessions.
- Configure `PBK_COMPOSIO_MARKET_SEARCH_ENABLED=true` and `PBK_E2B_MARKET_WORKER_ENABLED=true` only after pins and secret placement are verified. Requires reachable staging Postgres, the exact SDK and supported Node22.19+.
- Deploy this reviewed revision only to staging. Run **one** explicitly approved Tampa, FL public-market job, at most one 60-second sandbox and one search, within existing provider billing limits. No upgrades/limit changes. Verify completion, cleanup, source binding, reload and unchanged business collections. Stop on failure; do not retry paid work automatically.
- Revoke the temporary setup key and clear transient secret references before reporting completion. Secrets must never appear in chat, git, logs, screenshots or sandbox environment.

## Release checks

`npm run test:public-market-worker`, `npm run test:public-market-browser`, `npm run test:composio`, `npm run test:bridge`, `npm run test:render-docker-imports`, app/MCP typechecks, lint, build, Settings desktop/iPhone/320px smoke. Local fixtures are not proof of a live provider job. Hosted proof remains pending activation.

Rollback: disable both new flags on staging. Keep consumed claims; never reset them to retry. Preserve existing inventory keys/session and production services.
