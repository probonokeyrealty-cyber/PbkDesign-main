# E2B cloud inventory: implementation and activation boundary

The dedicated E2B connection is Active and an account-bound Composio sandbox-list read succeeded. The existing E2B PBK key is preserved. Neither an Active account nor a sandbox-list result proves Ava/Rex are deployed in E2B.

## Implemented

`runAgentCommand` accepts `Ava check E2B sandboxes`, `Rex check E2B sandboxes`, or explicit `cloudOperation: "cloud-sandboxes"` with the corresponding agent. It returns before model/provider fallback, including when disabled, missing configuration or unavailable. It never starts cloud jobs. Unsupported agents/operations, nested caller overrides and approval overrides are denied.

The separate cloud instance reuses the existing MCP connection lifecycle. Before execution it verifies account/user/auth-config, active status, exact toolkit, session ID/configuration version/URL, account pin, single tool/preload policy and MCP schema fingerprint. MCP listing must contain exactly the permitted tool and no next page. Fixed arguments are `{limit: 100}`. Output contains only returned-page count, `hasMore` and `complete`; IDs, logs, metadata and pagination tokens stay out of agent answers/status/audits. Readiness expires after two minutes without another verified explicit read.

Settings adds one existing-pattern **E2B cloud inventory** card. The legacy runtime summary carries the same status. Both explicitly distinguish inventory verification from agent deployment. Reading status or opening Settings does not connect or execute a provider tool. QA-contact state/configuration is independent.

## Server-only configuration

All cloud variables use `PBK_COMPOSIO_E2B_` and have no QA-profile fallback:

| Suffix | Purpose |
| --- | --- |
| `ENABLED` | Exact `true` to enable; otherwise disabled |
| `API_KEY` | Dedicated scoped Composio **project** runtime key, not the E2B provider key or PBK master key |
| `MCP_URL` | Exact authoritative session MCP URL on HTTPS backend.composio.dev |
| `AUTH_CONFIG_ID`, `USER_ID`, `ACCOUNT_ID` | Explicit connection pins |
| `SESSION_ID`, `SESSION_CONFIG_VERSION` | Authoritative immutable session/configuration pins |
| `SCHEMA_SHA256` | Canonical fingerprint of actual reviewed MCP tool input schema |

The actual E2B provider key stays only in Composio's protected account settings. The runtime key is a different credential. Never copy the QA-contact session or its pins to activate cloud inventory. Defaults remain off, and no credentials are committed.

## Staging checkpoint: cloud disabled

The founder approved the exact runtime/setup credentials and isolated activation. The runtime key was created with the four approved scopes; a fresh dashboard tooltip independently confirmed each resource/access pair. Its recovered one-time value authenticated access to the pinned Active E2B account/user/auth config, then was stored only as `PBK_COMPOSIO_E2B_API_KEY` on the approved staging service. The existing QA and production keys were preserved.

Staging deployment `dep-dbvuuabm8hqs73938lug` went live at06:58:56UTC November20 on commit `dd40ba6b85b7033c058afc1ac88c155b0c02fa9b`. The service stays free, auto-deploy off, with `PBK_COMPOSIO_E2B_ENABLED=false`. Ava/Rex cloud commands returned the deterministic disabled result, denial probes passed, and all eight checked business collections remained identical. Signed-in hosted Settings/reload checks passed on desktop Chromium, iPhone WebKit and320px WebKit, with scroll/client widths1199/1199,381/381 and311/311, no passive provider calls and no business mutations.

The setup-only key creation was submitted with exactly Session management write. Its creation dialog/one-time retrieval and saved scope are not yet verified because BrowserOS began returning unavailable errors. Do not submit again or create a duplicate: inspect the existing pending dialog/key first when browser access returns. A user request to bring the Composio API Keys tab forward and reply ready is pending. No session has been created and no cloud inventory command is enabled. The temporary setup credential must still be revoked after provisioning (or cleaned up if provisioning cannot continue).

## Session provisioning remains pending

`ops/e2b-cloud-session-proposal.json` contains the concrete one-tool session body and separate runtime/setup credential proposals. The setup-only key needs Session management write, must not be installed on Render, and must be revoked after one session is created. Runtime needs Tools read, Session management read, Connected accounts read and Session tool execution write. Check provider schema and independently verify saved scope before provisioning. No broad key, connection management, proxy, workbench, multi-account or arbitrary execution is allowed.

Current change is based on `codex/composio-readonly-staging`, not production main. Do not merge it directly to main or switch production to the staging branch. Staging code and runtime credential installation are complete with cloud disabled; the restricted session, activation and actual hosted inventory-read acceptance remain pending. No production release, business write, outbound message, paid upgrade or sandbox job is included.

## Verification

- Focused Composio unit/protocol/real isolated bridge tests, including QA/cloud mixed-configuration isolation, exact arguments, safe pagination, default-off/no-I/O, schema/tool drift, caller overrides, denial and unchanged business collections.
- Settings browser qualification builds current source and checks desktop Chromium, iPhone WebKit and320px WebKit. It asserts no passive cloud/Composio/agent-execution requests.
- MCP typecheck, bridge isolation/offline smoke and Docker import closure.
- Independent reviewer found no critical/important issues; their two minor coverage suggestions were added and passed.

Live restricted-session evidence is **not** claimed. The disabled hosted new-card and command checks passed as recorded above. The pre-existing dedicated account read and earlier transient Linux/Node sandbox test remain separate proofs.
