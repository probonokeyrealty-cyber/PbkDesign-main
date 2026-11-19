# PBK ↔ Composio connection design

Status: founder approved staging implementation on November 19, 2026; local implementation completed, hosted activation pending isolated staging resources and authorization. Not deployed.

## Intent and agreed scope

The founder selected **both directions**: PBK agents should use connected Composio tools, and Composio should be able to access PBK backend tools. The Command Center remains the operator surface. Ava supervises; Rex remains in Brain; Hermes remains advisory. Preserve existing Slack/Command Center approvals and the Electron wrapper.

This design proposes a first release that proves authenticated, read-only operation in both directions. Provider mutation, outreach, tasks and production deployment remain disabled. These are builder-proposed release limits, not an assertion that write-capable connections are already authorized or installed.

## Approaches

1. **Extend existing bridge and MCP wrapper (recommended).** Add remote MCP support and a limited remote PBK endpoint to the existing runtime. Reuse agent dispatch, auth, Settings status and approval controls. Requires two adapters and scope tests, but preserves one control system.
2. **Independent Composio orchestration service.** Would require duplicate routing, state and approval ownership. Rejected because the PBK operating guide requires extending the existing bridge and Command Center.
3. **CLI-only configuration.** Adequate for local operator access but does not establish the hosted backend connection or let remote Composio sessions reach the current stdio-only PBK MCP server. Rejected for the selected two-direction scope.

Both directions are founder-selected; approach 1 is the builder's recommendation based on the required architecture. There is no proposed alternative shell or second approval authority.

## Existing state

Authenticated hosted bridge metadata reads work. Its registry contains 11 agents; its MCP client inventory is empty. Local OpenClaw configuration includes PBK, but not Composio. Composio CLI human login works, which is separate from hosted project/session authorization. The current PBK MCP wrapper and bridge MCP client use stdio. No signed-in hosted Command Center end-to-end verification has been completed.

Source seams:

- `scripts/openclaw-local-server.mjs`: MCP client map, connect/list/call handlers, operating-mode guard and tooling status.
- `mcp-server/src/index.ts` and `mcp-server/src/client.ts`: existing PBK MCP wrapper and bridge client.
- `src/app/utils/runtimeBridge.ts`, Settings and legacy runtime summary: current Command Center connection/readiness path.
- Existing Slack/Command Center approval and admin queue: retain as sole write authority.

## A. PBK agents → Composio

Extend the existing backend MCP client seam with Streamable HTTP support, without removing stdio. Composio connection configuration is server-managed: stable logical connection name, exact permitted HTTPS origin/path, project/user/account binding, credential environment-variable reference, tool policy and enabled flag. Callers cannot submit arbitrary remote URLs, headers, commands, credential values or account overrides through a tool invocation.

Use a project-scoped Composio session/config for PBK. A local consumer CLI account is not silently migrated or treated as a developer-project connection. Credentials are supplied through the existing server secret mechanism, never extracted from CLI caches, copied into source, returned to a client or submitted in chat. Missing authorized project/session configuration produces a clear disconnected/blocked state.

Expose only explicitly configured tools. Discovery, tool execution and result handling are separate checks. Provider risk must come from PBK-maintained policy, not a provider's readOnly annotation or the agent's claim. Unknown tools and generic proxy/execute, account-linking, script-execution and session-management tools are denied by default. Do not give the agent a broad router that can discover and call unreviewed write tools indirectly.

First-release outbound verification is limited to explicitly allowlisted HighLevel read tools bound to the existing sandbox location and QA record IDs. Exact tool names and input schemas must be inspected before implementation; the builder may select equivalent read-only operations, not broaden scope. No record creation/update or HighLevel custom-field write is needed to prove the connection. DND, QA exclusion and all contact/property values remain unchanged.

Integrate discovery/execution into Ava/Rex's existing bridge-backed tool dispatch so a read result can be used by the agent and displayed in the existing Command Center. Do not stop at adding an unused connection helper. Reuse the current MCP call gate; never relax it globally. Where necessary, introduce an explicit policy-checked read path. Writes remain denied in this release even if an approval ID is supplied.

## B. Composio → PBK

Extend the existing MCP wrapper with a Streamable HTTP entry point hosted in a separate staging runtime profile of the existing backend/service. Do not expose the entire bridge `/invoke`, arbitrary paths or all existing MCP tools. Stdio continues to work.

Use a dedicated revocable inbound credential and exact allowed origin/host configuration. Do not give Composio the PBK bridge master credential. Server-side token verification, bounded request/body sizes, timeouts, rate limits and strict input validation apply before dispatch. Validate Host/Origin when present; reject redirects and unsupported HTTP methods. Standard authenticated non-browser MCP clients may omit Origin.

Initial inbound tools: sanitized backend health, agent registry summary and integration readiness. A read-only deal calculation may be added using explicit numeric inputs and the existing analyzer only if its existing handler is proven free of provider/business mutations; otherwise defer it. Health and readiness omit provider URLs, internal configuration, identifiers unrelated to scope, secrets, CRM records and raw runtime state.

Use a factory/registration filter on the existing wrapper rather than registering communications/admin/approval tools and hiding them in descriptions. The remote profile must neither list nor execute approval decisions, messaging/calls, CRM writes, deployments, generated tools, CLI commands or arbitrary tool dispatch. Return selected result fields only; existing `/invoke` response envelopes may contain full runtime state and must not be forwarded wholesale.

Register the final authenticated staging MCP URL as a PBK-scoped Custom MCP toolkit in the correct Composio developer project after staged credential configuration. Limit it to the intended user/session; do not share across every account by default. The existing sandbox HighLevel connector is a separate link and is not a substitute for this registration.

## Command Center behavior

Add a compact Composio section to the existing Settings tooling status and legacy runtime summary. Show each direction independently: disabled, configuration missing, connecting, connected, unavailable or error; include last successful read and a safe reason. Overall readiness requires both independent checks, not the CLI login or agent count. Registered agents are not described as having executed successfully.

No new route, navigation lane, account-management UI or credential-entry form is required. Reuse existing panel/token/typography patterns. Status payloads are bounded, sanitized and contain no session URLs, headers, credential values or raw MCP command arguments. Agents consuming tools must be tested through the same backend seam the Command Center uses.

## Isolation, failure and audit behavior

Default disabled; local isolated tests first, staging enablement only. Use separate inbound/outbound credentials and policies. Persist only non-secret configuration; reconnect with bounded backoff and single-flight connection initialization. A restart must not imply readiness before a successful new handshake. Failure must not fall back to broader accounts or direct unapproved API calls.

Reject PBK remote toolkit loopback from the PBK outbound Composio allowlist. Add bounded call depth/correlation to prevent a Composio → PBK → Composio recursion chain. Audit direction, safe tool name, policy result, timestamp and correlation ID; redact arguments/results and never place CRM data in external memory.

No production UI/site publish, Render setting flip, existing token rotation, account permission expansion, outreach or sales tasks in this implementation. Hosted registration/credential steps must use staging configuration; inability to prove staging scope blocks enablement.

## Acceptance and test evidence

1. Mock remote MCP server: authenticated handshake, allowlisted tool discovery and execution work; stdio regression passes.
2. Deny unknown tools, indirect execution/proxy, arbitrary destinations, cross-project/location/account overrides, loopback recursion and write operations, including attempts supplying unrelated approval IDs.
3. Inbound remote profile authenticates and lists only the permitted PBK tools; missing/invalid credentials and forbidden tools fail. No raw runtime state or secrets in responses/logs/status.
4. Concurrent initialization, reconnect, timeout, service restart and dropped-session tests preserve policy and report truthful states.
5. Agent-to-tool fixture verifies Ava/Rex dispatch uses the adapter and returns a read result through the bridge/Command Center seam. External MCP client fixture verifies Composio-compatible access to the limited PBK endpoint.
6. Run meaningful focused tests, `npm run test:mcp`, `npm run test:bridge`, frontend build, hosted staging smoke and signed-in desktop/mobile Settings checks including 320px overflow.
7. Hosted proof, when staging credentials/registrations exist: one sandbox read through PBK → Composio and one sanitized PBK read through Composio → PBK, plus denied write probes that cannot execute. Do not count local mocks as live provider proof.
8. Verify no QA/CRM record changes, duplicates, outreach or tasks. If provider authorization remains unavailable, report that precise blocker; do not fabricate a connected result.

## Builder decisions and external prerequisites

Builder may select module boundaries, test doubles and safe retry/rate-limit constants using existing conventions. Approval binding and server-side policy are implementation requirements, not optional metadata. Before enablement verify the current Composio API/session schema, actual project/user/account scope, staging host and server-side secret availability. Do not copy the master bridge key to Composio. Credentials must be entered through the established protected provider UI or secret manager; no credential extraction is authorized.

References: [Sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp), [Custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp), and the November 19 connectivity audit in `docs/operations/2026-11-19-composio-command-center-connectivity.md`.
