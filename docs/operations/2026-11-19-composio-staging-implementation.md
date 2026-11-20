# PBK bidirectional Composio implementation

Status: **both read-only directions are connected and hosted-verified on isolated staging.** Ava/Rex can read the pinned HighLevel sandbox QA contact through Composio, and Composio can read only PBK health, agent-registry metadata and connection readiness. Production and CRM records remain untouched.

## Final acceptance — November 19, 2026 Pacific

The evidence timestamps below are UTC on November 20 (November 19 Pacific). The deployed service remains free, auto-deploy off, with isolated file-backed state and no production environment/database inheritance.

- Render deployment `dep-dbvuchl9fdbs73c2iuqg` went live at `2026-11-20T06:20:57Z` on commit `04ce33b5e548afe8997bdf8bf8bda55ff4c76b06`. Both read-only integration flags are enabled only on `pbk-composio-staging`.
- Real hosted Ava/Rex bridge commands passed at `06:43:37Z`: existing sandbox QA identity, DND on and QA exclusion verified. No contact or property was created or updated. The existing outbound account/session and scoped runtime key remain unchanged.
- Private toolkit `CUSTOM_BK4BZ` (catalog `custom_bk4bz`) is limited to user `pbk-composio-staging`, absent from another user's catalog, and connected through Active account `ca_X2gFI0n6KGUf` / auth config `ac_jDp21kGlty-i`. Sync version `20261120_01` contains exactly three metadata tools. Final duplicate inspection at `06:49:11Z` found exactly one matching private account and no additional page.
- Restricted return session `trs_8VqAK02WUHHK`, configuration 1, pins that one account/toolkit and only `CUSTOM_BK4BZ_PBK_AGENT_REGISTRY`, `CUSTOM_BK4BZ_PBK_CONNECTION_READINESS` and `CUSTOM_BK4BZ_PBK_HEALTH`. Search, connection management, workbench, proxy, multi-account and multi-execute are disabled. Real Composio reads passed all three. Registry metadata lists 11 agents and explicitly sets `executionVerified: false`; this does not claim integration execution by all 11 agents.
- Extra arguments, unknown write tools and an existing HighLevel tool outside the private toolkit were denied. Before/after leads, tasks, admin tasks, approvals, calls, messages and contracts were identical. CRM writes, outreach and task creation: zero.
- Hosted signed-in Settings checks at `06:44:39Z` passed desktop Chromium, iPhone WebKit and 320px WebKit, refresh and session reload. Both directions displayed **Read verified**; surface scroll/client widths matched 1199/1199, 381/381 and 311/311, with no unexpected external requests or business mutations. Readiness correctly expires after two minutes without a successful read; there is no recurring scheduler.
- The Pro plan was confirmed after founder completion; no duplicate purchase was submitted. Composio's private-registration route rejected the approved scoped setup key with 403/error 812 because no scoped-key permission covers that route. The founder separately approved a temporary full-project bootstrap key solely for the private staging registration/account/session setup. It was never used for tool execution or installed on Render.
- All temporary session/private-setup/bootstrap project keys were revoked, each verified by successful revocation and subsequent authentication 401. Transient values were cleared. The independently verified four-scope runtime v2 key remains unchanged; the dedicated inbound token stays in protected provider settings only.

### Strict-input correction and provider presentation limit

The MCP SDK's normalization of a defaulted strict empty object did not advertise `additionalProperties: false`. The shared HTTP/stdio factory now advertises one fixed three-tool inventory with explicit strict schemas while preserving omitted-argument compatibility and server validation. Regression reproduced the defect before correction; 32/32 focused tests and the MCP build passed. A fresh narrow reviewer found no important issues. The actual hosted endpoint advertises strict schemas and rejects extra arguments.

Composio's tools catalog preserves the strict schema; its session MCP discovery omits that one display flag. Actual execution still rejects extra arguments. No runtime policy was weakened to accommodate that presentation difference. This work does not repair the separate HighLevel opportunity custom-field connector defect or activate the address/APN write guard.

Sanitized private evidence is retained under `.pbk-local/composio-command-center-audit/2026-11-19/`: `bidirectional-hosted-report.json`, `hosted-ui-bidirectional-report.json` and `private-duplicate-report.json`. No credentials or raw CRM records are in this runbook or those reports.

## Historical activation checkpoints

The following checkpoints preserve the sequence of deployment and approval evidence. Their pending/disabled statements describe earlier states and are superseded by final acceptance above.

- Founder-approved integration `PBK Composio QA Read - NO OUTREACH` was created in sandbox `OXa5iejsMPm7I7JsrEge` with exactly `contacts.readonly` and `locations.readonly`. The existing Property Guard integration was preserved.
- New connected account `ca_0sb6c-6lP1UF` is Active under the intended developer project, user `pbk-composio-staging`, auth config `ac_FQxH8GPSX4DK` and `highlevel_location` toolkit. Authenticated account metadata independently returned200 and matched every policy pin.
- At23:14UTC, an explicitly account/project/user-bound `composio dev playground-execute HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT` read succeeded. Its selected evidence confirmed the existing QA contact and sandbox location, DNDtrue and `pbk-qa-no-outreach`. Output was sanitized before display; no CRM record values, credential values or provider payloads were saved. No CRM write, outreach or task operation was called.
- The newly approved HighLevel token was supplied only to that Composio connection, then cleared from transient orchestration memory after authorization became Active. The existing scoped runtime project key remains installed only on the isolated staging service.
- With explicit founder approval, the separate setup-only key was created with exactly Session management write, independently verified in its saved tooltip. It created the single-tool session and was then revoked: revocation200/receivedtrue and post-revocation authentication401. It was never installed on Render or used for tool execution; its transient value was cleared. The existing runtime key remains unchanged.
- The authenticated billing page showed Hobby; the founder requested preparation of Pro for review. Stripe checkout is prepared at **US$29/month**, with **US$29 due today**, and remains unsubmitted. See `ops/composio-pro-upgrade-review.md`. [Composio's private Custom MCP documentation](https://docs.composio.dev/docs/extending-sessions/custom-mcp) requires Pro for a toolkit private to one user. No upgrade or shared-for-all fallback was performed.
- Session `trs_QDYbCcd_gMjx`, configuration1, pins the intended user, auth config, account, single toolkit and single contact-read tool. Search, connection management, workbench, proxy execution, multi-account and multi-execute are disabled. Actual MCP discovery advertised only that tool; the reviewed input-schema fingerprint is recorded in the session proposal. Backend validation rejected the inapplicable explicit-selection flag while multi-account was disabled; omitting that flag preserved the exact account pin. The rejected400 requests created no sessions; one creation succeeded201.
- The live provider returned the MCP path `/tool_router/trs_<id>/mcp`. The adapter now accepts that exact additional shape while retaining HTTPS/exact host/no credentials or query/fragment and authoritative session URL matching. The new regression failed before the correction; all32 focused tests passed afterward. A fresh reviewer found no important issues and independently passed17 connection tests. Existing bridge9-isolation-test/offline smoke passed.
- Deployment `dep-dbvpvqijnfac7382b6rg` went live at01:20:43UTC November20 on commit `881fd5a9b6fe7ce590aff60dfced56142eec099d`, still free and auto-deploy off. Hosted Ava/Rex commands at01:21UTC used the existing bridge and real MCP tool; both verified the existing QA contact, sandbox, DNDtrue and QA exclusion. Write/override requests were denied. Leads, tasks, admin tasks, approvals, calls, messages and contracts were identical before and after.
- Hosted signed-in Settings checks passed on desktop Chromium, iPhone WebKit and320px WebKit, including refresh/session reload, separate outbound Read verified/inbound Disabled cards, zero unexpected external requests and zero business mutations. Surface scroll/client widths matched1199/1199,381/381 and311/311. Readiness expires after two minutes without a new verified read; configuration alone never claims a live connection.
- The prior23:15UTC checkpoint verified healthy hosting with both flags disabled. It is superseded by the outbound-only activation above. The sandbox integration list independently showed both original Property Guard and new QA Read integrations; no token was displayed.
- Fresh hosted acceptance at01:35UTC November20 repeated Ava/Rex reads and safe denial probes successfully, with all seven business collections unchanged. An independent authenticated billing recheck still showed Hobby and the prepared Stripe checkout remained unsubmitted atUS$29/month/US$29 due. `ops/composio-private-return-proposal.json` now contains the exact private-user/API-key registration and three permitted metadata tools; its create body validates against Composio's current official OpenAPI schema. No toolkit, account, credential, purchase or inbound activation was created by that preparation. Explicit purchase approval is pending.

## What is implemented

- Ava/Rex can request `Ava check the Composio QA contact` or `Rex check the Composio QA contact` through the existing `runAgentCommand` bridge lane. An explicit `composioOperation: "qa-contact"` is also accepted there. Unsupported agents, operations, nested routing overrides and approval overrides are denied. There is no new arbitrary tool execution endpoint.
- The outbound MCP client permits only `HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT` with the one server-configured QA contact ID. Before every call, authenticated metadata reads must grant access to the exact pinned account and session. It verifies account ID/user/auth-config ID, Active/non-disabled account and auth-config status, session ID/user/account/config version/URL and exact toolkit/tool/preload policy, then rechecks the advertised schema fingerprint. Returned contact ID, sandbox location, DND and `pbk-qa-no-outreach` must match before selected boolean evidence leaves the adapter. Project-key provenance and resource-to-project mapping must be independently verified during provisioning; runtime resource access does not return or prove a literal project ID.
- `/mcp/pbk-readonly` is a separate authenticated, stateless JSON Streamable HTTP endpoint. It lists only `pbk_health`, `pbk_agent_registry` and `pbk_connection_readiness`. It never exposes the bridge's master key, arbitrary `/invoke`, approval decisions, CRM writes, communications or full state. Shared factory also supports the existing stdio wrapper's `PBK_MCP_PROFILE=readonly` profile; normal stdio behavior is preserved.
- Existing Settings tooling cards and legacy runtime summary show the directions independently, with safe status and last-read evidence. Configuration alone does not mark a connection ready. Readiness expires after two minutes without new successful evidence.
- Credential collisions are rejected after whitespace normalization. Origins/hosts, strict tool inputs, request/response size and time bounds are enforced. Writes and generic proxy/router/code-execution tools are unavailable.
- Policy events contain only direction, fixed safe tool name, decision, timestamp and generated correlation ID. Each adapter retains a bounded 100-event buffer; the bridge sends sanitized events to its existing runtime logging surface. Arguments, credentials, contact details and session URLs are not logged.

## Hosted prerequisites verified

Initial read-only inspection of the founder-confirmed Render workspace **PBK** found only production services. The founder subsequently approved a new free staging service and non-production branch. `pbk-composio-staging` was created at [the isolated staging host](https://pbk-composio-staging.onrender.com), with auto-deploy off, fresh distinct staging credentials and file-backed state. No production database, provider credentials or environment group was copied. Initial authenticated hosted checks verified health, 11-agent registry, team-auth configuration and disabled Composio directions.

The Composio developer project `probonokeyrealty_workspace_first_project` now has the independently verified Active HighLevel connection `ca_0sb6c-6lP1UF`, for user `pbk-composio-staging` and auth configuration `ac_FQxH8GPSX4DK`. This uses the newly approved sandbox token with only `contacts.readonly` and `locations.readonly`. The existing consumer CLI connection was not copied or silently reused.

Hosted outbound execution and the private return metadata session are now verified. Direct provider reads, authoritative Composio metadata, actual MCP discovery and hosted adapter execution all confirmed the intended sandbox QA scope. The earlier HighLevel custom-field schema support issue remains separate and unresolved by this work.

The approved resource settings are recorded in `ops/composio-staging-service-proposal.json`. The source branch is `codex/composio-readonly-staging`. The first deployment ran the backend successfully. A subsequent staging-only build refinement compiles the existing Command Center assets for the native Node service; it does not introduce a second frontend. The CLI reported success without persisting its nested build change, so the dashboard was used and the saved build command was independently confirmed through the service API. No paid upgrade is allowed.

The existing developer-project sandbox auth configuration is for `highlevel_location`. The builder selected its equivalent native read tool `HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT`, inspected schema version `20261101_00` and fixed its input to `contact_id`. This reuses the existing restricted auth configuration. The founder subsequently approved a separate two-scope sandbox token; its developer-project account is now Active, and the consumer connection was not reused.

## Server-only staging configuration

Set these only on a separately isolated staging backend. Never set them on the current production bridge to work around the missing staging resource. Do not copy production database/provider environment groups into staging.

| Variable | Purpose |
| --- | --- |
| `PBK_COMPOSIO_STAGING_ENABLED` | Explicit `true` to enable the feature; otherwise disabled |
| `PBK_COMPOSIO_MCP_URL` | Final, authenticated Composio session MCP URL on `backend.composio.dev`; must match authoritative session metadata exactly |
| `PBK_COMPOSIO_API_KEY` | Dedicated scoped project secret, distinct from PBK master and inbound keys; verify its credential class and exact permissions before installation |
| `PBK_COMPOSIO_AUTH_CONFIG_ID` | Exact restricted sandbox auth configuration, independently verified in the intended project before pinning |
| `PBK_COMPOSIO_USER_ID` | Intended PBK session user |
| `PBK_COMPOSIO_ACCOUNT_ID` | Existing restricted sandbox HighLevel account in that developer project |
| `PBK_COMPOSIO_SESSION_ID` | Existing pinned session ID |
| `PBK_COMPOSIO_SESSION_CONFIG_VERSION` | Pinned integer configuration version; drift fails closed |
| `PBK_COMPOSIO_SANDBOX_LOCATION_ID` | Sandbox location; no production fallback |
| `PBK_COMPOSIO_QA_CONTACT_ID` | Existing QA contact; no creation or upsert |
| `PBK_COMPOSIO_CONTACT_SCHEMA_SHA256` | Canonical schema fingerprint from reviewed MCP discovery |
| `PBK_COMPOSIO_INBOUND_ENABLED` | Explicit `true` for the limited PBK endpoint |
| `PBK_COMPOSIO_INBOUND_URL` | Final staging URL ending in `/mcp/pbk-readonly`; no redirect |
| `PBK_COMPOSIO_INBOUND_TOKEN` | Dedicated revocable secret of at least 24 characters, distinct from outbound/master keys |

The Composio session must explicitly pin exactly one `highlevel_location` connected account, enable only that toolkit and contact-read tool, and preload only that tool. Do not grant arbitrary execution, proxy, connection management or workbench capabilities. Use deny when approval elicitation is unsupported. The adapter performs metadata-only GET requests to `/api/v3.1/connected_accounts/{id}` and `/api/v3.1/tool_router/session/{id}`; unavailable or unexpected metadata blocks execution, including 401/403/404 from a different-project key. Before installing IDs, verify the intended developer project, dedicated project-key provenance and exact account/user/auth-config/session relationship through the authenticated project dashboard/CLI. Runtime access to globally unique pinned resources is the tenant boundary; a configured project name/ID alone is not runtime proof. The runtime cannot distinguish a mistakenly installed user/org key, so do not provision one.

Runtime key permissions are Tools read, Session management read, Connected accounts read and Session tool execution write. Session creation and PBK Custom MCP registration use separate approved provisioning operations; the runtime key does not need session-management write or raw proxy access. The former `/auth/session/info` check was incorrect: that route requires a user API key and rejects project API keys with error 908. Do not solve that rejection by installing a broader credential.

After a staging host and protected secrets are available, register the limited PBK endpoint as a private PBK Custom MCP toolkit in the intended developer project/session. Do not use the broad PBK master credential or a shared-for-all-users registration. Credentials must be provisioned in protected provider settings, not chat, source, browser local storage or CLI-cache extraction.

## Verification

- `npm run test:composio`: adapter policy, schema drift, identity/version/account drift, normalized secret collision, no overrides, stale response ownership, reconnect/timeout, audit redaction, real SDK JSON/SSE protocol, authenticated limited PBK HTTP and isolated agent bridge flow.
- `npm run test:mcp` and `npm --prefix mcp-server run build`: wrapper type/build checks.
- `npm run test:bridge`: existing isolated regression suite; provider delivery explicitly unverified.
- `npm run test:render-docker-imports`: image includes both adapter and shared limited MCP runtime; no Docker image was deployed.
- Package dry run confirms the stdio package includes its shared runtime and compiled factory.
- `npm run test:settings-design-browser`: builds current source first, then signed-in fixture checks on desktop Chromium, iPhone WebKit and 320px WebKit. No live provider or production UI is touched.

The local end-to-end fixture proves both Ava and Rex receive selected QA/DND evidence through the real bridge and MCP SDK while all fixture lead/task/admin/approval/call/message/contract collections remain unchanged. A separate real HTTP client exercises the restricted inbound tool surface. These are isolated fixtures, not hosted Composio execution.

Credential correction: a key with the prepared staging name was observed created with Full access. Read-only permission probes confirmed access beyond the four approved areas. It was never installed on Render. With explicit founder approval it was revoked through the official revocation endpoint (HTTP 200), and its previously successful tool-definition read then returned HTTP 401. No credential values are retained in this document. A correctly scoped replacement was required at that checkpoint.

Scoped replacement is now installed: the founder approved `PBK Composio Staging QA Read v2`. Before submission the form was checked for exactly Tools read, Session management read, Connected accounts read and Session tool execution write. An independent dashboard load confirmed 4 Scopes with exactly those resource/access pairs. Actual permitted reads returned200; excluded Toolkits and Auth Configs reads returned403/error812. The key was stored only as the isolated Render service's `PBK_COMPOSIO_API_KEY`, together with the reviewed sandbox policy pins. Both feature flags stayed false. The environment update deployed commit `c4207b21d86b9e2487ecd0463a975ebee26e0162` as `dep-dbvmrpe0tbcc7390d90g`, live21:47UTC. Authenticated hosted checks at21:48UTC passed health, file state,11agents and disabled directions.

An apparent stuck creation dialog was a stale BrowserOS automation feed, not a confirmed Composio failure. Native desktop inspection showed the completed 4-scope dialog and allowed secure retrieval of the newly approved one-time key. The draft support report was withdrawn; no ticket was submitted. HighLevel sandbox authorization and pinned session/Custom MCP setup remain pending. A new sandbox-only contact-read integration draft is prepared but not created; its scope selector was last observed loading. The browser then switched externally to unrelated E2B setup; no controls on that page were changed.

Project-key compatibility correction is deployed only on isolated staging: commit `7f38a14599e2b34598f9131f7cca1b1a6bdbdb68`, deployment `dep-dbvmjp3l550s738apd60` live at 21:30 UTC. All 31 focused tests and the existing bridge isolation/offline smoke passed; provider delivery remains unverified. Fresh authenticated hosted checks at 21:30 UTC returned healthy HTTP 200, file-backed state, 11 registered agents, configured team auth and both integration directions disabled. The limited endpoint remains 404 while disabled. No production deployment or CRM/business write occurred.

## Historical pre-authorization checkpoints

Earlier staging deployment `dep-dbvke5cipgvc73dg0lr0` ran commit `599e740ef828eba5dcb962545198e48bcb7adba4`. Authenticated checks at19:03UTC verified health, file state,11agents, configured team auth and both integration directions disabled. These earlier observations are retained as history, not the current outbound status.

Hosted UI checks at 19:05 UTC passed sign-in, session reload, Settings refresh and separate disabled connection cards on desktop Chromium, iPhone WebKit and 320px WebKit. Settings scroll/client widths matched (1199/1199, 381/381 and 311/311). The test allowed only staging reads, team authentication/verification, read-stream session setup and font assets; it observed no business mutations or unexpected external requests. Screenshots and sanitized reports are retained in the private local audit directory. The initial reload probe incorrectly blocked the authentication verifier's POST; correcting that test allowlist resolved the probe without a product change.

At that earlier checkpoint, the developer-project connection was initiated but not Active, and the runtime key was not provisioned. Both prerequisites have since been satisfied as described above; no CLI credential cache was read or copied.

Final acceptance: both read-only directions passed actual hosted reads and denial probes, with all business collections unchanged. The private return session is active and verified. No production release is included in this approval.

Reference API shapes were checked against Composio's published client 2.1.36 and [session configuration documentation](https://docs.composio.dev/docs/configuring-sessions). Remote transport and registration follow [sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp) and [Custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp).
