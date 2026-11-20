# Public market worker — verified staging pilot

The founder approved the separate credentials, isolated staging Postgres at $6.30/month before tax, and one Tampa public-market brief. The pilot completed. Production was not promoted.

## Operator flow

1. Rex's existing command `Rex prepare cloud market brief for Tampa, FL` prepares a sealed request only. It performs no search or sandbox work.
2. A protected administrator approves the exact pending task through the existing approval seam. Ordinary team sessions cannot perform protected admin writes. Never put the bridge master key in client code or relax this boundary.
3. One pinned public Composio search supplies bounded evidence to one fixed, network-disabled E2B worker. The worker prepares evidence for Rex; it does not host Rex inference, browse autonomously or perform underwriting.
4. On staging, open **Settings → Admin approvals → View public market brief** to read the saved result, five source links and limitations. The receipt binds to its approval task ID. Opening, expanding, refreshing or reloading it only reads saved state.
5. A further run requires a fresh request and approval. Permanent one-use Postgres claims and a five-minute safety interval prevent replay and overlapping starts. Worker code remains default-off unless explicitly configured.

## Live acceptance

- Service: `srv-dbvk7tv40ujc73e0d8gg`, [staging Settings](https://pbk-composio-staging.onrender.com/settings). Branch `codex/e2b-research-worker`, auto-deploy off.
- Deployed implementation: `e3e6c21d8d3254efc8853417ee7f4465a8ba7f7b`, deployment `dep-dc0190rrjlhs7381g83g`, live `2026-11-20T09:38:12.96139Z`. Later commits updating this runbook do not require a product redeploy.
- Exactly one approved market job: `market-b2a303ad-75a2-4240-8f19-ab0bf6fec800`, completed `2026-11-20T09:25:41.515Z`. One public search and one bounded sandbox; no automatic retry. The initial team-session approval was denied before any execution; the authorized protected staging administrator then approved that same pending request.
- Result: complete, five citations, consumed approval, cleanup confirmed. Subsequent independent Ava/Rex inventory reads each returned zero active sandboxes.
- The saved result and consumed marker survived both the receipt deployment and an explicit staging restart. An eight-collection canonical hash comparison across the explicit restart passed. During the approved job, all eight business collections were unchanged. Raw JSON hashes are unsuitable across JSONB reloads because object-key order can change; the acceptance checker uses field-order-independent hashes for restart proof.
- Actual hosted Settings checks passed desktop Chromium, iPhone WebKit and 320px WebKit: exact citation destinations, both limitations, correct approval binding, reload retention, no overflow, no passive provider calls and no business mutations. Signed-in BrowserOS inspection also confirmed the saved receipt.
- Focused worker/controller/claim/search/bridge suite:24/24. Existing Composio suite:41/41. App/MCP typechecks, lint, build, Docker closure and existing bridge gates passed during qualification. Receipt delta had a fresh independent review with no critical or important findings.

## Storage

Dedicated database **pbk-composio-staging-db**, ID `dpg-dc010uei0phs73bd3ohg-a`, Ohio, PostgreSQL18, compute `0.1c-256mb`, fixed1GB, autoscaling/HA off. Database `pbk_composio_staging`, dedicated user `pbk_composio_staging_user`. Dashboard-confirmed recurring cost: **$6.30/month before tax** ($6 compute + $0.30 storage), prorated by the second.

External IP allowlist is empty, blocking public connections. Only the internal URL was installed, solely in staging's protected `PBK_DATABASE_URL`; pool max3, min0. No production/customer rows were copied and the production database, credentials, network rules and plans were unchanged. No Neon resource was created or modified. Future storage/compute increases require separate approval.

## Credentials and session scope

- Separate **PBK Render public market worker** E2B key, stored only as staging secret `PBK_E2B_MARKET_WORKER_API_KEY`. The existing Composio E2B provider key was not extracted or reused. Backend credentials never enter the sandbox.
- Separate **PBK public market search runtime** Composio key: Tools read, Session management read, Session tool execution write only, stored only as staging `PBK_COMPOSIO_MARKET_SEARCH_API_KEY`.
- One no-auth session: `trs_ZwQwm-ErumOd`, config1, user `pbk-public-market-research`, only toolkit `composio_search` and tool/preload `COMPOSIO_SEARCH_WEB`. Instant, connection management, workbench, proxy execution, search helper, multi-account and multi-execute are disabled. No connected account/auth-config pins. Independently inspected metadata and actual MCP listing before activation.
- Actual input-schema SHA256: `adcbb7d8695565f037b8aa16447b0ae074146d34c6d2788e7075cd8696e1388f`. Scope/schema mismatch fails closed. No native/private Brain/model search fallback exists in this lane.
- Temporary setup key had Session management write only. It created exactly one session, was revoked, disappeared from the Dashboard and returned HTTP401. Transient credentials were cleared. Secrets were not printed, committed, logged or stored in local files; no secret-bearing screenshots were saved or shared.
- The two new staging flags are enabled. No automatic schedules or provider writes were added. Existing QA-contact and E2B inventory scopes were preserved.

## Verification notes

`npm run test:public-market-worker`, `npm run test:public-market-browser`, `npm run test:composio`, `npm run test:bridge`, `npm run test:render-docker-imports`, app/MCP typechecks, lint, build and Settings browser smoke are the local qualification commands. Actual hosted proof is separate from fixtures.

Only isolated bridge test startup was extended from15 to45 seconds after Windows cold-start timeouts under build/typecheck load. Provider and job deadlines were unchanged; this can delay genuine test-bootstrap failure feedback by at most30 seconds. Additional fixture-only exact-link/limitation assertions were deferred as optional review polish; those exact values were asserted against the actual hosted result on all three viewports.

Rollback: disable the two new staging flags. Retain consumed claims and the saved result; do not reset approvals to retry. Database deletion, plan changes, production activation and further paid research jobs need their applicable approval. Full founder production qualification and production promotion are not claimed.
