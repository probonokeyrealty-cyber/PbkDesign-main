# Explicit E2B cloud inventory

The founder requested continued Composio/cloud-agent work after approving a dedicated E2B connection. The connection is Active under the dedicated PBK cloud-research user; it is not an agent deployment. Build the next bounded increment on the existing Composio staging branch, leaving production untouched.

Use the existing MCP transport/lifecycle and explicit `runAgentCommand` seam, rather than adding a generic executor or second agent dashboard. An independent, default-off E2B profile permits only `E2B_LIST_SANDBOXES`, with server-fixed `{limit: 100}`. Ava and Rex may request `check E2B sandboxes`; Hermes remains suggest-only. Every read verifies the pinned account/user/auth config and session/tool/schema policy. Return only the first-page count and whether more pages exist, never sandbox IDs, metadata, secrets or logs. Do not describe an empty inventory as a deployed agent fleet.

Keep profile credentials/configuration/evidence separate from the existing QA-contact profile. Configuration/status/page loads perform no network calls. Reject caller overrides, extra advertised tools, schema drift, account drift, stale results and unsupported agents/operations. Preserve timeouts, reconnect/backoff, two-minute evidence expiry and safe audit projection. Unavailable checks must not fall through to an LLM or another provider.

Show the cloud-inventory state through the existing Settings card and legacy runtime summary. Preserve PBK typography/tokens/layout, contain phone widths and expose no new top-level navigation. A verified inventory read is not proof of agents running in E2B.

Alternatives considered: a new E2B daemon/dashboard would duplicate the existing control plane; unrestricted Composio execution would exceed the approved scope. Reusing the existing bridge transport with a fixed second profile is the chosen implementation decision.

No sandbox creation, code execution, deletion, paid upgrade, business write, production activation or inbound Custom MCP activation is included. Live restricted-session provisioning requires an approved setup credential or an authenticated provider UI that can express the exact policy; do not extract CLI/browser credential caches.
