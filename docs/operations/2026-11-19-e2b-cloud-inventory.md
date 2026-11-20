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

## Provisioning remains pending

`ops/e2b-cloud-session-proposal.json` contains the concrete one-tool session body and separate runtime/setup credential proposals. The setup-only key needs Session management write, must not be installed on Render, and must be revoked after one session is created. Runtime needs Tools read, Session management read, Connected accounts read and Session tool execution write. Check provider schema and independently verify saved scope before provisioning. No broad key, connection management, proxy, workbench, multi-account or arbitrary execution is allowed.

Current change is based on `codex/composio-readonly-staging`, not production main. Do not merge it directly to main or switch production to the staging branch. The scoped credentials/session, isolated staging deployment and hosted acceptance still require activation; no production release, business write, outbound message, paid upgrade or sandbox job is included.

## Verification

- Focused Composio unit/protocol/real isolated bridge tests, including QA/cloud mixed-configuration isolation, exact arguments, safe pagination, default-off/no-I/O, schema/tool drift, caller overrides, denial and unchanged business collections.
- Settings browser qualification builds current source and checks desktop Chromium, iPhone WebKit and320px WebKit. It asserts no passive cloud/Composio/agent-execution requests.
- MCP typecheck, bridge isolation/offline smoke and Docker import closure.
- Independent reviewer found no critical/important issues; their two minor coverage suggestions were added and passed.

Live restricted-session evidence and hosted new-card evidence are **not** claimed. The pre-existing dedicated account read and earlier transient Linux/Node sandbox test remain separate proofs.
