# E2B cloud inventory: implementation and activation boundary

The dedicated E2B connection and one-tool session are enabled on the isolated Composio staging bridge. Hosted Ava/Rex inventory reads, denial probes and desktop/mobile Settings checks passed. The existing E2B PBK key is preserved. This verifies inventory reads, not Ava/Rex deployed as agents in E2B. Production remains outside this activation.

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

## Staging activation completed

The founder approved the exact runtime/setup credentials and isolated activation. The runtime key was created with the four approved scopes; a fresh dashboard tooltip independently confirmed each resource/access pair. Its recovered one-time value authenticated access to the pinned Active E2B account/user/auth config, then was stored only as `PBK_COMPOSIO_E2B_API_KEY` on the approved staging service. The existing QA and production keys were preserved.

The initial disabled deployment `dep-dbvuuabm8hqs73938lug` passed hosted disabled-command/denial and responsive Settings checks before activation. The final activation deployment `dep-dbvv6od9fdbs73c4tisg` went live at07:16:49UTC November20 on commit `4551820f5e0229a4a432c53c57dbc207dabc2cf9` (the same implementation plus checkpoint documentation). The existing service stays free, auto-deploy off, with `PBK_COMPOSIO_E2B_ENABLED=true` and the separately pinned cloud variables.

The setup-only key was recovered from its existing one-time dialog; no duplicate was created. A fresh saved tooltip independently verified exactly Session management write. It created one session with HTTP201, then was revoked through the exact named-key confirmation. Its row disappeared and an authenticated session-metadata probe using that key returned HTTP401. It was never installed on Render; transient copies were cleared.

## Restricted session and hosted proof

Session `trs_0lhD-TXMNvGT`, configuration1, pins user `pbk-cloud-research`, auth config `ac_WxNF28Po0Sxv`, account `ca_r5HmRJD9k_-7`, the `e2b` toolkit and only `E2B_LIST_SANDBOXES`. Metadata independently confirmed instant usage, connection management, workbench, proxy, search, multi-account and multi-execute are disabled. Actual MCP discovery returned exactly one tool and no next page; the reviewed schema fingerprint is `bd571a6649dea4713ada93407982b291777c186d008a854933b283263cbd230c`. The real Node22 adapter qualified before activation.

At07:17UTC, hosted Ava and Rex each completed the real bridge/MCP inventory read, returning zero sandboxes with complete pagination evidence. Hermes, unsupported-operation and nested-override probes were denied. All eight checked business collections remained identical. The existing QA-contact Ava/Rex read also passed with DND/QA exclusions intact and business collections unchanged.

At07:18UTC, signed-in hosted Settings/reload checks passed on desktop Chromium, iPhone WebKit and320px WebKit. The cloud card showed Read verified and explicitly disclaimed agent-deployment proof. Scroll/client widths matched1199/1199,381/381 and311/311, with no passive provider calls or business mutations. Evidence expires after two minutes by design; a later Not verified status requires another explicit read, not passive polling.

Earlier CLI playground reads produced their own sessions with broad default policies. They were inspected and were **not** reused or installed in PBK. Future hosted acceptance should use the pinned bridge command rather than creating CLI playground sessions. Agent execution remains bound to the dedicated single-tool session.

## Provisioning policy

`ops/e2b-cloud-session-proposal.json` contains the concrete one-tool session body and separate runtime/setup credential proposals. The setup-only key needs Session management write, must not be installed on Render, and must be revoked after one session is created. Runtime needs Tools read, Session management read, Connected accounts read and Session tool execution write. Check provider schema and independently verify saved scope before provisioning. No broad key, connection management, proxy, workbench, multi-account or arbitrary execution is allowed.

Current change is based on `codex/composio-readonly-staging`, not production main. Do not merge it directly to main or switch production to the staging branch. The approved isolated staging activation is complete; production promotion and cloud job execution are separate work. No production release, business write, outbound message, paid upgrade or sandbox job is included.

## Verification

- Focused Composio unit/protocol/real isolated bridge tests, including QA/cloud mixed-configuration isolation, exact arguments, safe pagination, default-off/no-I/O, schema/tool drift, caller overrides, denial and unchanged business collections.
- Settings browser qualification builds current source and checks desktop Chromium, iPhone WebKit and320px WebKit. It asserts no passive cloud/Composio/agent-execution requests.
- MCP typecheck, bridge isolation/offline smoke and Docker import closure.
- Independent reviewer found no critical/important issues; their two minor coverage suggestions were added and passed.

Live restricted-session and hosted command/UI evidence passed as recorded above. This is not proof of autonomous cloud agents, outbound provider delivery, production release or inbound Custom MCP activation.
