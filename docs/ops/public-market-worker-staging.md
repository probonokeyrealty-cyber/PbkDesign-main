# Public market worker staging candidate

This code is default-off. Existing E2B inventory and QA sessions are unchanged. The worker formats public search evidence for Rex; it does not host Rex inference or perform underwriting.

## Operator flow

1. In Rex's existing Brain lane, enter `Rex prepare cloud market brief for Tampa, FL`.
2. Review and approve the sealed public-market task in the existing Settings approval queue. Preparation, opening pages, refreshing status and **Prepare another** perform no provider work.
3. The bridge claims the job permanently in Postgres, searches once, runs a fixed network-disabled E2B program and confirms termination. Review its summary, citations and limitations in Brain.
4. Failure or uncertainty never returns a successful brief. A new attempt requires a fresh approval. Starts are separated by a conservative five-minute lease, including after restart.

## Activation still requires founder approval

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
