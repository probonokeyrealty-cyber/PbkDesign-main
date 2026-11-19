# PBK bidirectional Composio implementation

Status: deployed to a separate free staging backend, default disabled. **Hosted Composio authorization and end-to-end connection are still pending.** Production and CRM records have not been changed.

## What is implemented

- Ava/Rex can request `Ava check the Composio QA contact` or `Rex check the Composio QA contact` through the existing `runAgentCommand` bridge lane. An explicit `composioOperation: "qa-contact"` is also accepted there. Unsupported agents, operations, nested routing overrides and approval overrides are denied. There is no new arbitrary tool execution endpoint.
- The outbound MCP client permits only `HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT` with the one server-configured QA contact ID. Before every call, authenticated metadata reads must grant access to the exact pinned account and session. It verifies account ID/user/auth-config ID, Active/non-disabled account and auth-config status, session ID/user/account/config version/URL and exact toolkit/tool/preload policy, then rechecks the advertised schema fingerprint. Returned contact ID, sandbox location, DND and `pbk-qa-no-outreach` must match before selected boolean evidence leaves the adapter. Project-key provenance and resource-to-project mapping must be independently verified during provisioning; runtime resource access does not return or prove a literal project ID.
- `/mcp/pbk-readonly` is a separate authenticated, stateless JSON Streamable HTTP endpoint. It lists only `pbk_health`, `pbk_agent_registry` and `pbk_connection_readiness`. It never exposes the bridge's master key, arbitrary `/invoke`, approval decisions, CRM writes, communications or full state. Shared factory also supports the existing stdio wrapper's `PBK_MCP_PROFILE=readonly` profile; normal stdio behavior is preserved.
- Existing Settings tooling cards and legacy runtime summary show the directions independently, with safe status and last-read evidence. Configuration alone does not mark a connection ready. Readiness expires after two minutes without new successful evidence.
- Credential collisions are rejected after whitespace normalization. Origins/hosts, strict tool inputs, request/response size and time bounds are enforced. Writes and generic proxy/router/code-execution tools are unavailable.
- Policy events contain only direction, fixed safe tool name, decision, timestamp and generated correlation ID. Each adapter retains a bounded 100-event buffer; the bridge sends sanitized events to its existing runtime logging surface. Arguments, credentials, contact details and session URLs are not logged.

## Hosted prerequisites verified

Initial read-only inspection of the founder-confirmed Render workspace **PBK** found only production services. The founder subsequently approved a new free staging service and non-production branch. `pbk-composio-staging` was created at [the isolated staging host](https://pbk-composio-staging.onrender.com), with auto-deploy off, fresh distinct staging credentials and file-backed state. No production database, provider credentials or environment group was copied. Initial authenticated hosted checks verified health, 11-agent registry, team-auth configuration and disabled Composio directions.

The Composio developer project `probonokeyrealty_workspace_first_project` has Active connections for other toolkits but **no Active HighLevel connection**. The existing `pbk-sandbox-no-outreach` HighLevel connection belongs to the separate consumer CLI context. It was not copied, reauthorized or silently treated as a developer-project credential.

Therefore hosted proof and Custom MCP registration remain pending. Local fixtures do not prove live account authorization. The earlier HighLevel custom-field schema support issue remains separate and unresolved by this work.

The approved resource settings are recorded in `ops/composio-staging-service-proposal.json`. The source branch is `codex/composio-readonly-staging`. The first deployment ran the backend successfully. A subsequent staging-only build refinement compiles the existing Command Center assets for the native Node service; it does not introduce a second frontend. The CLI reported success without persisting its nested build change, so the dashboard was used and the saved build command was independently confirmed through the service API. No paid upgrade is allowed.

The existing developer-project sandbox auth configuration is for `highlevel_location`. The builder selected its equivalent native read tool `HIGHLEVEL_LOCATION_CONTACTS_GET_CONTACT`, inspected schema version `20261101_00` and fixed its input to `contact_id`. This reuses the existing restricted auth configuration instead of creating a new permission grant. It still needs an Active developer-project sandbox account; the consumer connection is not reused silently.

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

Credential correction: a key with the prepared staging name was observed created with Full access. Read-only permission probes confirmed access beyond the four approved areas. It was never installed on Render. With explicit founder approval it was revoked through the official revocation endpoint (HTTP 200), and its previously successful tool-definition read then returned HTTP 401. No credential values are retained in this document. A correctly scoped replacement remains required.

## Activation acceptance still required

The isolated staging deployment `dep-dbvke5cipgvc73dg0lr0` is live on commit `599e740ef828eba5dcb962545198e48bcb7adba4`. Authenticated checks at 19:03 UTC verified health, file state, 11 agents, configured team auth and both integration directions disabled. The limited endpoint returns 404 while disabled. Runtime service plan is free and auto-deploy remains off.

Hosted UI checks at 19:05 UTC passed sign-in, session reload, Settings refresh and separate disabled connection cards on desktop Chromium, iPhone WebKit and 320px WebKit. Settings scroll/client widths matched (1199/1199, 381/381 and 311/311). The test allowed only staging reads, team authentication/verification, read-stream session setup and font assets; it observed no business mutations or unexpected external requests. Screenshots and sanitized reports are retained in the private local audit directory. The initial reload probe incorrectly blocked the authentication verifier's POST; correcting that test allowlist resolved the probe without a product change.

A developer-project connection for user `pbk-composio-staging` was initiated through the existing restricted auth configuration. It is not Active yet. A project-scoped Composio API key must be supplied through protected staging environment settings; no CLI credential cache was read or copied.

An actual Composio staging read in each direction, sandbox scope/DND/QA verification and denied write probes remain pending those credentials and pinned session setup. Until then the feature must stay disabled and be described as not connected. No production release is included in this approval.

Reference API shapes were checked against Composio's published client 2.1.36 and [session configuration documentation](https://docs.composio.dev/docs/configuring-sessions). Remote transport and registration follow [sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp) and [Custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp).
