# Composio, PBK agents and Command Center connectivity

Observed November 19, 2026. Read-only audit; no deployment, provider business writes, configuration changes, outreach, CRM records or tasks created.

## Outcome

The PBK hosted bridge is reachable and accepts authenticated metadata reads. Its registry contains 11 agents, including Ava, Rex and Hermes. This establishes backend availability and agent registration, not successful agent/provider execution. Composio CLI authorization is available locally, but a working Composio-to-PBK agent connection was not established by this audit.

## Verified connection map

| Link | Evidence | Result |
| --- | --- | --- |
| Authenticated client to hosted PBK bridge | `/api/bridge/connection` returned HTTP 200, `ready: true`, `bridge_connection_ready` | Verified |
| Hosted bridge to state store | `/health` reported authenticated hosted mode and Postgres ready | Verified health report |
| Hosted agent registry | `/api/agents/registry` returned 11 agents | Registry verified; execution untested |
| Hosted MCP client inventory | Metadata-only `listMcpTools` returned zero servers | No Composio server registered in this inventory |
| Local Composio CLI | Human session and an Active sandbox HighLevel connection visible | Local authorization verified; not a hosted backend session |
| Local OpenClaw configuration | Server names: browseros, scrapling, mcp360, pbk-openclaw, n8n-mcp; no Composio configuration key found | PBK configuration exists; Composio absent from inspected configuration |
| Command Center source to bridge | `runtimeBridge.ts` uses hosted bridge fallback and common bridge request functions | Source wiring verified |
| Signed-in hosted Command Center to bridge | Public Netlify proxy request returned HTTP 401 HTML; no signed-in browser check completed | Unverified; access gate is not evidence of a failed backend |

No credentials, raw configuration, CRM records or MCP argument values were copied into this report. Private sanitized metadata lives under `.pbk-local/composio-command-center-audit/2026-11-19/`.

## Implementation gaps

1. `scripts/openclaw-local-server.mjs` implements a command-based stdio MCP client in `connectMcpRuntimeServer`. It has no remote HTTP MCP transport or Composio session adapter. Its client map is in memory; this function does not persist or reconnect registrations.
2. `buildToolingStatus` has no Composio readiness section. Example registry entries do not prove an active connection.
3. `mcp-server/src/index.ts` exposes PBK tools through stdio. It is not a public remote MCP endpoint that Composio can register directly as a Custom MCP toolkit.
4. Local CLI authorization, developer-project connected accounts and hosted agent credentials are separate contexts. An Active consumer sandbox connection must not be presumed available to a developer session.

## Direction decision needed

- **PBK agents use Composio:** extend the existing approval-backed backend tool lane with a narrowly scoped server-side Composio session/client. Command Center remains the operator surface. Bind the intended project/user/account explicitly and expose sanitized readiness there.
- **Composio calls PBK:** expose an authenticated, limited remote MCP adapter around existing bridge tools, then register that endpoint in Composio. Preserve server-side approval enforcement and do not give Composio unrestricted admin/communication tools.
- **Both:** implement and test these as separate authenticated links. Avoid agent/tool recursion and preserve the single existing approval authority.

Official references checked November 19:

- [Using sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp): applications configure a user session and pass its remote MCP endpoint to a compatible client; credentials remain server-side. When approval elicitation is unavailable, deny rather than bypass approval.
- [Custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp): bringing PBK tools into Composio requires an authenticated remote MCP endpoint at a final public HTTPS URL. Registering a local stdio command is insufficient for that route.

## Acceptance checks for the next change

Use the existing backend and Command Center; do not create a parallel dashboard. First prove a read-only metadata operation end to end. Show disconnected/error states truthfully. Test denial without approval, account/location scope, reconnect behavior and secret redaction before permitting any write-capable tool. Preserve QA exclusion, DND and sandbox boundaries. A production deployment requires explicit release authorization.

## Validation performed

- `npm run test:mcp`: passed.
- `npm run test:bridge`: passed (nine isolation tests plus isolated offline smoke). Provider delivery was explicitly **not** verified.
- Authenticated hosted metadata audit: bridge connection, tooling status and registry returned HTTP 200; MCP inventory empty.
- Local configuration audit printed only section/server/plugin names and credential-free metadata.

No live provider delivery, signed-in Command Center operation, Composio-hosted PBK execution or automated HighLevel property guard installation is claimed. The earlier HighLevel custom-field schema issue and support ticket remain separate from this connectivity gap.
